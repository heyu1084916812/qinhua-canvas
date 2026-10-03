/**
 * **图片模型各自的参数能力**（用户 2026-10-03：
 * 「把图片生成节点和视频生成节点的模型具体每个模型有哪些配置单独设置，不要通用设置，
 *   去官方文档找一下」）。
 *
 * 值域来源写死在这里，**每条都标出处**：
 *
 * - Agnes Image 2.0 Flash / 2.1 Flash / 2.5 Flash：官方文档
 *   `wiki.agnes-ai.com/en/docs/agnes-image-{20,21,25}-flash`（2026-10-03 实读）。
 *   三者的差别是**真差别**，不是文案差别：
 *   · 2.0 的 `size` 是**像素**（`1024x768` 这种），**没有 `ratio`**；
 *   · 2.1 / 2.5 的 `size` 是**档位**（`1K`/`2K`/`3K`/`4K`），画幅由 `ratio` 给（8 档）。
 *   · 三家都**没有** `n`（张数）与 `quality` 这两个参数 —— 面板上摆出来就是死格子。
 *   · 参考图（`image[]`）都支持「公网 URL **或 Data URI Base64**」，2.1 / 2.5 最多 8 张
 *     （文档只对视频写了 8/5 的上限；图片这边给 4，与渠道层 `MAX_IMAGE_INPUTS` 对齐）。
 *
 * 非 Agnes 的固定显示名**只写实测过的**（对账 #118 / #119）：
 * - **Comfy-gpt 的三个 GPT Image 档**：`size` 必须是 `WxH`（档位字符串会被拒）、
 *   `quality` 认 `auto/low/medium/high/xhigh/max`、画幅 9 档 × 分辨率 `1k`/`2k`（渠道上报）；
 * - **Nano Banana Pro / 2**：只有 prompt 有参数，且必须走 `/chat/completions`（`chat` 方言）。
 *
 * 剩下的（`Midjourney` 与非 Agnes 视频档）**还没写** —— 用户渠道里没有勾选可测对象，
 * 凭空按官方文档写一套等于把「猜的档位」钉进代码，那正是这个项目反复踩过的坑。
 * 它们仍按渠道上报的能力（`ModelCapability`）渲染。
 */
export interface ImageParamSpec {
  /** 尺寸档：`tier` 方言给 `1K` 这种档位，`pixel` 方言给 `1024x768` 这种像素 */
  sizes: readonly string[]
  /** 比例档（**空数组 = 该模型不用 ratio**，面板上这一段不摆） */
  ratios: readonly string[]
  /** 质量档（空数组 = 不摆） */
  qualities: readonly string[]
  /** 张数候选（Agnes 全系只支持 1，故只有一项） */
  counts: readonly number[]
  /** 参考图上限（0 = 不支持参考图） */
  maxReferenceImages: number
  /**
   * 尺寸方言（三种，都是**实测/文档**出来的，不是猜的）：
   * - `tier`：`size` 给档位（`1K`/`2K`…）+ `ratio` —— Agnes Image 2.1 / 2.5；
   * - `pixel`：`size` 直接给像素，**没有** `ratio` —— Agnes Image 2.0 Flash；
   * - `ratio+resolution`：面板给「画幅 + 分辨率档」，发出去时**换算成 `WxH` 像素** ——
   *   Comfy-gpt 那三个 GPT Image 档（2026-10-03 实测：`size` 必须是 `WxH`，
   *   传档位字符串会回 `size must be in WxH pixels format`）。
   * - `chat`：**根本不走 `/images/generations`**，要走 `/chat/completions`，
   *   图在回复正文里以 markdown 链接返回 —— 中转站的 Gemini 系图片模型
   *   （`gemini-3-pro-image` / `gemini-3.1-flash-image`，即 Nano Banana Pro / 2）
   *   实测就是这样：images 路径对 Pro 直接 503「不支持此 API 路径」，chat 路径两张都出图。
   */
  dialect: 'tier' | 'pixel' | 'ratio+resolution' | 'chat'
}

/** Agnes 2.1 / 2.5 支持的 8 档画幅（官方尺寸表逐行都在） */
const AGNES_IMAGE_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '16:9',
  '9:16',
  '2:3',
  '3:2',
  '21:9',
] as const

const AGNES_IMAGE_TIERS = ['1K', '2K', '3K', '4K'] as const

