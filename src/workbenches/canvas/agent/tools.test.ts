import { describe, expect, it, vi, beforeEach } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import type { AgentPlan } from '../../../domain/agent/plan'
import { AGENT_TOOL_DEFINITIONS } from '../../../domain/agent/toolRegistry'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  AGENT_TOOLS,
  executeConfirmedTool,
  executeReadTool,
  planProblems,
  readAssetInfo,
  readGraphSummary,
  readResults,
  runFromNodeIds,
  type AgentToolContext,
} from './tools'
import { buildAgentSystemPrompt } from './agentSystemPrompt'

/**
 * 工具集（设计文档 §5）。
 *
 * 除了功能，这里盯一条结构性的规矩：**读类与写类是分开的执行器** ——
 * 循环只能拿到读那个，所以「边想边把画布改了」在代码上就写不出来。
 */

beforeEach(() => registerAllSpecs())

function setup() {
  const store: CanvasStore = createCanvasStore({
    platform: createMemoryPlatform() as never,
    projectId: 'p1',
  })
  const runNodes = vi.fn(async (ids: string[]) => ids.map((nodeId) => ({ nodeId, ok: true })))
  const ctx: AgentToolContext = { store, origin: { x: 0, y: 0 }, runNodes }
  return { store, ctx, runNodes }
}

const addNode = (
  store: CanvasStore,
  /** 也允许 `batch`：只为验「分发器的产物落在承载节点上」那一组读取逻辑 */
  type: 'prompt' | 'generation' | 'batch',
  data: Record<string, unknown> = {},
  title?: string,
) => {
  store.dispatch({ kind: 'node.create', projectId: 'p1', type, at: { x: 0, y: 0 }, data })
  const id = store.getSnapshot().nodes.at(-1)!.id
  if (title) store.dispatch({ kind: 'node.rename', id, title })
  return id
}

describe('工具声明', () => {
  it('★ 读图、运行、空间操作和现有图像能力都在，且都带参数 schema', () => {
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual([
      'applyPlan',
      'arrangeNodes',
      'compareNodes',
      'deleteEdges',
      'deleteNodes',
      'moveNodes',
      'proposeTaskPlan',
      'readAsset',
      'readGraph',
      'readResult',
      'rememberMemory',
      'requestTaskConfirmation',
      'resizeNodes',
      'runFrom',
      'runNode',
      'sliceImage',
      'splitGrid',
      'updateNode',
      'updateTaskStep',
      'visualReview',
    ])
    for (const t of AGENT_TOOLS) expect(t.parameters).toMatchObject({ type: 'object' })
  })

  it('★★ 模型可见的 schema 与领域 ToolRegistry 完全同源', () => {
    expect(AGENT_TOOLS.map((tool) => tool.name).sort()).toEqual(
      AGENT_TOOL_DEFINITIONS.map((tool) => tool.name).sort(),
    )
  })

  it('★ rememberMemory 把当前项目 / 会话补进候选并交给记忆存储', async () => {
    const rememberMemory = vi.fn(async () => ({
      ok: true,
      memoryId: 'memory-1',
      text: '以后主色都用深绿',
    }))
    const ctx = {
      store: setup().store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(),
      memoryContext: {
        workbench: 'canvas' as const,
        projectId: 'p1',
        sessionId: 's1',
      },
      rememberMemory,
    } satisfies AgentToolContext
    const result = await executeConfirmedTool(
      'rememberMemory',
      {
        text: '以后这个项目主色都用深绿',
        kind: 'fact',
        scope: 'project',
        key: 'brand.primaryColor',
      },
      ctx,
    )
    expect(result).toEqual({
      ok: true,
      memoryId: 'memory-1',
      text: '以后主色都用深绿',
    })
    expect(rememberMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project',
        projectId: 'p1',
        key: 'brand.primarycolor',
      }),
    )
  })

  it('★★ 任务计划严格按顺序推进，产出步骤验收后才允许完成', async () => {
    let current: import('../../../domain/agent/taskPlan').AgentTaskPlan | undefined
    const save = vi.fn(async (plan: import('../../../domain/agent/taskPlan').AgentTaskPlan) => {
      current = plan
      return plan
    })
    const ctx = {
      ...setup().ctx,
      taskPlan: {
        get: async () => current,
        save,
      },
    } satisfies AgentToolContext

    const proposed = (await executeConfirmedTool(
      'proposeTaskPlan',
      {
        title: '品牌视觉套件',
        summary: '先梳理输入，再生成视觉规范',
        assumptions: ['品牌名暂定 HE YU'],
        steps: [
          { id: 'research', title: '梳理品牌输入', requiresConfirmation: false },
          { id: 'visual', title: '生成视觉规范', requiresConfirmation: true },
          { id: 'deliver', title: '制作应用物料', requiresConfirmation: true },
        ],
      },
      ctx,
    )) as { ok: boolean; plan: import('../../../domain/agent/taskPlan').AgentTaskPlan }
    expect(proposed.ok).toBe(true)
    expect(proposed.plan.currentStepId).toBe('research')
    expect(proposed.plan.assumptions).toEqual(['品牌名暂定 HE YU'])

    const updated = (await executeConfirmedTool(
      'updateTaskStep',
      { stepId: 'research', status: 'done', note: '已整理 4 项输入' },
      ctx,
    )) as { ok: boolean; plan: import('../../../domain/agent/taskPlan').AgentTaskPlan }
    expect(updated.ok).toBe(true)
    expect(updated.plan.currentStepId).toBeUndefined()
    expect(updated.plan.steps[0]).toMatchObject({
      status: 'done',
      note: '已整理 4 项输入',
    })

    const started = (await executeConfirmedTool(
      'updateTaskStep',
      { stepId: 'visual', status: 'in_progress' },
      ctx,
    )) as { ok: boolean; plan: import('../../../domain/agent/taskPlan').AgentTaskPlan }
    expect(started.ok).toBe(true)
    expect(started.plan.currentStepId).toBe('visual')

    expect(
      await executeConfirmedTool(
        'updateTaskStep',
        { stepId: 'visual', status: 'done' },
        ctx,
      ),
    ).toMatchObject({ ok: false })

    current = {
      ...started.plan,
      steps: started.plan.steps.map((step) =>
        step.id === 'visual' ? { ...step, resultsReadyAt: 175 } : step,
      ),
    }
    expect(
      await executeConfirmedTool(
        'requestTaskConfirmation',
        {
          stepId: 'visual',
          purpose: 'review',
          question: '这版视觉规范是否满意？',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      approved: true,
      purpose: 'review',
      stepId: 'visual',
      plan: {
        steps: [
          { id: 'research', status: 'done' },
          { id: 'visual', status: 'in_progress', reviewApprovedAt: expect.any(Number) },
          { id: 'deliver', status: 'pending' },
        ],
      },
    })

    const completed = (await executeConfirmedTool(
      'updateTaskStep',
      { stepId: 'visual', status: 'done' },
      ctx,
    )) as { ok: boolean; plan: import('../../../domain/agent/taskPlan').AgentTaskPlan }
    expect(completed.ok).toBe(true)
    expect(completed.plan.steps.map((step) => step.status)).toEqual([
      'done',
      'done',
      'pending',
    ])
    expect(completed.plan.currentStepId).toBeUndefined()
    expect(save).toHaveBeenCalled()
  })

  it('★★ 生成成功后标记结果待验收，并拦住下一阶段建图', async () => {
    let current: import('../../../domain/agent/taskPlan').AgentTaskPlan = {
      id: 'plan-review',
      title: 'Logo 设计',
      steps: [
        {
          id: 'logo',
          title: '生成 Logo',
          status: 'in_progress',
          requiresConfirmation: true,
          startedAt: 1,
        },
        {
          id: 'deck',
          title: '制作作品集',
          status: 'pending',
          requiresConfirmation: true,
        },
      ],
      currentStepId: 'logo',
      createdAt: 1,
      updatedAt: 1,
    }
    const save = vi.fn(async (plan: typeof current) => {
      current = plan
      return plan
    })
    const ctx = {
      ...setup().ctx,
      taskPlan: {
        get: async () => current,
        save,
      },
    } satisfies AgentToolContext

    const ran = (await executeConfirmedTool(
      'runNode',
      { nodeIds: ['node-logo'] },
      ctx,
    )) as {
      ok: boolean
      plan: import('../../../domain/agent/taskPlan').AgentTaskPlan
    }
    expect(ran.ok).toBe(true)
    expect(ran.plan.steps[0]?.resultsReadyAt).toEqual(expect.any(Number))

    expect(
      await executeConfirmedTool(
        'applyPlan',
        {
          summary: '下一阶段',
          nodes: [
            {
              localId: 'page',
              type: 'generation',
              data: { mode: 'image', prompt: '作品集内页' },
            },
          ],
          edges: [],
        },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('等用户验收')]),
    })
  })
})

