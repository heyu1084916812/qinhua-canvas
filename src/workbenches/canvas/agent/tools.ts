import {
  alignGenerationMode,
  normalizeAgentPlan,
  validateAgentPlan,
  type AgentNodeType,
  type AgentPlan,
} from '../../../domain/agent/plan'
import type { ToolDeclaration } from '../../../domain/shared/execution/types'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { applyAgentPlan } from './applyAgentPlan'

/**
 * Agent 的工具集（设计文档 §5 / §5.1）。
 *
 * 两条硬规矩：
 * ① **每个工具都映射到既有命令**，不新开旁路 —— 这样撤销、日志、指纹全都照常；
 * ② **读与写分开**：读类由循环直接调，写 / 花钱类由界面确认后才调（§9）。
 *    两者分别导出两个执行器，从类型上就不给「循环里偷偷写」的机会。
 */

/** 给模型看的工具声明。参数 schema 与设计文档 §5.1 一一对应 */
export const AGENT_TOOLS: readonly ToolDeclaration[] = [
  {
    name: 'readGraph',
    description: '看当前画布上有什么节点、怎么连的、哪些已经出过图。问「现在有什么」时用它。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all', 'selection'], description: '看全图还是只看选中' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'readAsset',
    description: '看指定节点的素材信息（类型、像素），用来判断能不能当参考图。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'applyPlan',
    description:
      '把一份工作流建到画布上：给出要建的节点与连线，一次性落地。' +
      '**这一步立刻生效、不会问用户**（建节点不花钱，用户马上能在画布上看到）；' +
      '随后要不要真的出图，系统会再问用户一次。' +
      '连线可以用 attach 复用画布上已有的节点。',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '一句话说明这份计划在做什么' },
        nodes: { type: 'array', items: { type: 'object' } },
        edges: { type: 'array', items: { type: 'object' } },
        attach: { type: 'array', items: { type: 'object' } },
      },
      required: ['summary', 'nodes', 'edges'],
    },
  },
  {
    name: 'updateNode',
    description: '改某个节点的参数（比如比例、张数、提示词），会先让用户确认。',
    parameters: {
      type: 'object',
      properties: { nodeId: { type: 'string' }, data: { type: 'object' } },
      required: ['nodeId', 'data'],
    },
  },
  {
    name: 'runNode',
    description: '跑指定的节点（会花钱，先让用户确认）。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
  {
    name: 'readResult',
    description: '看指定节点跑出来的产物（有没有图、哪个 hash）或失败原因。',
    parameters: {
      type: 'object',
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
      required: ['nodeIds'],
    },
  },
]

/** 画布现状摘要 —— 结构与设计文档 §4.2 的回填格式一致 */
export interface GraphSummary {
  nodes: { id: string; type: string; title: string; hasOutput: boolean }[]
  edges: { source: string; target: string; sourcePort: string; targetPort: string }[]
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

export function readGraphSummary(
  store: CanvasStore,
  scope: unknown,
  selectedIds: readonly string[] = [],
): GraphSummary {
  const graph = store.getSnapshot()
  // 选中项由调用方给：画布 store 只暴露图快照，选中态在视图层
  const only = scope === 'selection' ? new Set(selectedIds) : null
  const nodes = graph.nodes
    .filter((n) => !only || only.has(n.id))
    .map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      hasOutput: typeof asRecord(n.data).assetHash === 'string',
    }))
  const ids = new Set(nodes.map((n) => n.id))
  return {
    nodes,
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        sourcePort: e.sourcePort ?? 'output',
        targetPort: e.targetPort ?? 'input',
      })),
  }
}

/**
 * 素材信息。
 *
 * 尺寸只报**节点记录下来的**真实像素（`naturalSize`）：节点没记就说不知道，
 * 不去猜、也不为它去解码字节 —— agent 问它是为了判断「能不能当参考图」，
 * 一个编出来的尺寸会直接导致它做出错误判断。
 */
export function readAssetInfo(store: CanvasStore, nodeIds: unknown) {
  const graph = store.getSnapshot()
  const out: { nodeId: string; mime: string; width?: number; height?: number }[] = []
  for (const id of asStringArray(nodeIds)) {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) {
      out.push({ nodeId: id, mime: 'unknown' })
      continue
    }
    const data = asRecord(node.data)
    const size = asRecord(data.naturalSize)
    const w = typeof size.width === 'number' ? size.width : undefined
    const h = typeof size.height === 'number' ? size.height : undefined
    out.push({
      nodeId: id,
      mime: node.type === 'generation' && data.mode === 'video' ? 'video/mp4' : 'image/png',
      ...(w && h ? { width: w, height: h } : {}),
    })
  }
  return out
}

/**
 * 产物与状态。
 *
 * 数据源是**节点自己记着的产物字段**（画布上显示的就是它），不是执行留痕表 ——
 * agent 关心的是「这个节点现在有什么」，而不是「历史上跑过几次」。
 */
