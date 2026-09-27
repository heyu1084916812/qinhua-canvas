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

export interface PresetModel {
  /** 前端显示名 = 逻辑名（跨站点稳定，请求时经 `modelMap` 翻译） */
  id: string
  category: 'image' | 'chat' | 'video'
  vendor: PresetVendor
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
  { id: 'GPT Image 2', category: 'image', vendor: 'openai' },
  { id: 'Nano Banana Pro', category: 'image', vendor: 'google' },
  { id: 'Nano Banana 2', category: 'image', vendor: 'google' },
  { id: 'Midjourney', category: 'image', vendor: 'midjourney' },
]

/**
 * 对话四个（用户 2026-09-27 拍板：OpenAI 三个全要，Google 只留 Gemini 3.8 Flash）。
 *
 * 「最新」的判据是官方文档（OpenAI models 页 / Google Gemini API models 页）
 * 的发布顺序，不是榜单排名 —— 用户要的是「最新的前三个」，不是「最强的三个」。
 */
export const PRESET_CHAT_MODELS: readonly PresetModel[] = [
  { id: 'GPT-6 Astra', category: 'chat', vendor: 'openai' },
  { id: 'GPT-6 Sol', category: 'chat', vendor: 'openai' },
  { id: 'GPT-6 Luna', category: 'chat', vendor: 'openai' },
  { id: 'Gemini 3.8 Flash', category: 'chat', vendor: 'google' },
]

/**
 * 视频五个（用户 2026-09-27：「视频只要前五个先」）。
 *
 * 顺序 = 我给用户的候选顺序：榜单未收录但官方已发的两个放在最前，
 * 其后是 Artificial Analysis Video Arena 文生/图生两张榜的综合前十里的前几名。
 */
export const PRESET_VIDEO_MODELS: readonly PresetModel[] = [
  { id: '即梦 2.5', category: 'video', vendor: 'bytedance' },
  { id: 'Gemini Omni Flash 1.1', category: 'video', vendor: 'google' },
  { id: 'Minimax H3 Max', category: 'video', vendor: 'fal' },
  { id: 'MiniMax H3', category: 'video', vendor: 'minimax' },
  { id: 'Wan 3.0', category: 'video', vendor: 'alibaba' },
]

export const PRESET_MODELS: readonly PresetModel[] = [
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
