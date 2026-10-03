/**
 * 固定模型目录（用户 2026-09-27 拍板，产品文档 §6.7 / §6.8）。
 *
 * 用户在创作面板里**只想看到自己认可的几个模型名**，而不是中转站拉回来的
 * 几十上百个 ID。这里就是那份「前端显示名」清单。
 *
 * 关键分工（与 M7-4 同一套机制，不是新机制）：
 *   - `id` = **逻辑名**：前端显示、节点存储、面板比对的都是它；
 *   - 请求发出去时用渠道 `modelMap` 翻译出来的**上游真实 ID**
 *     （例如 `GPT Image 2.5 Flare → gpt-image-2.5-flare`）。
 *
 * 所以这份清单里的名字**不要求与任何中转站一致** —— 用户在设置页逐条映射即可。
 * 这也正是用户原话「这些只是我前端显示的名称」的落点。
 *
 * 纯数据 + 纯函数：不依赖 React / platform / state，可在 node 下单测。
 */

/** 图标归属：面板按它选矢量图标，领域层不碰 React */
export type PresetVendor =
  | 'openai'
  | 'google'
  | 'midjourney'
  | 'bytedance'
  | 'minimax'
  | 'fal'
  | 'alibaba'
  | 'agnes'

export interface PresetModel {
  /** 前端显示名 = 逻辑名（跨站点稳定，请求时经 `modelMap` 翻译） */
  id: string
  category: 'image' | 'chat' | 'video'
  vendor: PresetVendor
  /**
   * 该显示名**已知的上游 ID 写法**（用户 2026-09-27：「`gpt-image-2` 这个和头两个
   * 模型 id 格式不一样，应该是 `GPT Image 2`」）。
   *
   * 用途有两处，缺一用户就会在界面上同时看到「显示名」和「上游 ID」两个条目：
   *  ① **归一显示**：节点上存的是上游 ID（老数据 / 中转站拉回来的）时，
   *     界面按显示名展示 —— `gpt-image-2` → `GPT Image 2`；
   *  ② **去重**：渠道里勾了 `gpt-image-2` 时，它不再单独占一行
   *     （它已经被 `GPT Image 2` 这一行代表了）。
   */
  aliases?: readonly string[]
}

/**
 * 生图六个（用户 2026-09-27 拍板：`Nano Banana 2 Lite` 不要、`GPT Image 2` 要）。
 *
 * 名称写法沿用用户参考图（`GPT Image 2.5 Flare` 而非 OpenAI 官方文档的
 * `GPT-Image-2.5 Flare`）—— 前端显示名由用户拍板，映射表负责对上真实 ID。
 */
export const PRESET_IMAGE_MODELS: readonly PresetModel[] = [
  { id: 'GPT Image 2.5 Flare', category: 'image', vendor: 'openai' },
  { id: 'GPT Image 2.5 Sunburst', category: 'image', vendor: 'openai' },
  /** 用户点名的那个：前端必须是 `GPT Image 2`，不是 `gpt-image-2` */
  { id: 'GPT Image 2', category: 'image', vendor: 'openai', aliases: ['gpt-image-2'] },
  { id: 'Nano Banana Pro', category: 'image', vendor: 'google', aliases: ['gemini-3-pro-image'] },
  { id: 'Nano Banana 2', category: 'image', vendor: 'google', aliases: ['gemini-3.1-flash-image'] },
  { id: 'Midjourney', category: 'image', vendor: 'midjourney' },
]

/**
 * 对话四个（用户 2026-09-27 拍板：OpenAI 三个全要，Google 只留 Gemini 3.8 Flash）。
 *
 * 「最新」的判据是官方文档（OpenAI models 页 / Google Gemini API models 页）
 * 的发布顺序，不是榜单排名 —— 用户要的是「最新的前三个」，不是「最强的三个」。
 */
export const PRESET_CHAT_MODELS: readonly PresetModel[] = [
  { id: 'GPT-6 Astra', category: 'chat', vendor: 'openai', aliases: ['gpt-6-astra'] },
  { id: 'GPT-6 Sol', category: 'chat', vendor: 'openai', aliases: ['gpt-6-sol'] },
  { id: 'GPT-6 Luna', category: 'chat', vendor: 'openai', aliases: ['gpt-6-luna'] },
  { id: 'Gemini 3.8 Flash', category: 'chat', vendor: 'google', aliases: ['gemini-3.8-flash'] },
]

/**
 * 视频五个（用户 2026-09-27：「视频只要前五个先」）。
 *
 * 顺序 = 我给用户的候选顺序：榜单未收录但官方已发的两个放在最前，
 * 其后是 Artificial Analysis Video Arena 文生/图生两张榜的综合前十里的前几名。
 */
export const PRESET_VIDEO_MODELS: readonly PresetModel[] = [
  { id: '即梦 2.5', category: 'video', vendor: 'bytedance', aliases: ['seedance-2.5'] },
  {
    id: 'Gemini Omni Flash 1.1',
    category: 'video',
    vendor: 'google',
    aliases: ['gemini-omni-1.1-flash'],
  },
  { id: 'Minimax H3 Max', category: 'video', vendor: 'fal' },
  { id: 'MiniMax H3', category: 'video', vendor: 'minimax' },
  { id: 'Wan 3.0', category: 'video', vendor: 'alibaba' },
]

