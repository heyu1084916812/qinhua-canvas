export type NodeType =
  | 'prompt'
  | 'generation'
  | 'compare'
  | 'group'
  | 'batch'
  | 'loop'
  | 'fusion'

/** 容器类节点：子节点用 parentId 归属（结果组不在 NodeType 内，见 model/resultGroup.ts） */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['group', 'batch'])

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
   * 图片**尺寸 / 画质档**，允许两种写法（用户 2026-10-03「每个图片模型单独配置」）：
   *
   * - `'auto'` = **不向渠道指定**，交给模型决定（与 `quality` 同一口径）；
   * - 档位：`'1k' | '2k' | '3k' | '4k'`（Agnes Image 2.1 / 2.5 与多数渠道）；
   * - **像素**：`'1024x768'` 这种（Agnes Image 2.0 Flash 只认像素尺寸，没有档位）。
   *
   * 故类型放宽成 `string`：**合法取值由各模型的 `imageParamsFor` 能力表约束**，
   * 面板只摆该模型声明过的值。写死成四档联合会在遇到像素尺寸的模型时
   * 逼着调用方到处 `as`（那正是「类型骗人」的开始）。
   */
  resolution?: string
  quality?: 'auto' | 'low' | 'medium' | 'high'
  /**
   * **背景**（用户 2026-10-03 图一：自动 / 保留背景 / 透明背景）。
   *
   * 取值用 OpenAI 官方的 `background` 枚举（`auto` / `opaque` / `transparent`），
   * 面板只负责中文标签。只有声明支持它的模型才摆这一段。
   */
  background?: string
  /**
   * **Midjourney 独有的风格参数**（用户 2026-10-03 图二那份「高级设置」）。
   *
   * 值域、默认值与「拼成提示词后缀」的规则都在 `domain/canvas/layout/mjParams.ts`
   * （`--stylize` 0–1000 默认 100、`--weird` 0–3000 默认 0、`--chaos` 0–100 默认 0、
   * `--p` 个性化代码）。只有 Midjourney 的面板会写这几个字段，
   * 但**存下来不设限**：换了模型它们只是不参与请求（不静默改写用户数据）。
   */
  mjStylize?: number
  mjWeird?: number
  mjChaos?: number
  mjPersonalize?: string
  /**
   * **预设**与**情绪**（用户 2026-10-05 第 14 条）。
   *
   * 只存 **id**：预设本体（名字、示例小字、会拼进提示词的那句）全在
   * `domain/canvas/layout/presets.ts` 一份表里。存正文的话，预设改一次文案，
   * 老节点就永远停在旧文案上 —— 与技能、模型同一条口径（存 id 不存正文）。
   *
   * `presetOptions` 是二级搭配（目前只有「人像质感调节」的 5 组 × 3 档）。
   * 两者都只影响**这一次生成的提示词**，不参与配方继承（那是画质 / 比例这类
   * 与内容无关的参数）。
   */
  preset?: string
  presetOptions?: Record<string, string>
  emotion?: string
  /**
   * 「情绪调节」认出来的**那张脸在哪里**（归一化：`x/y` 左上角、`w/h` 宽高，全 0–1）。
   *
   * 为什么存下来而不是每次现认：认一次要跑本机模型（认不出还得问模型、甚至让人手动框），
   * 而「这张图里脸在哪」在一张图上是个**既成事实** —— 重复认既慢又可能前后不一致。
   * 灯箱里手动框选写的就是它，面板上的小框也读它。
   *
   * 它进的是**提示词**（见 `presetPromptSuffix`）：把「要改的是哪张脸」说清楚，
   * 而不是让模型自己在一整张图里找。
   */
  faceBox?: { x: number; y: number; w: number; h: number }
  count?: number
  // 视频模式
  /**
   * 视频**清晰度档**，允许各家自己的写法（用户 2026-10-03）：
   * Agnes 是 `720P` / `1080P` / `1K` / `2K`，Seedance 是 `480P` / `720P` / `1080P` / `4K`，
   * MiniMax 是 `480P` / `768P` / `2K`。合法取值由 `videoParamsFor` 的能力表约束，
   * 面板只摆该模型声明过的值 —— 与 `resolution` 同一条口径（写死联合会逼着调用方到处 `as`）。
   */
  size?: string
  /**
   * **视频生成模式**（用户 2026-10-03 图四/图五/图七/图九那种下拉）。
   *
   * 值用各模型官方文档/参考产品里的模式名（`text` / `all-purpose` / `image-to-video` /
   * `first-last-frame` / `image-reference` / `video-edit` / `video-extend` / `ultra-long`），
   * **支持哪几个由模型自己的能力表决定**（`videoParamsFor().modes`）。
   */
  videoMode?: string
  /** 生成音频（图三/图六的「生成音频 开启/关闭」）：只有支持它的模型才摆 */
  generateAudio?: boolean
  durationSec?: number
  refMode?: 'first-last-frame' | 'all-purpose'
  // 缩略图状态
  thumbOrder: string[]
  upstreamHidden: string[]
  /**
   * 这张图自带的裁剪上下文（见 `CropContext`）。
   *
   * 由「提取选区」写在新建的局部图上；此后**沿上游链解析**（`resolveCropContext`），
   * 所以中间再套几个生成节点改图也不会丢。
   */
  cropContext?: CropContext
  /**
   * 「这张图该跟哪张图对比」（目前只有**融合结果**会写）。
   *
   * 融合把一张完整原图 + 若干局部修改图合成成一张新图，产物落成右侧的新节点，
   * 于是「改之前长什么样」在画布上只剩一条连线。用户在灯箱里看大图时想对照原图，
   * 靠连线反推也能做，但**连线是活的状态**（上游换了原图、连线被删都会变），
   * 而「这张结果是从哪张原图融出来的」是**既成事实** —— 所以落库时记下来。
   *
   * 存 hash（不是节点 id）：素材是内容寻址的，复制粘贴 / 换节点都不会让它指错；
   * 找不到这张素材时对比入口自动不出现，不猜。
   */
  compareWith?: string
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
 * **它自己不调模型、也不持有任何图片**：左侧接一张完整原图，右侧那只共用口接
 * 1–16 张**带上下文的局部修改图**，本地像素合成后的产物**落成右侧一个新节点**
 * （参考实现：「结果会通过连线生成在融合节点右侧，不覆盖任何输入图片」）。
 *
 * 所以这里只剩一份设置。早先版本把「选区」和「产物」都存在它身上，都是**错的**：
 * 选区属于图片（`GenerationData.cropContext`，见「提取选区」），产物属于右侧那个新节点。
 */
