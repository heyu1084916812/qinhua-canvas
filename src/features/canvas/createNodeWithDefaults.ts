import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { NodeType } from '../../domain/canvas/model/node'
import type { ChannelStore } from '../../state/channel/channelStore'
import { newGeneratingNodeData } from '../../domain/canvas/nodeSpecs/newNodePreset'
import { generationParams } from '../../domain/canvas/nodeSpecs/params'
import type { GenerationData } from '../../domain/canvas/model/node'

/**
 * 「新建节点」的唯一实现：解析默认配方 → 落成节点 → 记回配方。
 *
 * ## 为什么必须收成一个函数（用户 2026-09-23 实测踩到）
 *
 * 新建生成节点原先有**三个入口**，各自 `dispatch(node.create)`：
 *   1. 左栏「＋」菜单        —— 只有这一处带了默认配方
 *   2. 画布空白**右键**菜单   —— 裸 `node.create`，data 是空的
 *   3. 拖线到空白「新建并连接」—— 同样裸 `node.create`
 *
 * 于是用户从 2 / 3 建出来的节点没有渠道与模型，后面的「改参数就记住」
 * 因为配方守卫（要求渠道 + 模型齐全）一条都记不上——
 * 表现就是「我明明改了参数，新建的节点还是没带上」。
 *
 * **同一个功能有 N 个入口、却只在其中一个入口生效**，是这类缺陷的固定来源。
 * 收敛到一个函数后，新增入口只需调它，不会再有「漏了某个入口」。
 *
 * ## 落点
 *
 * - 解析默认值：`channels.defaultForNewNode`（与创作面板兜底同一条解析链）
 * - 记录配方：把**真正落进节点**的那套值写回该渠道，供下一个节点继承
 */
export async function createNodeWithDefaults(opts: {
  store: CanvasStore
  channels: ChannelStore
  projectId: string
  type: NodeType
  at: { x: number; y: number }
  /** 额外数据（提示词节点等）；会与默认配方合并 */
  extraData?: Record<string, unknown>
  /** 气泡节点（分组）等不需要默认配方的类型传 false */
  withDefaults?: boolean
}): Promise<string | null> {
  const { store, channels, projectId, type, at, extraData, withDefaults = true } = opts
  const data = await resolveDefaults({ channels, type, extraData, withDefaults })
  const id = applyDefaults({ store, channels, projectId, type, at, data })
  if (id) store.setSelection([id])
  return id
}
/**
 * 需要「渠道 + 模型」默认值的类型。
 *
 * ⚠️ **白名单而不是黑名单**（2026-09-23 实测踩到）：`node.create` 的 data 是
 * **整体替换** `spec.createDefaultData()`，不是合并。先前无条件给每个类型注入
 * `{channelId, model}`，会把气泡节点自己的默认结构整份挤掉。
 *
 * 所以只对**真正需要配方**的类型注入；其余类型一个字都不加，完全交给 spec 默认值。
 */
const TYPES_WITH_RECIPE: ReadonlySet<NodeType> = new Set<NodeType>([
  'generation',
  'batch',
  'prompt',
])

/**
 * 预解析缺省配方（异步部分单独拿出来）。
 *
 * 为什么要拆：`node.create` 有时必须和别的命令**同步**拼在一个事务里
 * （拖线到空白「新建并连接」= 建节点 + 连线，要求一次撤销）。
 * 而解析配方要读库（异步）。若把 await 夹在 `beginPlan` / `endPlan` 之间，
 * 事务边界会被让出，撤销就断成两步——建出来的节点与连线不再是一个整体。
 *
 * 所以流程拆成两段：先 `resolveDefaults()`（异步，事务外）→
 * 再 `applyDefaults()`（纯内存，可安全放进同步事务）。
 */
export async function resolveDefaults(opts: {
  channels: ChannelStore
  type: NodeType
  extraData?: Record<string, unknown>
  withDefaults?: boolean
}): Promise<Record<string, unknown>> {
  const { channels, type, extraData, withDefaults = true } = opts
  let data: Record<string, unknown> = { ...(extraData ?? {}) }
  if (!withDefaults || !TYPES_WITH_RECIPE.has(type)) return data

  const category = type === 'prompt' ? 'chat' : undefined
  const recipe = await channels.defaultForNewNode({}, category)
  if (!recipe) return data

  if (type === 'generation' || type === 'batch') {
    data = { ...newGeneratingNodeData(type, recipe), ...data }
  } else {
    data = { channelId: recipe.channelId, model: recipe.model, ...data }
  }
  return data
}

/**
 * 把解析好的缺省值落成节点，并把「这次真正用的那套」记回配方。
 *
 * **同步**函数（认 store / channels 的当前内存态），可安全放在 `beginPlan` 事务里。
 */
export function applyDefaults(opts: {
  store: CanvasStore
  channels: ChannelStore
  projectId: string
  type: NodeType
  at: { x: number; y: number }
  data: Record<string, unknown>
}): string | null {
  const { store, channels, projectId, type, at, data } = opts

  const res = store.dispatch({
    kind: 'node.create',
    projectId,
    type,
    at,
    ...(Object.keys(data).length > 0 ? { data } : {}),
  })
  const created = res.patches.find((p) => p.op === 'upsert' && p.table === 'nodes') as
    | { row: { id: string } }
    | undefined
  if (!created) return null

  /**
   * 把「这次真正写进节点的那套」记回配方，让下一个新建节点能继承它。
   *
   * 记的是 `data`（落进节点的真实值）而不是解析结果：若某一步对值做了修正 / 过滤，
   * 配方要跟着真实结果走，否则显示与实际又会分叉（本项目栽过）。
   */
  const ch = data.channelId
  const model = data.model
  if (typeof ch === 'string' && typeof model === 'string' && ch && model) {
    if (type === 'generation' || type === 'batch') {
      const d = data as unknown as GenerationData
      void channels.rememberRecipe(ch, model, { mode: d.mode, ...generationParams(d) })
    } else {
      void channels.rememberRecipe(ch, model, {})
    }
  }

  return created.row.id
}
