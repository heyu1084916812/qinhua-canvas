/**
 * **视频模型各自的参数能力**（用户 2026-10-03：
 * 「把视频模型对应的每个应该有的参数都单独做，而不是一个固定的参数面板，因为有些模型他不支持」）。
 *
 * 值域**全部有出处**，逐条写在下面，不猜：
 *
 * - **Agnes Video 2.5 / 2.5 Flash**：Agnes 官方文档
 *   （`wiki.agnes-ai.com/en/docs/agnes-video-25`，2026-10-03 实读）——
 *   `mode` = `text` / `keyframe` / `reference`；`seconds` = `"4"`–`"12"`（字符串）；
 *   `size` = `720P` / `1080P` / `1K` / `2K`（**Flash 只认 720P**）；
 *   `aspect_ratio` = 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16（**`auto` 明确不支持**）；
 *   `n` **只支持 1**。文档还列出「传 `width`/`height`/`num_frames` 一律 400」。
 *
 * - **Agnes Video 2.0**：官方站没有它的文档页，但**真令牌实测**过 ——
 *   它不吃 2.5 那套档位参数（收下但不生效），只认像素形态
 *   （`width`/`height`/`num_frames`/`frame_rate`），且 `mode` 是**另一套枚举**
 *   （服务端 400 原文：`Input should be 'ti2vid', 'keyframes' or 'multi_reference'`）。
 *
 * - **即梦（Seedance）/ MiniMax H3 / H3 Max**：Agnes 站点自己**没有**这几家的文档，
 *   值域来自用户 2026-10-03 提供的**参考实现截图**（该站的创作面板，图三～图十一）——
 *   那正是这些模型在该站点上真实可选的档位，比任何第三方文档都准。
 *   参数**形状**按各家官方文档的字段名（Seedance 官方：`ratio` / `resolution` /
 *   `duration` / `generate_audio`），发出去时见 `openaiVideo.ts` 的 `openai-videos` 分支。
 *
 * **`Wan 3.0` 与 `Gemini Omni Flash 1.1` 刻意没有条目**：用户没给参考实现、
 * 我们也拿不到可验证的官方值域，凭空写一套等于把猜的档位钉进代码 ——
 * 它们退回「按渠道上报能力渲染」，缺口记在对账清单里。
 */

/**
 * 视频生成模式的**统一词表**（用户 2026-10-03 图四/图五/图七/图九）。
 *
 * 值取各家参考实现里的叫法，**面板按模型摆子集**：
 * SD2.0 五个、SD2.5 八个、MiniMax H3 四个、H3 Max 三个、Agnes 三个。
 */
export type VideoModeId =
  | 'text'
  | 'all-purpose'
  | 'image-to-video'
  | 'first-last-frame'
  | 'image-reference'
  | 'video-edit'
  | 'video-extend'
  | 'ultra-long'

/**
 * 模式 → 展示名。
 *
 * `beta` 是参考实现里那枚「超长视频 Beta」角标（图五）。
 */
export const VIDEO_MODE_LABELS: Record<VideoModeId, { label: string; beta?: boolean }> = {
  text: { label: '文生视频' },
  'all-purpose': { label: '全能参考' },
  'image-to-video': { label: '图生视频' },
  'first-last-frame': { label: '首尾帧' },
  'image-reference': { label: '图片参考' },
  'video-edit': { label: '视频编辑' },
  'video-extend': { label: '视频续写' },
  'ultra-long': { label: '超长视频', beta: true },
}

/**
 * 参数**方言**：决定这段参数用什么字段名发出去（见 `openaiVideo.ts`）。
 *
 * - `agnes-tier`：Agnes 官方那套 —— `seconds`（字符串）+ `size`（档位）+ `aspect_ratio`
 *   + `mode`（`text`/`keyframe`/`reference`）。2.5 与 2.5 Flash 用；
 * - `agnes-pixel`：老式像素那套 —— `width`/`height`/`num_frames`/`frame_rate`
 *   + `mode`（`ti2vid`/`keyframes`/`multi_reference`）。2.0 用；
 * - `openai-videos`：各家官方字段名那套 —— `ratio` / `resolution` / `duration`
 *   / `generate_audio` / `n`。即梦、MiniMax 用；被 400 拒时适配器会回落 `agnes-tier`。
 */
export type VideoDialect = 'agnes-tier' | 'agnes-pixel' | 'openai-videos'