describe('读类工具', () => {
  it('★ readGraph 报出节点、连线和「出过图没有」', async () => {
    const { store, ctx } = setup()
    const p = addNode(store, 'prompt', { text: '橘猫' })
    const g = addNode(store, 'generation', { mode: 'image', assetHash: 'h1' })
    store.dispatch({ kind: 'edge.connect', source: p, target: g })

    const s = readGraphSummary(store, 'all')
    expect(s.nodes).toHaveLength(2)
    expect(s.nodes.find((n) => n.id === g)?.hasOutput).toBe(true)
    expect(s.nodes.find((n) => n.id === p)?.hasOutput).toBe(false)
    /**
     * ★★ 摘要要带**正文**（用户 2026-10-05 第六批：换风格时模型拿节点名当内容，
     * 把「只换 3D 风格」做成了「重画一只钓鱼的小猫」）。
     * 提示词节点读 `data.text`，生成节点读 `data.prompt`。
     */
    expect(s.nodes.find((n) => n.id === p)?.prompt).toBe('橘猫')
    expect(s.edges).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        source: p,
        target: g,
        sourcePort: 'output',
        targetPort: 'input',
      }),
    ])

    // 通过执行器调也一样（循环走的就是这个入口）
    expect(await executeReadTool('readGraph', { scope: 'all' }, ctx)).toMatchObject({
      nodes: expect.any(Array),
    })
  })

  it('★★ readGraph 报出坐标、区域、邻接关系与真实 edge id', () => {
    const { store } = setup()
    const left = addNode(store, 'prompt', { text: '左' }, '左侧提示词')
    const right = addNode(store, 'generation', { mode: 'image', prompt: '右' }, '右侧生成')
    store.dispatch({ kind: 'node.move', ids: [right], dx: 640, dy: 240, phase: 'end' })
    store.dispatch({ kind: 'edge.connect', source: left, target: right })

    const summary = readGraphSummary(store, 'all')
    const leftNode = summary.nodes.find((node) => node.id === left)!
    const rightNode = summary.nodes.find((node) => node.id === right)!
    expect(summary.bounds).toMatchObject({ x: 0, y: 0 })
    expect(leftNode).toMatchObject({ x: 0, y: 0, zone: '左上' })
    expect(rightNode.center?.x).toBeGreaterThan(leftNode.center?.x ?? 0)
    expect(leftNode.nearby?.[0]).toMatchObject({ nodeId: right, direction: '右' })
    expect(leftNode.downstream).toContain(right)
    expect(rightNode.upstream).toContain(left)
    expect(summary.edges[0]?.id).toEqual(expect.any(String))
  })

  it('★★ readAsset 只报节点记下来的真实像素，没记就不编', async () => {
    const { store, ctx } = setup()
    const withSize = addNode(store, 'generation', {
      mode: 'image',
      naturalSize: { width: 1024, height: 768 },
    }, '商品主图')
    const noSize = addNode(store, 'generation', { mode: 'image' }, '草稿图')

    const out = readAssetInfo(store, [withSize, noSize, 'nope'])
    expect(out[0]).toMatchObject({ nodeId: withSize, title: '商品主图', width: 1024, height: 768 })
    // 没记录尺寸 → 不出现 width/height（编一个会让 agent 判断错）
    expect(out[1]!.width).toBeUndefined()
    expect(out[2]!.mime).toBe('unknown')

    expect(await executeReadTool('readAsset', { nodeIds: [withSize] }, ctx)).toMatchObject({
      assets: expect.any(Array),
    })
  })

  it('★ readResult：有产物就是 ok，没有就是 empty，节点不存在就 missing', () => {
    const { store } = setup()
    const ok = addNode(store, 'generation', { mode: 'image', assetHash: 'h1' }, '三视图设定')
    const empty = addNode(store, 'generation', { mode: 'image' })
    const out = readResults(store, [ok, empty, 'gone'])
    expect(out.map((r) => r.status)).toEqual(['ok', 'empty', 'missing'])
    expect(out[0]).toMatchObject({ title: '三视图设定' })
  })

  it('★★ visualReview 只调用只读子代理，不改画布，并解析应用层给的节点别名', async () => {
    const { store, ctx } = setup()
    const visualReview = vi.fn(async () => ({
      ok: true as const,
      verdict: 'needs_changes' as const,
      summary: '标题需要修改',
      issues: [
        {
          severity: 'blocking' as const,
          category: 'text' as const,
          nodeId: 'node-real',
          problem: '标题有一个错字',
          suggestion: '修正错字',
        },
      ],
      targetNodeIds: ['node-real'],
      limitations: [],
    }))
    const before = store.getSnapshot()
    const result = await executeReadTool(
      'visualReview',
      { nodeIds: ['g1'], checklist: '检查标题' },
      {
        ...ctx,
        resolveNodeIds: (ids) => ids.map((id) => (id === 'g1' ? 'node-real' : id)),
        visualReview,
      },
    )

    expect(visualReview).toHaveBeenCalledWith({
      nodeIds: ['node-real'],
      checklist: '检查标题',
    })
    expect(result).toMatchObject({
      verdict: 'needs_changes',
      targetNodeIds: ['node-real'],
    })
    expect(store.getSnapshot()).toBe(before)
  })

  /**
   * ★★ **批量 / 循环的产物落在承载节点上**（用户 2026-10-16：「执行是出了图的，
   * 但他的已读结果是没有留下记录」）。
   *
   * 分发器展开后的后续几次产物不在源节点上，而在带着 `data.__carrierOf = 源节点 id`
   * 的承载节点上（见 `canvasPlacement`）。只读源节点自己的 `assetHash` 会得到 `empty` ——
   * 画布上明明挂着图，agent 却以为没出图、再提交一次。
   */
  it('★★ readResult 跟着承载节点看：分发器自己空、产物在承载节点上也算 ok', () => {
    const { store } = setup()
    const batch = addNode(store, 'batch', { mode: 'image' })
    const carrier = addNode(store, 'generation', {
      mode: 'image',
      assetHash: 'h-carrier',
      __carrierOf: batch,
    })
    const out = readResults(store, [batch])
    expect(out[0]).toMatchObject({
      nodeId: batch,
      status: 'ok',
      outputs: [{ hash: 'h-carrier', mime: 'image/png' }],
      carrierNodeIds: [carrier],
    })
    /** 摘要那一侧也要认这件事，否则 agent 看到的仍是「这个节点没出图」 */
    const summary = readGraphSummary(store, 'all')
    expect(summary.nodes.find((n) => n.id === batch)?.hasOutput).toBe(true)
  })
})