export function readResults(store: CanvasStore, nodeIds: unknown) {
  const graph = store.getSnapshot()
  return asStringArray(nodeIds).map((id) => {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) return { nodeId: id, status: 'missing' as const }
    const hash = asRecord(node.data).assetHash
    return typeof hash === 'string'
      ? { nodeId: id, status: 'ok' as const, outputs: [{ hash, mime: 'image/png' }] }
      : { nodeId: id, status: 'empty' as const }
  })
}

export interface AgentToolContext {
  store: CanvasStore
  /** 新节点的落点（§6：优先视口中心偏左） */
  origin: { x: number; y: number }
  /** 跑节点 —— 由执行层注入：agent 自己不直接发渠道请求 */
  runNodes: (nodeIds: string[]) => Promise<{ nodeId: string; ok: boolean; error?: string }[]>
  /** 当前选中的节点 —— `readGraph` 的 `selection` 范围要用；不给就按全图算 */
  selectedIds?: () => readonly string[]
  /**
   * 新建节点要补的默认数据（渠道 + 模型 + 生成参数）。
   *
   * 解析默认值要读渠道库（异步），而工具执行器在画布层、拿不到渠道 store，
   * 所以由界面层把「解析」这件事注入进来 —— 解出来的东西**与用户手建节点同源**
   * （两条路都走 `channels.defaultForNewNode`），不会出现「手建的能用、agent 建的
   * 点了没反应」这种分叉。
   *
   * 不给也能跑，但那意味着建出来的生成节点没渠道没模型。
   */
  defaultsForNewNode?: (
    types: readonly AgentNodeType[],
  ) => Promise<Partial<Record<AgentNodeType, Record<string, unknown>>>>
  /**
   * **生成节点该用哪个模型** —— 用户在对话窗上点选的图片 / 视频档
   * （用户 2026-10-03：「我创作面板有什么模型就用什么模型…模型有三个选项」）。
   *
   * 按节点的 `data.mode` 选：视频节点给视频模型，其余给图片模型。
   * 返回 undefined 就保持渠道默认配方不动。
   *
   * 与 `defaultsForNewNode` 一样由界面层注入：工具层认得节点，但不认得渠道 store。
   */
  recipeForGenerated?: (
    type: AgentNodeType,
    node: { data: Record<string, unknown> },
  ) => { channelId: string; model: string } | undefined

  /**
   * 模型名 → 它是哪一类（`image` / `video` / `chat`）。由界面层注入（那边有渠道目录）。
   *
   * 只为一件事：**生成节点的 `mode` 以模型为准**。真模型（Agnes 2.5 Pro）会把视频节点
   * 写成 `mode: "image"`（它把「生成节点」当默认档），只写对 `model: "Agnes Video 2.0"`；
   * 而执行层是按 `mode` 走图片 / 视频两条链的 —— 不纠正的话，视频模型被塞进生图链路，
   * 点了生成**一个请求都发不出去**（用户 2026-10-03 让我用 agent 做视频时实测到的）。
   */
  categoryOfModel?: (model: string) => 'image' | 'video' | 'chat' | undefined
}

/** 读类执行器：循环里直接调（设计文档 §4） */
export async function executeReadTool(
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const a = asRecord(args)
  switch (name) {
    case 'readGraph':
      return readGraphSummary(ctx.store, a.scope, ctx.selectedIds?.() ?? [])
    case 'readAsset':
      return { assets: readAssetInfo(ctx.store, a.nodeIds) }
    case 'readResult':
      return { results: readResults(ctx.store, a.nodeIds) }
    default:
      return { ok: false, error: `没有这个读类工具：${name}` }
  }
}

/**
 * 写 / 花钱的执行器：**只应由界面的「确认」按钮调用**（设计文档 §9）。
 *
 * 与读类分开导出，是为了让「循环里偷偷写」在代码结构上就写不出来。
 */
/**
 * `applyPlan` 的**落前检查**：先归一化、再校验，返回问题列表（空 = 可以落地）。
 *
 * 这是「计划 → 画布」的唯一关口，两个用处：
 * ① 落地前把**形状差异**补齐（`normalizeAgentPlan`），别因为 `order` 写成字符串
 *    这种事整份拒绝；
 * ② 真推不出来的（不认识类型 / 连线指向不存在）整份拒绝，并把问题回给模型。
 *
 * 用户 2026-10-02 报的「重复让我确认新建工作流、重复了三次、画布上什么都没有」
 * 就出在这一步：当时建图还排在确认卡后面，用户先点一次确认我们才发现计划不合法。
 * 现在**建图根本不问**（见 `agentLoop` 的 `WRITE_TOOLS`），失败也直接以
 * 步骤卡的形式露在对话里。
 */
export function planProblems(
  args: unknown,
  existingNodeIds: readonly string[],
): { problems: string[]; plan: AgentPlan | null } {
  const { plan } = normalizeAgentPlan(args)
  const checked = validateAgentPlan(plan, existingNodeIds)
  if (!checked.ok) return { problems: checked.errors, plan: null }
  /**
   * 过形状这一关之后再看一眼**内容**：有没有节点按定义就永远跑不起来。
   *
   * 用户 2026-10-04 报的正是这一类：「结构全对，但是没有提示词」—— 计划能落地、
   * 看着像模像样，可是下游生成节点一个提示词都拿不到（`toRunRequest` 直接返回 null）。
   * 落地之后再让用户自己发现，比当场把话还给模型糟得多。
   */
  const promptless = promptlessGenerationProblems(checked.plan)
  return promptless.length > 0
    ? { problems: promptless, plan: null }
    : { problems: [], plan: checked.plan }
}