export interface VideoParamSpec {
  /**
   * 比例档（顺序即界面顺序）。
   *
   * `'auto'` = **自适应**：面板照样摆出这一格，但请求里**不发**画幅字段
   * （Agnes 2.5 明确「`auto` 不支持」，所以那条规则只对声明了 `auto` 的模型成立）。
   */
  ratios: readonly string[]
  /** 清晰度档（`480P` / `720P` / `1080P` / `2K` / `4K`…） */
  sizes: readonly string[]
  /**
   * 时长区间（秒）。
   *
   * **缺省 = 这个模型没有时长参数** ⇒ 面板不摆滑块、请求也不发时长
   * （与「摆一个点了没用的控件」相比，不摆才是实话）。
   */
  seconds?: { readonly min: number; readonly max: number; readonly default: number }
  /** 生成数量档；**只有一档时面板整段不摆** */
  counts: readonly number[]
  /** 该模型支持的模式（顺序即界面顺序） */
  modes: readonly VideoModeId[]
  /** 参考实现里置灰的模式（看得见、选不了） */
  disabledModes?: readonly VideoModeId[]
  /** 是否有「生成音频」开关（图三/图六有，图八/图十没有） */
  supportsAudio: boolean
  dialect: VideoDialect
}

/** 所有视频模型统一的「生成数量」档位（用户 2026-10-03：「数量每个模型统一一下」） */
const VIDEO_COUNTS = [1, 2, 4] as const