describe('写 / 花钱的工具（只由确认后调用）', () => {
  it('★★ applyPlan 真的把图建出来，并回填自检结果', async () => {
    const { store, ctx } = setup()
    const r = (await executeConfirmedTool(
      'applyPlan',
      {
        /**
         * 一段提示词喂**两个**生成节点：这是「不折」的那种形状（用户在复用这段提示词），
         * 所以这里能同时验到「节点真建了 + 连线真连了 + 自检真跑了」。
         * 单步生成会折掉提示词节点，那一条单独测（见下面那条）。
         */
        summary: '一段提示词出两张图',
        nodes: [
          { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
          { localId: 'g2', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        edges: [
          { source: 'p1', target: 'g1' },
          { source: 'p1', target: 'g2' },
        ],
      },
      ctx,
    )) as { ok: boolean; problems: string[]; createdNodeIds: string[] }

    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.createdNodeIds).toHaveLength(3)
    expect(store.getSnapshot().nodes).toHaveLength(3)
    expect(store.getSnapshot().edges).toHaveLength(2)
  })

  /**
   * ★★ 用户 2026-10-04 第 4 条：「我用 agent 生图的时候卡在了没有写提示词在流程里面，
   * 单独生成图片应该是直接一个生成节点就可以了，然后把提示词输入进去再向我确认生成，
   * 当前是流程是新建了一个提示词节点和连接的生成节点」。
   *
   * 这条走**完整的落地链**（归一化 → 校验 → 建节点 → 自检），不是只看归一化那一步 ——
   * 用户能看到的只是落地之后的画布。
   */
  it('★★ 单步生成落地**只建一个节点**：提示词写在生成节点上，不留中间那个提示词节点', async () => {
    const { store } = setup()
    const asked: string[][] = []
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async () => []),
      defaultsForNewNode: vi.fn(async (types: readonly string[]) => {
        asked.push([...types])
        return { generation: { channelId: 'ch-1', model: 'relay-img' } }
      }),
    } as unknown as AgentToolContext

    const r = (await executeConfirmedTool(
      'applyPlan',
      {
        summary: '提示词 → 生成',
        nodes: [
          { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        edges: [{ source: 'p1', target: 'g1' }],
      },
      ctx,
    )) as { ok: boolean; createdNodeIds: string[] }

    expect(r.ok).toBe(true)
    expect(r.createdNodeIds).toHaveLength(1)
    const g = store.getSnapshot()
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
    expect(g.nodes[0]!.type).toBe('generation')
    expect((g.nodes[0]!.data as Record<string, unknown>).prompt).toBe('橘猫')
    /** 折掉之后**只会问生成节点那一档**：提示词那条配方根本用不上 */
    expect(asked).toEqual([['generation']])
  })

  it('★★ 计划非法 → 不落地，把逐条错误回填（模型据此改）', async () => {
    const { store, ctx } = setup()
    const r = (await executeConfirmedTool(
      'applyPlan',
      { summary: 'x', nodes: [{ localId: 'a', type: '不存在的类型', data: {}, order: 0 }], edges: [] },
      ctx,
    )) as { ok: boolean; problems: string[] }

    expect(r.ok).toBe(false)
    expect(r.problems.join()).toContain('不认识')
    expect(store.getSnapshot().nodes).toHaveLength(0)
  })

  /**
   * ★★ 落地前先取默认配方。
   *
   * 这条盯的是「agent 建的节点」与「手建的节点」同源：手建的走
   * `createNodeWithDefaults` 会带上默认渠道 + 模型，agent 这条必须问同一件事，
   * 否则建出来的生成节点是空的 —— 用户点生成只会看到「还没选择渠道」。
   */
  it('★★ applyPlan 会先问默认配方（只问计划里真用到的类型），并写进节点', async () => {
    const { store } = setup()
    const asked: string[][] = []
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async (ids: string[]) => ids.map((nodeId) => ({ nodeId, ok: true }))),
      defaultsForNewNode: vi.fn(async (types: readonly string[]) => {
        asked.push([...types])
        return {
          generation: { channelId: 'ch-1', model: 'relay-img', ratio: '16:9' },
          prompt: { channelId: 'ch-2', model: 'relay-chat' },
        }
      }),
    } as unknown as AgentToolContext

    await executeConfirmedTool(
      'applyPlan',
      {
        /** 同上一组：一段提示词喂两个下游 → 不折，于是「提示词」那一档也真的用得上 */
        summary: '一段提示词出两张图',
        nodes: [
          { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
          { localId: 'g2', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        edges: [
          { source: 'p1', target: 'g1' },
          { source: 'p1', target: 'g2' },
        ],
      },
      ctx,
    )

    // 两种类型各问一次（去重后一起问，不是逐个节点问）
    expect(asked).toEqual([['prompt', 'generation']])
    const nodes = store.getSnapshot().nodes
    const gen = nodes.find((n) => n.type === 'generation')!.data as Record<string, unknown>
    expect(gen.channelId).toBe('ch-1')
    expect(gen.model).toBe('relay-img')
    expect(gen.ratio).toBe('16:9')
  })

  /**
   * ★★ 用户点选的**图片 / 视频模型**要按节点用途落到节点上
   * （用户 2026-10-03：「我创作面板有什么模型就用什么模型，分了图片和视频…模型有三个
   * 选项」）。两个档位一个都别串：文生图拿图片模型、图生视频拿视频模型。
   */
  it('★★ 图片 / 视频两档模型按节点用途分别落上（不串档）', async () => {
    const { store } = setup()
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async () => []),
      defaultsForNewNode: vi.fn(async () => ({
        generation: { channelId: 'ch-default', model: 'default-model' },
      })),
      recipeForGenerated: (_type: string, node: { data: Record<string, unknown> }) =>
        node.data.mode === 'video'
          ? { channelId: 'ch-v', model: 'Video Model' }
          : { channelId: 'ch-i', model: 'Image Model' },
    } as unknown as AgentToolContext

    await executeConfirmedTool(
      'applyPlan',
      {
        summary: '一张图 + 一段视频',
        nodes: [
          /** 各带正文：这里要验的是**选路**，不然后面那条「跑不起来的生成节点」会把计划拦下 */
          { localId: 'g1', type: 'generation', data: { mode: 'image', prompt: '一只猫' }, order: 0 },
          { localId: 'g2', type: 'generation', data: { mode: 'video', prompt: '一段猫' }, order: 1 },
        ],
        edges: [],
      },
      ctx,
    )

    const dataOf = (mode: string) =>
      store
        .getSnapshot()
        .nodes.filter((n) => n.type === 'generation')
        .map((n) => n.data as Record<string, unknown>)
        .find((d) => d.mode === mode)
    expect(dataOf('image')).toMatchObject({ channelId: 'ch-i', model: 'Image Model' })
    expect(dataOf('video')).toMatchObject({ channelId: 'ch-v', model: 'Video Model' })
  })

  it('★ 计划里自己写了模型时以计划为准（他当场点名的优先，§11）', async () => {
    const { store } = setup()
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async () => []),
      defaultsForNewNode: vi.fn(async () => ({
        generation: { channelId: 'ch-default', model: 'default-model' },
      })),
      recipeForGenerated: () => ({ channelId: 'ch-i', model: 'Image Model' }),
    } as unknown as AgentToolContext

    await executeConfirmedTool(
      'applyPlan',
      {
        summary: 'x',
        nodes: [
          {
            localId: 'g1',
            type: 'generation',
            data: { mode: 'image', model: 'Plan Model', prompt: '一只猫' },
            order: 0,
          },
        ],
        edges: [],
      },
      ctx,
    )
    const gen = store
      .getSnapshot()
      .nodes.find((n) => n.type === 'generation')!.data as Record<string, unknown>
    expect(gen.model).toBe('Plan Model')
  })

  it('★★ 用户本轮 @ 的模型压过参考图旧模型，并进入 applyPlan 自检', async () => {
    const { store, ctx } = setup()
    const source = addNode(store, 'generation', {
      mode: 'image',
      model: 'Nano Banana 2.1',
      ratio: '16:9',
      quality: 'high',
    })
    const explicitCtx: AgentToolContext = {
      ...ctx,
      defaultsForNewNode: vi.fn(async () => ({
        generation: { channelId: 'ch-default', model: 'Nano Banana 2.1' },
      })),
      recipeForGenerated: () => ({
        channelId: 'ch-default',
        model: 'Nano Banana 2.1',
      }),
      explicitRecipeForGenerated: () => ({
        channelId: 'ch-user',
        model: 'GPT Image 2',
      }),
    }

    const result = (await executeConfirmedTool(
      'applyPlan',
      {
        summary: '用用户点名的模型生成一张',
        attach: [{ localId: 'src', existingNodeId: source }],
        nodes: [
          { localId: 'src', type: 'generation', data: {}, order: 0 },
          {
            localId: 'g1',
            type: 'generation',
            data: { mode: 'image', prompt: '海边玩水' },
            order: 1,
          },
        ],
        edges: [{ source: 'src', target: 'g1' }],
      },
      explicitCtx,
    )) as { ok: boolean; problems: string[]; createdNodeIds: string[] }

    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    const data = store.getSnapshot().nodes.find((node) => node.id === result.createdNodeIds[0])!
      .data as Record<string, unknown>
    expect(data).toMatchObject({
      channelId: 'ch-user',
      model: 'GPT Image 2',
      ratio: '16:9',
      quality: 'high',
    })
  })

  it('★★ applyPlan 自检会拦住“实际写入模型与用户点名不一致”', async () => {
    const { store, ctx } = setup()
    const source = addNode(store, 'generation', { mode: 'image', model: 'Nano Banana 2.1' })
    let explicitCalls = 0
    const explicitCtx: AgentToolContext = {
      ...ctx,
      defaultsForNewNode: vi.fn(async () => ({
        generation: { channelId: 'ch-default', model: 'Nano Banana 2.1' },
      })),
      explicitRecipeForGenerated: () => ({
        channelId: 'ch-user',
        model: explicitCalls++ === 0 ? 'GPT Image 2' : 'Another Model',
      }),
    }

    const result = (await executeConfirmedTool(
      'applyPlan',
      {
        summary: '模型自检',
        attach: [{ localId: 'src', existingNodeId: source }],
        nodes: [
          { localId: 'src', type: 'generation', data: {}, order: 0 },
          {
            localId: 'g1',
            type: 'generation',
            data: { mode: 'image', prompt: '一只猫' },
            order: 1,
          },
        ],
        edges: [{ source: 'src', target: 'g1' }],
      },
      explicitCtx,
    )) as { ok: boolean; problems: string[] }

    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('明确要求使用 Another Model')
    expect(result.problems.join('\n')).toContain('实际写入的是 GPT Image 2')
  })

  it('★ updateNode 改参数；节点不存在则如实报错', async () => {
    const { store, ctx } = setup()
    const id = addNode(store, 'generation', { mode: 'image' })
    expect(await executeConfirmedTool('updateNode', { nodeId: id, data: { ratio: '16:9' } }, ctx)).toEqual(
      { ok: true },
    )
    const r = (await executeConfirmedTool('updateNode', { nodeId: 'gone', data: {} }, ctx)) as {
      ok: boolean
    }
    expect(r.ok).toBe(false)
  })

  it('★★ updateNode 只认模型，渠道由系统反查并覆盖模型自己的错误 channelId', async () => {
    const { store, ctx } = setup()
    const id = addNode(store, 'generation', {
      mode: 'image',
      channelId: 'ch-builtin-wrong',
      model: 'Old',
    })
    const routed = {
      ...ctx,
      channelIdForModel: vi.fn(() => 'ch-soon'),
    } satisfies AgentToolContext
    expect(
      await executeConfirmedTool(
        'updateNode',
        {
          nodeIds: [id],
          data: { channelId: 'ch-builtin-wrong', model: 'GPT Image 2' },
        },
        routed,
      ),
    ).toEqual({ ok: true })
    expect(store.getSnapshot().nodes.find((n) => n.id === id)!.data).toMatchObject({
      channelId: 'ch-soon',
      model: 'GPT Image 2',
    })
  })

  it('★★ updateNode 找不到模型渠道时整批不改，不留下空渠道', async () => {
    const { store, ctx } = setup()
    const id = addNode(store, 'generation', {
      mode: 'image',
      channelId: 'ch-old',
      model: 'Old',
    })
    const blocked = {
      ...ctx,
      channelIdForModel: vi.fn(() => undefined),
    } satisfies AgentToolContext
    expect(
      await executeConfirmedTool(
        'updateNode',
        { nodeIds: [id], data: { channelId: '', model: 'GPT Image 2' } },
        blocked,
      ),
    ).toMatchObject({ ok: false })
    expect(store.getSnapshot().nodes.find((n) => n.id === id)!.data).toMatchObject({
      channelId: 'ch-old',
      model: 'Old',
    })
  })

  /**
   * ★★ **出过图的节点，正文不许覆盖**（用户 2026-10-05 第五批第 4 条：
   * 「agent 提出的需求应该先新建节点，然后把提示词放在新建节点上，而不是把提示词覆盖原有的节点，
   * 这样才会有原本的记录，否则第一个图片的提示词直接被覆盖了」）。
   *
   * 这是**确定性拦截**：不指望模型自觉。真机上它就是用 updateNode 把
   * 「小猫钓鱼」那句整句换成了「小狗钓鱼」——用户的上一版提示词永久消失。
   * 参数（比例 / 张数 / 模型）仍然可以改：那本来就是让用户随时调的。
   */
  it('★★ updateNode 不许覆盖「已出图」节点的正文；改参数与草稿节点不受影响', async () => {
    const { store, ctx } = setup()
    const id = addNode(store, 'generation', {
      mode: 'image',
      prompt: '小猫钓鱼',
      assetHash: 'h1',
    })
    const refused = (await executeConfirmedTool(
      'updateNode',
      { nodeId: id, data: { prompt: '小狗钓鱼' } },
      ctx,
    )) as { ok: boolean; problems?: string[] }
    expect(refused.ok).toBe(false)
    expect(refused.problems?.join(' ')).toContain('新建')
    /** 正文一个字都没改 */
    expect(
      (store.getSnapshot().nodes.find((n) => n.id === id)!.data as { prompt: string }).prompt,
    ).toBe('小猫钓鱼')

    /** ① 参数照旧可改 */
    expect(
      await executeConfirmedTool('updateNode', { nodeId: id, data: { ratio: '16:9' } }, ctx),
    ).toEqual({ ok: true })

    /** ② 还没出图的节点：正文就是草稿，随便改 */
    const draftId = addNode(store, 'generation', { mode: 'image', prompt: '草稿' })
    expect(
      await executeConfirmedTool('updateNode', { nodeId: draftId, data: { prompt: '改草稿' } }, ctx),
    ).toEqual({ ok: true })
  })

  it('★★ runNode 走注入的执行层（agent 自己不直接发渠道请求）', async () => {
    const { store, ctx, runNodes } = setup()
    const id = addNode(store, 'generation', { mode: 'image' })
    const signal = new AbortController().signal
    const r = (await executeConfirmedTool(
      'runNode',
      { nodeIds: [id] },
      { ...ctx, signal },
    )) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(runNodes).toHaveBeenCalledWith([id], signal)
  })

  it('★★ runNode 用本轮 applyPlan 的 localId 别名时，会确定性解析成真实节点 id', async () => {
    const { store, ctx, runNodes } = setup()
    const id = addNode(store, 'generation', { mode: 'image' })
    const r = (await executeConfirmedTool(
      'runNode',
      { nodeIds: ['gen_sheet'] },
      {
        ...ctx,
        resolveNodeIds: (ids) => ids.map((nodeId) => (nodeId === 'gen_sheet' ? id : nodeId)),
      },
    )) as { ok: boolean; outcomes: { nodeId: string }[] }
    expect(r.ok).toBe(true)
    expect(runNodes).toHaveBeenCalledWith([id], undefined)
    expect(r.outcomes[0]?.nodeId).toBe(id)
  })

  it('★★ runNode 把失败节点原样回报，不能把失败当成功', async () => {
    const { store, ctx } = setup()
    const id = addNode(store, 'generation', { mode: 'image' })
    const runNodes = vi.fn(async () => [
      {
        nodeId: id,
        ok: false,
        status: 'failed' as const,
        error: '服务端返回错误（HTTP 451）：识别到您当前网络处于暂不支持的地区',
        channelId: 'ch-comfly',
        model: 'gpt-image-2.5-sunburst',
      },
    ])
    const r = (await executeConfirmedTool('runNode', { nodeIds: [id] }, { ...ctx, runNodes })) as {
      ok: boolean
      outcomes: unknown[]
    }
    expect(r.ok).toBe(false)
    expect(r.outcomes[0]).toMatchObject({
      ok: false,
      status: 'failed',
      channelId: 'ch-comfly',
      model: 'gpt-image-2.5-sunburst',
    })
  })

  it('★★ runFrom 沿连线收起点与全部下游，但跳过提示词中间节点', () => {
    const { store } = setup()
    const prompt = addNode(store, 'prompt', { text: '橘猫' })
    const start = addNode(store, 'generation', { mode: 'image', prompt: '起点' })
    const middle = addNode(store, 'generation', { mode: 'image', prompt: '中间' })
    const end = addNode(store, 'generation', { mode: 'image', prompt: '终点' })
    store.dispatch({ kind: 'edge.connect', source: prompt, target: start })
    store.dispatch({ kind: 'edge.connect', source: start, target: middle })
    store.dispatch({ kind: 'edge.connect', source: middle, target: end })

    expect(runFromNodeIds(store, [start])).toEqual({ ok: true, ids: [start, middle, end] })
  })

  it('★★ runFrom 遇到批量 / 循环时分发器不展开，明确让模型改用 runNode', () => {
    const { store } = setup()
    const batch = addNode(store, 'batch', { prompt: '批量' })
    const downstream = addNode(store, 'generation', { mode: 'image', prompt: '下游' })
    store.dispatch({ kind: 'edge.connect', source: batch, target: downstream })

    const r = runFromNodeIds(store, [batch])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems[0]).toContain('runNode')
  })

  it('★★ runFrom 执行时把解析出的整条下游交给注入的执行层', async () => {
    const { store, ctx, runNodes } = setup()
    const start = addNode(store, 'generation', { mode: 'image', prompt: '起点' })
    const end = addNode(store, 'generation', { mode: 'image', prompt: '终点' })
    store.dispatch({ kind: 'edge.connect', source: start, target: end })

    const r = (await executeConfirmedTool('runFrom', { nodeIds: [start] }, ctx)) as {
      ok: boolean
      outcomes: { nodeId: string; ok: boolean }[]
    }

    expect(r.ok).toBe(true)
    expect(runNodes).toHaveBeenCalledWith([start, end], undefined)
    expect(r.outcomes.map((o) => o.nodeId)).toEqual([start, end])
  })
})

