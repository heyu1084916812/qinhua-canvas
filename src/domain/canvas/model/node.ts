export type NodeType =
  | 'prompt'
  | 'generation'
  | 'compare'
  | 'group'
  | 'batch'
  | 'board'
  | 'loop'
  | 'fusion'

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
   * 历史遗留字段：面板曾经的「草稿」。
   *
   * 2026-09-24 起面板**直接写 `text`**（用户删掉了「写入节点」按钮），
   * 这个字段不再被读取，只在写入时跟着 `text` 一起同步，
   * 以免老数据里残留一个与正文不一致的值。
   */
  draft?: string
  /**
   * 选中的**技能**（用户 2026-09-24：「技能这个功能属于是设定，而不是进行」）。
   *
   * 技能是**设定**：点一下只是选中它（芯片上显示名字），
   * 真正生效是在**点生成**的时候 —— 它的正文作为系统指令参与这次 LLM 调用。
   * 这与「优化 / 翻译 / 反推」相反：那三个是**预设动作**，点了立刻执行。
   *
   * 存 id 而不是整份技能正文：技能在技能库里会被编辑，
   * 存正文等于把那一刻的快照固化进节点，改完技能老节点不会跟着更新。
   */
  skillId?: string
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

/** 矩形（原图像素坐标，整数） */
export interface FusionRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 一条**选区上下文**（产品文档 §6.23）。
 *
 * 它回答的是「这张局部修改图对应原图上的哪一块」，而不是「这张图长什么样」。
 * 之所以要把它和补丁图分开存：补丁会被反复重生成（用户「能进行多次的修改」），
 * 而选区本身不变 —— 把选区存成节点数据，重生成后重新运行融合即可把新版本
 * 融回**同一个位置**，不必再框一次。
 */
export interface FusionContext {
  id: string
  /** 原图素材 hash + 像素尺寸（尺寸用于把选区换算成原图坐标） */
  source: { assetHash: string; width: number; height: number }
  /** 用户框选的局部修改区（原图像素坐标） */
  rect: FusionRect
  /**
   * 参与合成与外扩的矩形。
   *
   * 与 `rect` 的差别：它按 `paddingRatio` **等比**向外扩一圈（给羽化留余量），
   * 并在**贴边时先外扩再平移回图内**（对齐大雄插件的处理，见产品文档 §6.23）。
   *
   * 「等比」是硬要求，不是风格选择：外扩若只按短边加一圈，比例会被改掉，
   * 而补丁是按**用户选的模型比例**出的图 ⇒ 每张补丁都会被比例校验拒掉。
   * 等比外扩让 `paddedRect` 与 `rect` 比例完全相同。
   */
  paddedRect: FusionRect
  /** 外扩比例（宽高各乘 `1 + 2p`），默认 0.08 */
  paddingRatio: number
}

/**
 * 图像融合节点数据（产品文档 §6.23，2026-09-29）。
 *
 * **它自己不调模型**：左侧 `original` 接一张完整原图，右侧 `patch` 接 1–16 张
 * 局部修改图，本地做像素合成后经 `output` 交给下游。故这里没有
 * `channelId` / `model` / `prompt` 那类字段 —— 它不进选路，也不进 `isGeneratableType`。
 */
export interface FusionData {
  /**
   * 选区上下文列表，按提取顺序存（1–16 条）。
   *
   * 「按提取顺序」也是**补丁映射的真相**：第 i 条 `patch` 入边对应第 i 条上下文
   * （连线顺序 = 用户连接的时间顺序）。映射规则写在 `domain/canvas/fusion`，
   * 不做成「每条上下文记住自己的补丁节点 id」——那会在换线 / 复制粘贴时留下
   * 指向不存在节点的悬空引用，而位置映射天然跟着图走。
   */
  contexts: FusionContext[]
  /** 当前在节点内预览 / 编辑的选区 id；无选中为 null */
  activeContextId: string | null
  /** 融合产物（本地像素合成结果落 `assets` 表后的 hash） */
  assetHash?: string
  /** 产物真实像素（供「有内容锁原始比例」与对比预览用，§6.16 同口径） */
  naturalSize?: { width: number; height: number }
  /** 预览区显示的是产物还是原图（「对比原图」，§6.23） */
  compare?: boolean
  /**
   * 「按模型现有比例提取」选中的比例档（如 `'1:1'`）。
   *
   * 空 / 缺省 = 自由框选。选中后新框的选区会被吸附到该比例 ——
   * 这是为了让补丁刚好符合下游模型能出的比例，省掉「出图再裁」一步。
   */
  ratio?: string
}

export type NodeData =
  | PromptData
  | GenerationData
  | CompareData
  | GroupData
  | BatchData
  | BoardData
  | LoopData
  | FusionData

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