/**
 * 上游能**给文字**的节点类型（与 `generationSpec.collectInputs` 同口径）：
 * 提示词节点给 `data.text`，循环节点每轮给 `__roundPrompt`，生成 / 批量 / 分组
 * 自身也可能带着正文。判不出来的（attach 过来的既有节点）一律**当它能给**，
 * 宁可放过、也不要冤枉一份正常计划。
 */
const TEXT_SOURCE_TYPES = new Set<AgentNodeType>(['prompt', 'loop', 'group', 'batch', 'generation'])

/**
 * 找「**永远跑不起来**的生成节点」：自己没有正文，上游也没有一个能给文字的节点。
 *
 * 为什么值得当场拦：`generationSpec.toRunRequest` 在提示词为空时直接返回 null，
 * 也就是这个节点点多少次都不会发请求 —— 不拦的话用户只会看到一张建好的、跑不动的图。
 */
export function promptlessGenerationProblems(plan: AgentPlan): string[] {
  const byId = new Map(plan.nodes.map((n) => [n.localId, n]))
  const attached = new Set((plan.attach ?? []).map((a) => a.localId))
  const out: string[] = []
  for (const [i, node] of plan.nodes.entries()) {
    if (node.type !== 'generation') continue
    const own = node.data.prompt
    if (typeof own === 'string' && own.trim()) continue
    const upstream = plan.edges
      .filter((e) => e.target === node.localId)
      .map((e) => byId.get(e.source))
    const hasTextSource = upstream.some(
      (u) => u && (attached.has(u.localId) || TEXT_SOURCE_TYPES.has(u.type)),
    )
    if (hasTextSource) continue
    out.push(
      `第 ${i + 1} 个节点（generation「${node.title ?? node.localId}」）既没有自己的提示词，` +
        '上游也没有能给它文字的节点 —— 这条链永远跑不出图。' +
        '把用户要的画面写进它的 data.prompt，或建一个提示词节点（正文写在 data.text）连到它。',
    )
  }
  return out
}

export async function executeConfirmedTool(
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const a = asRecord(args)
  switch (name) {
    case 'applyPlan': {
      const existing = ctx.store.getSnapshot().nodes.map((n) => n.id)
      const { problems, plan } = planProblems(a, existing)
      if (!plan) return { ok: false, problems }
      /**
       * 生成节点的 `mode` **以模型自己的类别为准**（详见 `alignGenerationMode`）：
       * 真模型常把视频节点写成 `mode:"image"`，不纠正的话请求都组不出来。
       */
      const aligned = ctx.categoryOfModel
        ? alignGenerationMode(plan, ctx.categoryOfModel)
        : { plan, notes: [] }
      const finalPlan = aligned.plan
      /**
       * 先把「新建节点的默认数据」解出来，再交给纯函数建命令。
       *
       * 只解**计划里真用到的类型**：一次对话可能只建生成节点，没必要去问聊天模型。
       * 复用（attach）的节点不新建，也就不需要默认值。
       */
      const needed = [...new Set(finalPlan.nodes.map((n) => n.type))]
      const defaults = ctx.defaultsForNewNode ? await ctx.defaultsForNewNode(needed) : undefined
      const applied = applyAgentPlan(ctx.store, finalPlan, ctx.origin, {
        /**
         * 三层打底由 `buildLandingCommand` 负责，这里只把**用户点选的那一档**
         * 叠进「渠道默认配方」这一层：计划里自己写了模型仍然以计划为准（§11）。
         */
        dataFor: (type: AgentNodeType, node) => {
          const base = defaults?.[type] ?? {}
          const picked = ctx.recipeForGenerated?.(type, node)
          return picked ? { ...base, channelId: picked.channelId, model: picked.model } : base
        },
      })
      // 自检结果整份回填：模型要靠它决定补连线还是改图（§6.1）
      return {
        ok: applied.ok,
        problems: applied.problems,
        createdNodeIds: applied.createdNodeIds,
        ...(aligned.notes.length > 0 ? { notes: aligned.notes } : {}),
      }
    }
    case 'updateNode': {
      const id = typeof a.nodeId === 'string' ? a.nodeId : ''
      if (!ctx.store.getSnapshot().nodes.some((n) => n.id === id)) {
        return { ok: false, problems: [`节点不存在：${id}`] }
      }
      ctx.store.dispatch({ kind: 'node.updateData', id, patch: asRecord(a.data) })
      return { ok: true }
    }
    case 'runNode': {
      const ids = asStringArray(a.nodeIds)
      if (ids.length === 0) return { ok: false, problems: ['没有指定要跑的节点'] }
      const outcomes = await ctx.runNodes(ids)
      return { ok: outcomes.every((o) => o.ok), outcomes }
    }
    default:
      return { ok: false, problems: [`没有这个工具：${name}`] }
  }
}