/**
 * 落地前的**内容**把关：生成节点必须拿得到提示词。
 *
 * 用户 2026-10-04：「他给我的是一个提示词节点连接两个生图节点，整体的流程是对的，
 * 但是没有提示词」。形状校验（类型 / 连线 / order）全过，可内容是空的 ——
 * `generationSpec.toRunRequest` 在提示词为空时直接返回 null，
 * 这种节点点多少次都不会发请求，落地了也只是给用户一张跑不动的图。
 */
describe('planProblems · 跑不起来的生成节点', () => {
  const plan = (nodes: unknown[], edges: unknown[] = []) => ({
    summary: 's',
    nodes,
    edges,
  })

  it('★★ 生成节点自己没有正文、上游也没有能给文字的节点 → 拦下，并说清怎么办', () => {
    const r = planProblems(
      plan([{ localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 0 }]),
      [],
    )
    expect(r.plan).toBeNull()
    expect(r.problems.join()).toContain('提示词')
    expect(r.problems.join()).toContain('data.prompt')
  })

  it('★ 上游接着提示词节点（模板形态，正文在上游）→ 放行', () => {
    const r = planProblems(
      plan(
        [
          { localId: 'p1', type: 'prompt', data: { text: '一只猫' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        [{ source: 'p1', target: 'g1' }],
      ),
      [],
    )
    expect(r.problems).toEqual([])
    expect(r.plan).not.toBeNull()
  })

  it('★ 自己带着正文 → 放行（不需要上游）', () => {
    const r = planProblems(
      plan([
        { localId: 'g1', type: 'generation', data: { mode: 'image', prompt: '一只猫' }, order: 0 },
      ]),
      [],
    )
    expect(r.problems).toEqual([])
  })

  it('★ 上游是 attach 过来的既有节点 → 不去猜它的内容（放行）', () => {
    const r = planProblems(
      {
        ...plan(
          [
            { localId: 'p_old', type: 'prompt', data: {}, order: 0 },
            { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
          ],
          [{ source: 'p_old', target: 'g1' }],
        ),
        attach: [{ localId: 'p_old', existingNodeId: 'node_old' }],
      },
      ['node_old'],
    )
    expect(r.problems).toEqual([])
  })

  /**
   * ★★ 真机事故那条路走一遍**完整落地链**：正文写错字段的计划，落地后提示词节点里
   * 必须有字（而不是一个空框）。
   *
   * 形状与用户 2026-10-04 的实测一致：「提示词节点连接两个生图节点」，
   * 正文落在 `data.prompt` 上（提示词节点读的是 `data.text`）。
   */
  it('★★ 正文写错字段的计划落地后，提示词节点里真的有字', async () => {
    const { store, ctx } = setup()
    const r = (await executeConfirmedTool(
      'applyPlan',
      {
        summary: '一份正文写错字段的计划',
        nodes: [
          { localId: 'p1', type: 'prompt', data: { prompt: '小狗钓鱼插画，1:1，2k' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
          { localId: 'g2', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        edges: [
          { source: 'p1', target: 'g1' },
          { source: 'p1', target: 'g2' },
        ],
      },
      ctx,
    )) as { ok: boolean; createdNodeIds: string[] }

    expect(r.ok).toBe(true)
    const nodes = store.getSnapshot().nodes
    const prompt = nodes.find((n) => n.type === 'prompt')!.data as Record<string, unknown>
    expect(prompt.text).toBe('小狗钓鱼插画，1:1，2k')
    /** 两个生成节点各留一句空正文、等上游喂词（模板形态），数量与连线都要在 */
    expect(nodes.filter((n) => n.type === 'generation')).toHaveLength(2)
    expect(store.getSnapshot().edges).toHaveLength(2)
  })

  /**
   * ★★ 参数键名写错的那一条：**用户说的比例不能被默认配方盖掉**。
   *
   * 真机原始计划里模型写的是 `aspectRatio: "1:1"`（画布读 `data.ratio`），
   * 于是 `ratio` 落回上一层——默认配方里上一次生成留下的 9:16 ⇒ 出图 1152×2048。
   */
  it('★★ 比例写在 aspectRatio 上：落地后按用户说的走，不被默认配方盖掉', async () => {
    const { store } = setup()
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async () => []),
      /** 默认配方 = 上一次生成留下的 9:16 */
      defaultsForNewNode: vi.fn(async () => ({
        generation: { channelId: 'ch-1', model: 'm1', ratio: '9:16', count: 1 },
      })),
    } as unknown as AgentToolContext

    const r = (await executeConfirmedTool(
      'applyPlan',
      {
        summary: '插画绝世美女（1:1、2K）',
        nodes: [
          {
            localId: 'g1',
            type: 'generation',
            data: { mode: 'image', prompt: '插画绝世美女', aspectRatio: '1:1', resolution: '2k' },
            order: 0,
          },
        ],
        edges: [],
      },
      ctx,
    )) as { ok: boolean }

    expect(r.ok).toBe(true)
    const d = store.getSnapshot().nodes[0]!.data as Record<string, unknown>
    expect(d.ratio).toBe('1:1')
    expect(d.resolution).toBe('2k')
    expect('aspectRatio' in d).toBe(false)
  })
})

describe('Agent 画布空间与现有图像能力', () => {
  it('★★ 按精确坐标移动节点', async () => {
    const { store, ctx } = setup()
    const id = addNode(store, 'generation', { mode: 'image' }, '主图')
    const r = await executeConfirmedTool(
      'moveNodes',
      { nodeIds: [id], positions: [{ nodeId: id, x: 320, y: 180 }] },
      ctx,
    )
    expect(r).toMatchObject({ ok: true, moved: [{ nodeId: id, x: 320, y: 180 }] })
    expect(store.getSnapshot().nodes.find((node) => node.id === id)).toMatchObject({
      x: 320,
      y: 180,
    })
  })

  it('★★ 移动结果压住已有节点时自动向右避让', async () => {
    const { store, ctx } = setup()
    const moving = addNode(store, 'generation', { mode: 'image' }, '移动')
    const occupied = addNode(store, 'generation', { mode: 'image' }, '已有')
    store.dispatch({ kind: 'node.move', ids: [occupied], dx: 500, dy: 300, phase: 'end' })
    await executeConfirmedTool(
      'moveNodes',
      { nodeIds: [moving], positions: [{ nodeId: moving, x: 500, y: 300 }] },
      ctx,
    )
    const after = store.getSnapshot().nodes
    const next = after.find((node) => node.id === moving)!
    const other = after.find((node) => node.id === occupied)!
    expect(next.x).toBeGreaterThanOrEqual(other.x + other.w + 48)
  })

  it('★★ 统一高度时保持原图比例，并避让其它节点', async () => {
    const { store, ctx } = setup()
    const wide = addNode(store, 'generation', { mode: 'image' }, '横图')
    const tall = addNode(store, 'generation', { mode: 'image' }, '竖图')
    store.dispatch({
      kind: 'node.resize',
      id: wide,
      rect: { x: 0, y: 0, w: 320, h: 200 },
      phase: 'end',
    })
    store.dispatch({
      kind: 'node.resize',
      id: tall,
      rect: { x: 360, y: 0, w: 200, h: 300 },
      phase: 'end',
    })
    const r = (await executeConfirmedTool('resizeNodes', {
      nodeIds: [wide, tall],
      height: 400,
    }, ctx)) as { ok: boolean }
    expect(r.ok).toBe(true)
    const [nextWide, nextTall] = store.getSnapshot().nodes
    expect(nextWide).toMatchObject({ h: 400, w: 640 })
    expect(nextTall!.h).toBeCloseTo(400, 6)
    expect(nextTall!.w).toBeCloseTo(266.666, 2)
    expect(nextTall!.x).toBeGreaterThanOrEqual(nextWide!.x + nextWide!.w + 48)
  })

  it('★★ 删除节点与关联连线一步完成，不调用素材删除', async () => {
    const { store, ctx } = setup()
    const source = addNode(store, 'generation', { mode: 'image' }, '上游')
    const target = addNode(store, 'generation', { mode: 'image' }, '下游')
    store.dispatch({ kind: 'edge.connect', source, target })
    const r = (await executeConfirmedTool('deleteNodes', { nodeIds: [source] }, ctx)) as {
      ok: boolean
      deletedNodeIds: string[]
    }
    expect(r.ok).toBe(true)
    expect(r.deletedNodeIds).toContain(source)
    expect(store.getSnapshot().nodes.map((node) => node.id)).toEqual([target])
    expect(store.getSnapshot().edges).toHaveLength(0)
  })

  it('★★ 水平排列同层节点，保留选区左上角', async () => {
    const { store, ctx } = setup()
    const a = addNode(store, 'generation', { mode: 'image' }, 'A')
    const b = addNode(store, 'generation', { mode: 'image' }, 'B')
    store.dispatch({ kind: 'node.move', ids: [b], dx: 100, dy: 80, phase: 'end' })
    const r = await executeConfirmedTool(
      'arrangeNodes',
      { nodeIds: [a, b], layout: 'horizontal', gap: 24 },
      ctx,
    )
    expect(r).toMatchObject({ ok: true, layout: 'horizontal' })
    const nodes = store.getSnapshot().nodes
    expect(nodes.find((node) => node.id === a)?.y).toBe(0)
    expect(nodes.find((node) => node.id === b)?.y).toBe(0)
    expect(nodes.find((node) => node.id === b)!.x).toBeGreaterThan(
      nodes.find((node) => node.id === a)!.x,
    )
  })

  it('★★ 按 readGraph 的真实 edge id 取消连线，不删节点', async () => {
    const { store, ctx } = setup()
    const source = addNode(store, 'prompt', { text: '提示词' }, '提示词')
    const target = addNode(store, 'generation', { mode: 'image' }, '生成')
    store.dispatch({ kind: 'edge.connect', source, target })
    const edgeId = store.getSnapshot().edges[0]!.id

    const r = await executeConfirmedTool('deleteEdges', { edgeIds: [edgeId] }, ctx)
    expect(r).toEqual({ ok: true, deletedEdgeIds: [edgeId] })
    expect(store.getSnapshot().edges).toEqual([])
    expect(store.getSnapshot().nodes).toHaveLength(2)
  })

  it('★★ 把两张已有图片建成 A/B 对比节点并连上两条上游', async () => {
    const { store, ctx } = setup()
    const left = addNode(store, 'generation', { mode: 'image', assetHash: 'ha' }, '左图')
    const right = addNode(store, 'generation', { mode: 'image', assetHash: 'hb' }, '右图')
    const r = (await executeConfirmedTool(
      'compareNodes',
      { leftNodeId: left, rightNodeId: right },
      ctx,
    )) as { ok: boolean; compareNodeId: string }
    expect(r.ok).toBe(true)
    expect(store.getSnapshot().nodes.find((node) => node.id === r.compareNodeId)?.type).toBe(
      'compare',
    )
    expect(store.getSnapshot().edges).toHaveLength(2)
  })

  it('★★ 裁剪 / 选区与宫格切分直接复用画布既有实现', async () => {
    const { store, ctx } = setup()
    const image = addNode(store, 'generation', { mode: 'image', assetHash: 'ha' }, '素材')
    const sliceImage = vi.fn(async () => ({ ok: true, nodeId: 'slice-node' }))
    const splitGrid = vi.fn(async () => ({ ok: true, nodeIds: ['g1', 'g2'] }))
    const toolCtx = { ...ctx, sliceImage, splitGrid }

    expect(
      await executeConfirmedTool(
        'sliceImage',
        { nodeId: image, mode: 'crop', rect: { x: 10, y: 20, w: 100, h: 80 } },
        toolCtx,
      ),
    ).toMatchObject({ ok: true, nodeId: 'slice-node' })
    expect(sliceImage).toHaveBeenCalledWith(
      image,
      'crop',
      { x: 10, y: 20, w: 100, h: 80 },
      undefined,
    )

    expect(
      await executeConfirmedTool('splitGrid', { nodeId: image, rows: 2, cols: 3 }, toolCtx),
    ).toMatchObject({ ok: true, nodeIds: ['g1', 'g2'] })
    expect(splitGrid).toHaveBeenCalledWith(image, 2, 3)
  })
})

/** 取 applyPlan 某个字段的 items.properties（JSON Schema 在类型上是宽泛的 Record） */
function applyPlanItemProps(field: string): Record<string, unknown> {
  const tool = AGENT_TOOLS.find((t) => t.name === 'applyPlan')!
  const params = tool.parameters as {
    properties?: Record<string, { items?: { properties?: Record<string, unknown> } }>
  }
  return params.properties?.[field]?.items?.properties ?? {}
}

/**
 * ★★ **计划的字段名必须出现在模型能看到的地方**（用户 2026-10-06 真机事故）。
 *
 * 事故形态：`applyPlan` 的 `nodes` / `edges` / `attach` 原来都声明成光秃秃的
 * `{ type: 'object' }`，系统提示词里也只有「用 attach 指过去」这种白话 ——
 * **`localId` / `existingNodeId` 这两个真正要填的键名一次都没出现过**。
 * 模型无处可查、只能猜：猜错得到「第 1 条 attach 的 localId 不在计划里：undefined」，
 * 猜不出来就自己编 `cat_ref_1`，或者把画布节点 id 直接当连线起点，**连试六轮都建不成**。
 *
 * 这一组不是在校「schema 写得漂不漂亮」，而是在校**模型有没有可能知道要填什么**。
 * 键名少一个，那条链路就会退化成反复试错 —— 这种缺陷单看运行时是看不出来的
 * （计划能落地、冒烟全绿，因为冒烟里的计划是脚本写死的 JSON，不经过模型）。
 */
describe('★★ applyPlan 的字段名对模型可见', () => {
  it('nodes / edges / attach 的每一项都声明了字段（不是空的 object）', () => {
    for (const field of ['nodes', 'edges', 'attach']) {
      expect(Object.keys(applyPlanItemProps(field)).length).toBeGreaterThan(0)
    }
  })

  it('★ 计划自身要用的键名一个都不少', () => {
    expect(Object.keys(applyPlanItemProps('nodes'))).toEqual(
      expect.arrayContaining(['localId', 'type', 'data', 'order']),
    )
    expect(Object.keys(applyPlanItemProps('edges'))).toEqual(
      expect.arrayContaining(['source', 'target']),
    )
    /** 复用画布已有节点靠的正是这两个键，缺一个模型就只能猜 */
    expect(Object.keys(applyPlanItemProps('attach'))).toEqual(
      expect.arrayContaining(['localId', 'existingNodeId']),
    )
  })

  it('★ 系统提示词里也逐个写到（schema 支持不好的渠道靠它兜底）', () => {
    const prompt = buildAgentSystemPrompt({ nodes: [], edges: [] })
    for (const key of ['localId', 'existingNodeId', 'source', 'target']) {
      expect(prompt).toContain(key)
    }
  })
})

/**
 * ★★ 批量改参数只要**一次确认**（用户 2026-10-06 第七批 #187）。
 *
 * 用户原话：「我说八张都改模型的时候还需要我一个一个的确认，这不符合逻辑，
 * 这种改动应该一次性让我确认即可」。真机截图：「八张都改刚刚的那个模型」后面
 * 跟了 7 次「已改节点参数」—— 每一次都要点确认。
 */
describe('★★ updateNode 批量改（一次确认改完一批）', () => {
  const updateNodeProps = () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'updateNode')!
    const params = tool.parameters as {
      properties?: Record<string, { description?: string }>
      required?: string[]
    }
    return { props: params.properties ?? {}, required: params.required ?? [] }
  }

  it('★★ nodeIds 一次改完一批（不再是「一次一个节点」）', async () => {
    const { store, ctx } = setup()
    const ids = ['a', 'b', 'c'].map(() => addNode(store, 'generation', { mode: 'image' }))
    const r = await executeConfirmedTool(
      'updateNode',
      { nodeIds: ids, data: { model: 'MJ' } },
      { ...ctx, channelIdForModel: vi.fn(() => 'ch-mj') },
    )
    expect(r).toEqual({ ok: true })
    for (const id of ids) {
      expect(
        (store.getSnapshot().nodes.find((n) => n.id === id)!.data as { model?: string }).model,
      ).toBe('MJ')
      expect(
        (store.getSnapshot().nodes.find((n) => n.id === id)!.data as { channelId?: string }).channelId,
      ).toBe('ch-mj')
    }
  })

  it('★★ 批量里只要有一个已出图节点要改正文 → **整批不动**（改一半更难收拾）', async () => {
    const { store, ctx } = setup()
    const draft = addNode(store, 'generation', { mode: 'image', prompt: '草稿' })
    const done = addNode(store, 'generation', { mode: 'image', prompt: '旧版', assetHash: 'h1' })
    const r = (await executeConfirmedTool(
      'updateNode',
      { nodeIds: [draft, done], data: { prompt: '新正文' } },
      ctx,
    )) as { ok: boolean; problems?: string[] }
    expect(r.ok).toBe(false)
    expect(r.problems?.join(' ')).toContain('新建')
    /** 草稿那一个也**没被动**过 */
    expect(
      (store.getSnapshot().nodes.find((n) => n.id === draft)!.data as { prompt: string }).prompt,
    ).toBe('草稿')
  })

  it('★★ schema 声明了 nodeIds 并写清「都改时用它」；提示词里也说了一遍', () => {
    const { props } = updateNodeProps()
    expect(Object.keys(props)).toContain('nodeIds')
    expect(String(props.nodeIds?.description)).toContain('都改')
    expect(buildAgentSystemPrompt({ nodes: [], edges: [] })).toContain('nodeIds')
  })
})

/**
 * ★★ 「多张图各自一条流程」的**确定性检查**（用户 2026-10-06 第七批 #183）。
 *
 * 用户原话：「明明是单独的两个需求他给我替换成了一个需求」。
 * 提示词里写了硬约束，但真机上模型照样把两张图并成一条 —— 所以这里再拦一道：
 * 用户 @ 了 ≥2 张有图的节点、又没说「合成」时，**生成节点数少于图数**就把计划退回。
 */
describe('★★ applyPlan：多张图要各自一条流程（perImage）', () => {
  /** 两张被复用的图 + N 个新建生成节点 */
  const planFor = (generations: number, imageIds: readonly string[]): AgentPlan => ({
    summary: '两张图各自换 3D 材质',
    nodes: [
      { localId: 's1', type: 'generation', data: {}, order: 0 },
      { localId: 's2', type: 'generation', data: {}, order: 1 },
      ...Array.from({ length: generations }, (_, i) => ({
        localId: `g${i + 1}`,
        type: 'generation' as const,
        data: { prompt: `第 ${i + 1} 张换材质` },
        order: 2 + i,
      })),
    ],
    edges: [{ source: 's1', target: 'g1' }],
    attach: [
      { localId: 's1', existingNodeId: imageIds[0]! },
      { localId: 's2', existingNodeId: imageIds[1]! },
    ],
  })

  const twoImageCtx = () => {
    const { store, ctx } = setup()
    addNode(store, 'generation', { mode: 'image', assetHash: 'h1' })
    addNode(store, 'generation', { mode: 'image', assetHash: 'h2' })
    const ids = store.getSnapshot().nodes.map((n) => n.id)
    return { store, ctx, ids }
  }

  it('★★ 只建 1 个生成节点 → 退回让模型重做（两个需求不能被办成一个）', async () => {
    const { ctx, ids } = twoImageCtx()
    const r = (await executeConfirmedTool('applyPlan', planFor(1, ids), {
      ...ctx,
      perImage: true,
    })) as { ok: boolean; problems?: string[] }
    expect(r.ok).toBe(false)
    expect(r.problems?.join(' ')).toContain('一张图配一个生成节点')
  })

  it('★ 建够 2 个就放行（一张配一个）', async () => {
    const { store, ctx, ids } = twoImageCtx()
    const before = store.getSnapshot().nodes.length
    await executeConfirmedTool('applyPlan', planFor(2, ids), { ...ctx, perImage: true })
    /** 两个生成节点都真落地了（attach 的那两张不新建） */
    expect(store.getSnapshot().nodes.length).toBe(before + 2)
  })

  it('★ 用户没说「各自」（perImage 未设）时不拦 —— 合并成一张是合法需求', async () => {
    const { ctx, ids } = twoImageCtx()
    const r = (await executeConfirmedTool('applyPlan', planFor(1, ids), ctx)) as { ok: boolean }
    expect(r.ok).toBe(true)
  })
})