export const IMAGE_PARAM_SPECS: Record<string, ImageParamSpec> = {
  'agnes-image-2.0-flash': {
    sizes: ['1024x1024', '1024x768', '768x1024'],
    ratios: [],
    qualities: [],
    counts: [1],
    maxReferenceImages: 4,
    dialect: 'pixel',
  },
  'agnes-image-2.1-flash': {
    sizes: AGNES_IMAGE_TIERS,
    ratios: AGNES_IMAGE_RATIOS,
    qualities: [],
    counts: [1],
    maxReferenceImages: 4,
    dialect: 'tier',
  },
  'agnes-image-2.5-flash': {
    sizes: AGNES_IMAGE_TIERS,
    ratios: AGNES_IMAGE_RATIOS,
    qualities: [],
    counts: [1],
    maxReferenceImages: 4,
    dialect: 'tier',
  },
  /**
   * **Comfy-gpt（中转站）的三个 GPT Image 档** —— 2026-10-03 用真令牌问出来的口径：
   *
   * - `size` **必须是 `WxH` 像素**：传 `bogus-size` 时服务端原话是
   *   `size must be in WxH pixels format`（`gpt-image-2` 那条最宽松，非法值它直接忽略）；
   * - `quality` 的合法值是 **`auto / low / medium / high / xhigh / max`**（错误原文列出），
   *   比 OpenAI 官方那四档多两个 —— 所以我们不再只放行四档；
   * - 画幅与分辨率档由**渠道上报**（9 档含 `21:9` / `9:21`，分辨率 `1k` / `2k`），
   *   两者一起换算成像素（`openAiImageSize`），不是写死的 1024²。
   */
  ...Object.fromEntries(
    (['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const).map((id) => [
      id,
      {
        sizes: ['1k', '2k'],
        ratios: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21'],
        qualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
        counts: [1, 2, 4],
        maxReferenceImages: 4,
        dialect: 'ratio+resolution' as const,
      },
    ]),
  ),
  /**
   * **Nano Banana（中转站的 Gemini 系图片模型）**：只有 prompt，没有尺寸 / 画幅 / 质量 / 张数
   * 这些档 —— 实测把 `size` 与 `aspect_ratio` 传进去它们**照单忽略**（照样 200 出图），
   * 面板上摆出来就是一堆点了没用的格子。故这里的尺寸 / 画幅 / 质量都留空、张数固定 1，
   * 走 `chat` 方言（图在回复正文的 markdown 里）。
   */
  'gemini-3-pro-image': {
    sizes: [],
    ratios: [],
    qualities: [],
    counts: [1],
    maxReferenceImages: 0,
    dialect: 'chat',
  },
  'gemini-3.1-flash-image': {
    sizes: [],
    ratios: [],
    qualities: [],
    counts: [1],
    maxReferenceImages: 0,
    dialect: 'chat',
  },
}

/** 前端显示名 → 上游 ID（只列我们真在用的 Agnes 图片档） */
const ALIASES: Record<string, string> = {
  'Agnes Image 2.0 Flash': 'agnes-image-2.0-flash',
  'Agnes Image 2.1 Flash': 'agnes-image-2.1-flash',
  'Agnes Image 2.5 Flash': 'agnes-image-2.5-flash',
  'GPT Image 2': 'gpt-image-2',
  'GPT Image 2.5 Flare': 'gpt-image-2.5-flare',
  'GPT Image 2.5 Sunburst': 'gpt-image-2.5-sunburst',
  'Nano Banana Pro': 'gemini-3-pro-image',
  'Nano Banana 2': 'gemini-3.1-flash-image',
}

/** 按模型名取规格；认不出来返回 `undefined` ⇒ 面板退回「按渠道上报的能力渲染」 */
export function imageParamsFor(model: string): ImageParamSpec | undefined {
  const name = String(model ?? '').trim()
  if (!name) return undefined
  const direct = IMAGE_PARAM_SPECS[name] ?? IMAGE_PARAM_SPECS[ALIASES[name] ?? '']
  if (direct) return direct
  /**
   * 中转站对同一个 Gemini 图片模型有一串变体 ID（`-2k` / `-4k` / `-preview`…
   * 见用户渠道里那 50 个缓存模型），它们**参数口径一样**，按前缀归一即可 ——
   * 逐个列举迟早漏，漏了就退回通用档位、又变成「通用设置」。
   */
  if (/^gemini-3-pro-image/.test(name)) return IMAGE_PARAM_SPECS['gemini-3-pro-image']
  if (/^gemini-3\.1-flash-image/.test(name)) return IMAGE_PARAM_SPECS['gemini-3.1-flash-image']
  return undefined
}
