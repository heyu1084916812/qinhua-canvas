export type NodeType = 'prompt' | 'generation' | 'compare' | 'group' | 'batch' | 'board' | 'loop'

/** 容器类节点：子节点用 parentId 归属（结果组不在 NodeType 内，见 model/resultGroup.ts） */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['group', 'batch', 'board'])

export interface NodeBase {
  id: string
  projectId: string
  type: NodeType
  /** null = 画布根；否则为所属容器 / 结果组 id */
  parentId: string | null
  /** parentId 为空时是世界坐标，否则是相对父容器的 local 坐标（架构 §5.3） */
  x: number
  y: number
  w: number
  h: number
  title: string
  disabled: boolean
}

export interface PromptData {
  text: string
  /**
   * 创作面板的**草稿**（§6.7「面板 = 工作区」）。
   *
   * 面板文本框、面板里的优化 / 翻译 / 反推都只读写它，**绝不直接碰 `text`**——
   * 节点正文是下游消费的最终提示词，两者必须解耦，否则在面板里起草的中间过程
   * 会实时污染正文。草稿经「写入节点」确认后才落到 `text`（进撤销栈）。
   */
  draft?: string
  upstreamPromptLinked: boolean
  /** 文本 LLM 配置（优化 / 翻译使用，§6.7 第三部分「只能选 LLM 模型」）；未配置为空串，按钮禁用 */
  channelId?: string
  model?: string
}

/**
 * 生成节点产物的 mime。
 *
 * 渠道层返回的图片一律按 PNG 落库，故这是一条**全局事实**而不是某个调用点的私货。
 * 抽成常量是因为它现在有两处消费者（生成节点把自己产物喂给下游、提示词节点把上游图
 * 喂给 LLM），写两遍就会各自漂移——`NodeInput.asset` 的 mime 一旦与实际字节不符，
 * 渠道会把图按错误类型编码发出去。
 */
export const GENERATION_ASSET_MIME = 'image/png'

export interface GenerationData {
  mode: 'image' | 'video'
  assetHash?: string
  /**
   * 产物**真实像素**尺寸（§6.16「有内容锁原始比例」）。
   *
   * 为什么存在 data 里而不是「用时查 assets 表」：脱离结果容器、复制粘贴
   * 这些换算都发生在**纯函数层**（reducer / clipboard），查库会把它们变成异步
   * 并凭空引入「读不到素材怎么办」的分支。有了它，任何一次纯函数换算都能就地
   * 算出「这张图本来该是什么比例」。
   *
   * 仅当产物确实带尺寸信息时写入：视频未解码、渠道未回报 → 字段缺失即不锁比例
   * （退回节点当前尺寸），**不猜**。
   */
  naturalSize?: { width: number; height: number }
  prompt: string
  linkedPromptNodeIds: string[]
  channelId: string
  model: string
  // 图片模式
  ratio?: string
  /**
   * `'auto'` = **不向渠道指定画质**，交给模型决定（与 `quality` 同一口径）。
   * 未设置与显式 `'auto'` 等价——面板一律显示为「自动」。
   */
  resolution?: 'auto' | '1k' | '2k' | '4k'
  quality?: 'auto' | 'low' | 'medium' | 'high'
  count?: number
  // 视频模式
  size?: 'auto' | '480p' | '720p' | '1080p'
  durationSec?: number
  refMode?: 'first-last-frame' | 'all-purpose'
  // 缩略图状态
  thumbOrder: string[]
  upstreamHidden: string[]
}

export interface CompareData {
  leftAssetHash?: string
  rightAssetHash?: string
  splitRatio: number
}

export interface GroupData extends GenerationData {
  childIds: string[]
  hiddenIds: string[]
  hiddenPromptIds: string[]
}

export interface BatchData extends GenerationData {
  contentType: 'media' | 'prompt'
  childIds: string[]
  hiddenIds: string[]
}

export interface StrokePoint {
  x: number
  y: number
  pressure?: number
}

export interface Stroke {
  id: string
  color: string
  width: number
  /** 羽化值（px，§6.13 画笔可调参数）：0 = 硬边，>0 时描边做高斯模糊软化 */
  feather: number
  points: StrokePoint[]
}

export interface TextItem {
  id: string
  x: number
  y: number
  text: string
  size: number
  color: string
  /** 字重（§6.13 文字可调参数），默认 600 与全局 chip 字重一致 */
  weight: number
}

export interface BoardData {
  bg: { color: string; opacity: number }
  strokes: Stroke[]
  texts: TextItem[]
}

/**
 * 循环节点数据（§6.22，2026-09-22）。
 *
 * **它自己不产出任何东西**：只把上游素材按轮次分发给下游，
 * 让同一段下游链路跑 N 次。所以这里没有 `assetHash` / `prompt` 那类"内容"字段，
 * 只有"怎么分发"的参数。
 *
 * `prompts` 是**数组**：多条提示词按轮次取模轮换（写 3 条跑 9 轮 = 1-2-3-1-2-3）。
 * 语义与展开逻辑集中在 `domain/canvas/loop/loopPlan`（纯函数，20 项单测）。
 */
export interface LoopData {
  /** 循环几轮 */
  count: number
  /** 从上游素材的第几张开始（1 起） */
  loopStart: number
  /** 每轮取几张素材 */
  batch: number
  /** 串行 / 并行（并行受执行层并发上限约束） */
  mode: 'serial' | 'parallel'
  /** 是否把上游素材当输入分发（关掉则只循环提示词） */
  useImageInput: boolean
  /** 是否启用提示词（关掉则下游用各自的提示词） */
  usePrompt: boolean
  /** 本节点的提示词，多条：按轮次取模轮换 */
  prompts: string[]
}

export type NodeData =
  | PromptData
  | GenerationData
  | CompareData
  | GroupData
  | BatchData
  | BoardData
  | LoopData

export interface NodeSnapshot<TData extends NodeData = NodeData> extends NodeBase {
  data: TData
}

export function isContainerType(type: NodeType): boolean {
  return CONTAINER_TYPES.has(type)
}

/** 生成类节点：可发起模型调用（对比节点不可生成，画板走内部流水线） */
export function isGeneratableType(type: NodeType): boolean {
  return type === 'prompt' || type === 'generation' || type === 'group' || type === 'batch'
}