/**
 * Agnes 自有模型（用户 2026-10-01）。
 *
 * 为什么单独一组、还排在最前：Agnes 是用户当前的平台，而它的模型名**不属于**
 * 上面那三组里的任何厂商（把 Agnes 的 ID 塞进 `GPT-6 Astra`、`Nano Banana 2`
 * 这类别家显示名里是错的——面板写着 A、实际发 B）。所以给它**自己的显示名**。
 *
 * **对话两个 Flash**：用户 2026-10-03 先按「2.0flash + 3.0flash」上，2026-10-05 第 4 条
 * 又明确「agnes 的对话模型前端**不是 2.0flash 了，是 2.5flash**」：
 *   - 对话 → **`agnes-2.5-flash`**、`agnes-3.0-flash`（`agnes-2.5-pro` 属于按 Pro 系列
 *     刊例价计费的那档，早已从前端清单撤下）。这一版与官方 *pricing* 页对齐：它把
 *     `agnes-2.5-flash` / `agnes-3.0-flash` 列为 `$0`，而 `agnes-2.0-flash` 那页标着
 *     **Deprecated**（「新接入请用 `agnes-2.5-flash`」）—— 上一版「按用户指令先上 2.0」
 *     记的那条待复核，至此结掉。
 *   - **旧写法留成别名**（`Agnes 2.0 Flash` / `agnes-2.0-flash`）：老会话里存过的逻辑名、
 *     老映射表里配过的键、渠道自己上报的 ID，都会被 `presetIdForUpstream` 归一成新显示名
 *     —— 不这么做它们会以「另一个模型」的身份漏回下拉（#121 报过的形态）。
 *   - 生图 → `agnes-image-2.5-flash`（官方写明综合超越 2.1 Flash，当前免费）
 *   - 视频 → `agnes-video-v2.0`（三个视频模型里唯一真出过片的）
 */
export const PRESET_AGNES_MODELS: readonly PresetModel[] = [
  {
    id: 'Agnes 2.5 Flash',
    category: 'chat',
    vendor: 'agnes',
    /** 上游 id + **旧显示名**都当别名：老会话 / 老映射 / 渠道上报的旧名字一并归一 */
    aliases: ['agnes-2.5-flash', 'Agnes 2.0 Flash', 'agnes-2.0-flash'],
  },
  { id: 'Agnes 3.0 Flash', category: 'chat', vendor: 'agnes', aliases: ['agnes-3.0-flash'] },
  {
    id: 'Agnes Image 2.5 Flash',
    category: 'image',
    vendor: 'agnes',
    aliases: ['agnes-image-2.5-flash'],
  },
  { id: 'Agnes Video 2.0', category: 'video', vendor: 'agnes', aliases: ['agnes-video-v2.0'] },
]

export const PRESET_MODELS: readonly PresetModel[] = [
  ...PRESET_AGNES_MODELS,
  ...PRESET_IMAGE_MODELS,
  ...PRESET_CHAT_MODELS,
  ...PRESET_VIDEO_MODELS,
]

/** 某一档的固定显示名（面板按当前类别取用），保持清单顺序 */
export function presetModelsOf(category: PresetModel['category']): PresetModel[] {
  return PRESET_MODELS.filter((m) => m.category === category)
}

/** 某个逻辑名是不是固定目录里的（设置页据此分「固定显示名」与「本站模型」两组） */
export function isPresetModel(name: string): boolean {
  const key = name.trim()
  return PRESET_MODELS.some((m) => m.id === key)
}

/**
 * 某个名字是不是**该类别**的固定显示名。
 *
 * 解析链用它认「这个模型可用」：固定显示名在渠道里通常**没有对应条目**
 * （它正是靠 `modelMap` 翻译的），只按渠道清单判会把一个完全可用的固定名
 * 判成「这个渠道没这个模型」，于是又被兜底覆盖掉。
 */
export function isPresetModelOfCategory(name: string, category?: string): boolean {
  const key = name.trim()
  if (!key) return false
  return PRESET_MODELS.some((m) => m.id === key && (!category || m.category === category))
}

/**
 * 某个显示名**已知的全部上游写法**（含显示名本身）。
 *
 * 选路用它认候选：渠道勾的是 `gpt-image-2`、界面显示 `GPT Image 2`，
 * 两种写法都是「这条渠道有 GPT Image 2」，任一命中即算提供。
 * 非固定名返回它自己（不猜）。
 */
export function upstreamAliasesOf(name: string): string[] {
  const key = name.trim()
  if (!key) return []
  const hit = PRESET_MODELS.find((m) => m.id === key)
  if (!hit) return [key]
  return [hit.id, ...(hit.aliases ?? [])]
}

/**
 * 上游 ID → 它对应的**显示名**。
 *
 * 界面用它在两处收口（见 `PresetModel.aliases`）：把 `gpt-image-2`
 * 显示成 `GPT Image 2`、并让渠道里那条同名模型不再重复占一行。
 * 认不出来就返回原值 —— 未知模型不该被硬塞进某个显示名。
 */
export function presetIdForUpstream(upstreamId: string): string {
  const key = upstreamId.trim()
  if (!key) return key
  for (const m of PRESET_MODELS) {
    if (m.id === key) return m.id
    if (m.aliases?.some((alias) => alias === key)) return m.id
  }
  return key
}