/** 即梦 / Seedance 共用的 7 档画幅（用户图三/图六那份，顺序照抄） */
const SEEDANCE_RATIOS = ['auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const

/**
 * Agnes Video 2.5 的 6 档画幅。**没有 `auto`** —— 官方文档把「`aspect_ratio: auto`」
 * 明文列进「不支持、会回 400」那一段，所以面板也不该摆这一格。
 */
const AGNES_VIDEO_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
const AGNES_VIDEO_SECONDS = { min: 4, max: 12, default: 5 } as const

export const VIDEO_PARAM_SPECS: Record<string, VideoParamSpec> = {
  'agnes-video-2.5': {
    ratios: AGNES_VIDEO_RATIOS,
    sizes: ['720P', '1080P', '1K', '2K'],
    seconds: AGNES_VIDEO_SECONDS,
    counts: [1],
    modes: ['text', 'all-purpose', 'first-last-frame'],
    supportsAudio: false,
    dialect: 'agnes-tier',
  },
  /** Flash 的差别是**真差别**：官方文档明写 `size` 只认 `720P`，别的值直接 400 */
  'agnes-video-2.5-flash': {
    ratios: AGNES_VIDEO_RATIOS,
    sizes: ['720P'],
    seconds: AGNES_VIDEO_SECONDS,
    counts: [1],
    modes: ['text', 'all-purpose', 'first-last-frame'],
    supportsAudio: false,
    dialect: 'agnes-tier',
  },
  'agnes-video-v2.0': {
    ratios: AGNES_VIDEO_RATIOS,
    sizes: ['720p', '1080p'],
    seconds: { min: 4, max: 12, default: 5 },
    counts: [1],
    modes: ['text', 'all-purpose', 'first-last-frame'],
    supportsAudio: false,
    dialect: 'agnes-pixel',
  },

  /**
   * **即梦 2.5 = Seedance 2.5**（用户图五/图六，4–30 秒自定义）。
   *
   * 八个模式里「视频编辑」在参考实现里是灰的 —— 照着抄成不可选。
   */
  'seedance-2.5': {
    ratios: SEEDANCE_RATIOS,
    sizes: ['480P', '720P', '1080P'],
    seconds: { min: 4, max: 30, default: 5 },
    counts: VIDEO_COUNTS,
    modes: [
      'text',
      'all-purpose',
      'image-to-video',
      'first-last-frame',
      'image-reference',
      'video-edit',
      'video-extend',
      'ultra-long',
    ],
    disabledModes: ['video-edit'],
    supportsAudio: true,
    dialect: 'openai-videos',
  },
  /**
   * **Seedance 2.0**（用户图三/图四，4–15 秒自定义，五个模式）。
   *
   * 前端清单里暂时没有它的显示名，但渠道那边是能选到的（`doubao-seedance-2.0`
   * 那一类裸 ID 会按原名出现在下拉里）—— 有规格就不至于退回通用档位。
   */
  'seedance-2.0': {
    ratios: SEEDANCE_RATIOS,
    sizes: ['480P', '720P', '1080P', '4K'],
    seconds: { min: 4, max: 15, default: 5 },
    counts: VIDEO_COUNTS,
    modes: ['text', 'all-purpose', 'image-to-video', 'first-last-frame', 'image-reference'],
    disabledModes: ['text'],
    supportsAudio: true,
    dialect: 'openai-videos',
  },

  /** **MiniMax H3**（用户图七/图八）：4 个模式、7 档画幅、768P/2K、5–15 秒、无音频开关 */
  'minimax-h3': {
    ratios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    sizes: ['768P', '2K'],
    seconds: { min: 5, max: 15, default: 5 },
    counts: VIDEO_COUNTS,
    modes: ['text', 'all-purpose', 'image-to-video', 'first-last-frame'],
    disabledModes: ['text'],
    supportsAudio: false,
    dialect: 'openai-videos',
  },
  /** **MiniMax H3 Max**（用户图九/最后两张）：只有「自适应」一档画幅、480P/768P、5–15 秒 */
  'minimax-h3-max': {
    ratios: ['auto'],
    sizes: ['480P', '768P'],
    seconds: { min: 5, max: 15, default: 5 },
    counts: VIDEO_COUNTS,
    modes: ['text', 'image-to-video', 'first-last-frame'],
    disabledModes: ['text'],
    supportsAudio: false,
    dialect: 'openai-videos',
  },
}

/**
 * 前端显示名 / 上游 ID → 规格键（只列我们真在用的那几档）。
 *
 * 上游 ID 那侧**故意列全**：`videoParamsFor` 的两个调用方一个传显示名（面板）、
 * 一个传上游 ID（适配器），两边都必须命中同一份规格，否则会出现
 * 「面板摆 5 档、请求按 3 档发」这种最难查的分叉。
 */
const ALIASES: Record<string, string> = {
  'Agnes Video 2.0': 'agnes-video-v2.0',
  'Agnes Video 2.5': 'agnes-video-2.5',
  'Agnes Video 2.5 Flash': 'agnes-video-2.5-flash',
  '即梦 2.5': 'seedance-2.5',
  'doubao-seedance-2.5': 'seedance-2.5',
  'doubao-seedance-2.0': 'seedance-2.0',
  'MiniMax H3': 'minimax-h3',
  'MiniMax-H3': 'minimax-h3',
  'miniMax-H3': 'minimax-h3',
  'Minimax H3 Max': 'minimax-h3-max',
  'MiniMax H3 Max': 'minimax-h3-max',
  'MiniMax-H3-Max': 'minimax-h3-max',
}

/**
 * 按模型名取规格；**认不出来就返回 `undefined`** —— 界面走通用兜底，不瞎猜。
 *
 * 与 `imageParamsFor` 同款：中转站对同一个模型有一串变体 ID
 * （`doubao-seedance-2.5-xxx` 这种），按前缀归一，免得逐个列举漏掉。
 */
export function videoParamsFor(model: string): VideoParamSpec | undefined {
  const name = String(model ?? '').trim()
  if (!name) return undefined
  const direct = VIDEO_PARAM_SPECS[name] ?? VIDEO_PARAM_SPECS[ALIASES[name] ?? '']
  if (direct) return direct
  const lower = name.toLowerCase()
  if (lower.includes('seedance-2.5')) return VIDEO_PARAM_SPECS['seedance-2.5']
  if (lower.includes('seedance-2.0')) return VIDEO_PARAM_SPECS['seedance-2.0']
  if (lower.includes('minimax-h3-max') || lower.includes('minimax h3 max')) {
    return VIDEO_PARAM_SPECS['minimax-h3-max']
  }
  if (lower.includes('minimax-h3') || lower.includes('minimax h3')) {
    return VIDEO_PARAM_SPECS['minimax-h3']
  }
  if (lower.includes('agnes-video-2.5-flash')) return VIDEO_PARAM_SPECS['agnes-video-2.5-flash']
  if (lower.includes('agnes-video-2.5')) return VIDEO_PARAM_SPECS['agnes-video-2.5']
  if (lower.includes('agnes-video-2.0') || lower.includes('agnes-video-v2.0')) {
    return VIDEO_PARAM_SPECS['agnes-video-v2.0']
  }
  return undefined
}

/**
 * `'auto'` 是「自适应」：**不是宽高比**，请求里不能原样发出去
 * （Agnes 2.5 文档把 `aspect_ratio: auto` 明确列进 400 那一段）。
 */
export function isAutoRatio(ratio: unknown): boolean {
  const v = String(ratio ?? '').trim().toLowerCase()
  return v === 'auto' || v === '自适应'
}