export interface FusionData {
  /**
   * 是否启用**色彩匹配**（参考实现的融合卡片上就是这个复选框，默认开）。
   *
   * 缺省 / `undefined` = 开：与参考实现一致（它判的是 `node.colorMatch !== false`），
   * 也让老数据自动落在「开」这一侧。关掉只影响这一层增强，羽化照常。
   */
  colorMatch?: boolean
}

/**
 * **图片自带的裁剪上下文**（产品文档 §6.23「提取选区」）。
 *
 * 与 `FusionContext` 是同一件事的两种存法，差别只在**谁持有**：
 * `FusionContext` 是融合节点自己那条选区记录（带 id），本类型是**这张图自己的属性** ——
 * 所以没有 id，它就该跟着图片走：改图、放大、并发、分组、复制粘贴、刷新、导入导出。
 *
 * 两种形态：
 * - `{ full: true }`：**完整图边界**（参考实现的同名标记）。融合产物已经是一张完整图，
 *   从此**不再继承**任何局部上下文，否则第二轮会错误追溯到上一轮的选区；
 *   它也正好让「拿融合结果再提取一个新选区」成为合法操作。
 * - `Omit<FusionContext, 'id'>`：真正的局部图 —— 属于哪张原图、哪个矩形、外扩矩形。
 */
export type CropContext = { full: true } | Omit<FusionContext, 'id'>

export type NodeData =
  | PromptData
  | GenerationData
  | CompareData
  | GroupData
  | BatchData
  | LoopData
  | FusionData

export interface NodeSnapshot<TData extends NodeData = NodeData> extends NodeBase {
  data: TData
}

export function isContainerType(type: NodeType): boolean {
  return CONTAINER_TYPES.has(type)
}

/** 生成类节点：可发起模型调用（对比节点不可生成） */
export function isGeneratableType(type: NodeType): boolean {
  return type === 'prompt' || type === 'generation' || type === 'group' || type === 'batch'
}
