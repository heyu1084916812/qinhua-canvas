/**
 * **视频模型各自的参数能力**（用户 2026-10-03：
 * 「我可能需要把视频模型对应的每个应该有的参数都单独做，而不是一个固定的参数面板，
 *   因为有些模型他不支持」）。
 *
 * 值域**全部来自 Agnes 官方文档**（`wiki.agnes-ai.com/en/docs/agnes-video-25`，
 * 2026-10-03 实读），不是猜的：
 *
 * | 参数 | 支持 |
 * | --- | --- |
 * | `mode` | `text` / `keyframe` / `reference` |
 * | `seconds` | `"4"`–`"12"`，默认 `"5"` |
 * | `size` | `720P` / `1080P` / `1K` / `2K`（**Flash 只能 720P**）；`1K` = 1024×1024 |
 * | `aspect_ratio` | **只有 6 档**：`21:9` `16:9` `4:3` `1:1` `3:4` `9:16`（默认 16:9） |
 * | `n` | **只支持 1** |
 *
 * 文档还明确写了两条「不支持」：`aspect_ratio` 给 `auto` 或列表外的值会报错；
 * `WIDTHxHEIGHT` 这种像素写法也不支持 —— 我们面板原来那 13 档（含「跟随素材」、
 * 3:2、2:3、4:5、1:2…）里有一大半是这个模型根本不认的。
 */
export interface VideoParamSpec {
  /** `aspect_ratio` 的支持档位（顺序即界面顺序） */
  ratios: readonly string[]
  /** `size` 的支持档位 */
  sizes: readonly string[]
  /** `seconds` 的范围与默认值（秒） */
  seconds: { readonly min: number; readonly max: number; readonly default: number }
  /** `n` 的支持张数（Agnes 只支持 1） */
  count: number
  /** 支持的 `mode`（不支持的要在面板上藏掉，也不许发） */
  modes: readonly ('text' | 'keyframe' | 'reference')[]
  /**
   * **参数方言**：这个模型认哪一套「尺寸 / 比例」写法。
   *
   * - `tier`：官方 2.5 文档那套 —— `size` 给档位字符串（`720P` / `1080P` / `1K` / `2K`）+
   *   `aspect_ratio`；
   * - `pixel`：老形态那套 —— `width` / `height` / `num_frames` / `frame_rate`，比例与尺寸
   *   由 `agnesVideoDimensions(ratio, size)` 换算成像素。
   *
   * 为什么必须按模型分开（2026-10-03 用真令牌打 `apihub.agnes-ai.com` 实测）：
   * 同一个 host 上 `agnes-video-v2.0` **收下**了 `size:"720P" + aspect_ratio:"16:9"` 却
   * **无视它们**，任务回填的是默认 `1088x832`；换成像素形态发 `1280x720 + num_frames`，
   * 回填的就是 `1280x704`（吸附到 32 的倍数）、时长也按帧数算。
   * 也就是说：**给 2.0 发档位参数 = 用户选的尺寸和比例被静默丢掉**。
   */
  dialect: 'tier' | 'pixel'
}

/** Agnes 全系的通用档位（比例 6 档、时长 4–12 秒） */
const AGNES_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
const AGNES_SECONDS = { min: 4, max: 12, default: 5 } as const

/**
 * 模型 → 规格。键同时接受**上游 ID**（渠道里那个）与**前端显示名**，
 * 因为调用方手上可能是任一种（面板用显示名，执行层用上游 ID）。
 */
export const VIDEO_PARAM_SPECS: Record<string, VideoParamSpec> = {
  'agnes-video-2.5': {
    ratios: AGNES_RATIOS,
    sizes: ['720P', '1080P', '1K', '2K'],
    seconds: AGNES_SECONDS,
    count: 1,
    modes: ['text', 'keyframe', 'reference'],
    dialect: 'tier',
  },
  'agnes-video-2.5-flash': {
    ratios: AGNES_RATIOS,
    sizes: ['720P'],
    seconds: AGNES_SECONDS,
    count: 1,
    modes: ['text', 'keyframe', 'reference'],
    dialect: 'tier',
  },
  /**
   * **Agnes Video 2.0** —— 用户 2026-10-03：「我现在只有 agnes video 2.0，不是 flash」。
   *
   * 它跟 2.5 不是同一套形态：实测**只认「OpenAI 视频」那套像素参数**
   * （`width` / `height` / `num_frames` / `frame_rate`），发官方那套 `mode` 会被 400 拒
   * （当时的错误里露出服务端的 mode 词表正是 `ti2vid/keyframes/multi_reference`）。
   * 所以这里按**我们确实能发出去的东西**声明：
   * · 比例：用视频接口family 那 6 档（像素由 `agnesVideoDimensions(ratio,size)` 换算）；
   * · 尺寸：只留 720p / 1080p（480p / auto 没验证过，宁可不给）；
   * · 时长：4–12 秒（与官方 2.5 一致；我们唯一实测成功的那次是 4 秒）；
   * · `mode`：三档都在 —— `text`（纯文字起片）、`keyframe`（首尾帧）、`reference`
   *   （全能参考）。**2026-10-03 实测解锁**：2.0 的参考素材参数是 `image` 数组，
   *   而且**直接吃 Data URI（Base64）**（`mode:keyframes` + `image:[data:image/png;base64,…] ×2`
   *   → HTTP 200 排队），所以本地素材不必先上图床就能用（对账清单 #115）。
   */
  'agnes-video-v2.0': {
    ratios: AGNES_RATIOS,
    sizes: ['720p', '1080p'],
    seconds: { min: 4, max: 12, default: 5 },
    count: 1,
    modes: ['text', 'keyframe', 'reference'],
    dialect: 'pixel',
  },
}

/** 前端显示名 → 上游 ID（只列我们真在用的 Agnes 视频档） */
const ALIASES: Record<string, string> = {
  'Agnes Video 2.0': 'agnes-video-v2.0',
  'Agnes Video 2.5': 'agnes-video-2.5',
  'Agnes Video 2.5 Flash': 'agnes-video-2.5-flash',
}

/**
 * 按模型名取规格；**认不出来就返回 undefined** —— 界面走通用兜底，不瞎猜。
 *
 * 为什么宁可兜底也不给个默认：`Agnes Video 2.0` 走的是完全另一套（像素 + 帧数），
 * 把 2.5 的档位套上去反而会发出它不认的参数（我们刚因为这类「套错参数」修了三个 bug）。
 */
export function videoParamsFor(model: string): VideoParamSpec | undefined {
  const name = String(model ?? '').trim()
  if (!name) return undefined
  return VIDEO_PARAM_SPECS[name] ?? VIDEO_PARAM_SPECS[ALIASES[name] ?? ''] ?? undefined
}
