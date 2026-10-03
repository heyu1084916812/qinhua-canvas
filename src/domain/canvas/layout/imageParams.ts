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
  /**
   * **清晰度档**（用户 2026-10-03 图一/图二那份：`1K` / `2K` / `4K`）。
   * `pixel` 方言的模型（Agnes Image 2.0）这里是它唯一认的像素尺寸。
   */
  sizes: readonly string[]
  /**
   * **比例档**（**空数组 = 该模型不用 ratio**，面板上这一段不摆）。
   * 图一/图二那份含 `1:2 / 2:1 / 5:4 / 4:5 / 9:21` 这些窄档，
   * 香蕉那份还会带一个 `auto`（= 自适应，不向渠道指定画幅）。
   */
  ratios: readonly string[]
  /**
   * **画质档**（用户 2026-10-03 图一：低 / 标准 / 高 / 超高 / 极致）。
   * 值仍用各家接口的合法枚举（OpenAI 官方是 `low/medium/high/xhigh/max`），
   * 面板只负责把 `medium` 显示成「标准画质」。
   */
  qualities: readonly string[]
  /**
   * **背景档**（用户 2026-10-03 图一：自动 / 保留背景 / 透明背景）。
   * 取 OpenAI 官方的 `background` 枚举；模型不支持时留空 ⇒ 面板不摆这一段。
   */
  backgrounds: readonly string[]
  /**
   * **生成数量**：用户 2026-10-03「数量这个我需要每个模型统一一下，不能有些有，有些没有」
   * ⇒ **所有图片模型都是 1 / 2 / 4**，面板那一段一律存在。
   */
  counts: readonly number[]
  /** 参考图上限（0 = 不支持参考图） */
  maxReferenceImages: number
  /**
   * 尺寸方言（三种，都是**实测/文档**出来的，不是猜的）：
   * - `tier`：`size` 给档位（`1K`/`2K`…）+ `ratio` —— Agnes Image 2.1 / 2.5；
   * - `pixel`：`size` 直接给像素，**没有** `ratio` —— Agnes Image 2.0 Flash；
   * - `openai-images`：**OpenAI 官方 Images API** 那套 —— `size`（`auto` 或三个像素尺寸）
   *   + `quality`（六档）+ `n`，见下面的 `OPENAI_IMAGE_*`。
   * - `chat`：**根本不走 `/images/generations`**，要走 `/chat/completions`，
   *   图在回复正文里以 markdown 链接返回。
   * - `gemini`：走**Gemini 原生端点** `/v1beta/models/<id>:generateContent`，
   *   官方参数 `imageConfig: { aspectRatio, imageSize }` 才生效 ——
   *   2026-10-03 实测：`1:1 + 2K` → 2048×2048、`21:9 + 2K` → 3168×1344，
   *   与官方尺寸表逐字对上；而同一模型的 chat / images 路径**把这两个参数吃掉了**
   *   （三次请求都回同一张 1408×768）。
   */
  dialect: 'tier' | 'pixel' | 'openai-images' | 'chat' | 'gemini'
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

/**
 * Gemini 图像模型的 14 档宽高比 —— **官方文档《Nano Banana 图片生成》里那张表逐行抄的**
 * （`1:1 / 1:4 / 1:8 / 2:3 / 3:2 / 3:4 / 4:1 / 4:3 / 4:5 / 5:4 / 8:1 / 9:16 / 16:9 / 21:9`）。
 * 注意它比 Agnes 那 6 档宽得多：竖长条（1:8）、横长条（8:1）都在内。
 */
const GEMINI_IMAGE_RATIOS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
] as const

/** 香蕉面板那份（用户 2026-10-03 图二）：最前面多一个 `auto` = 自适应 */
const GEMINI_RATIOS_WITH_AUTO = ['auto', ...GEMINI_IMAGE_RATIOS] as const

/**
 * **GPT Image 的面板档位**（用户 2026-10-03 图一）：
 *
 * - 比例：**13 档**（`1:1 / 1:2 / 2:1 / 9:16 / 16:9 / 3:4 / 4:3 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9 / 9:21`）
 *   —— 用户原话「我不想用具体的像素标志，我想要比例那种档位」；
 * - 清晰度：`1K / 2K / 4K`（与香蕉一致），发请求时按 `比例 × 清晰度` 换算成像素 `size`
 *   （OpenAI 的 `size` 只认像素，官方规范里 `auto`/`1024x1024`/`1536x1024`/`1024x1536`）；
 * - 画质：`low / medium / high / xhigh / max`（OpenAI 官方枚举，面板显示成
 *   低 / 标准 / 高 / 超高 / 极致画质）；
 * - 背景：`auto / opaque / transparent`（OpenAI 官方 `background` 枚举，
 *   面板显示成 自动 / 保留背景 / 透明背景）。
 */
const OPENAI_IMAGE_RATIOS = [
  '1:1',
  '1:2',
  '2:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
] as const
const OPENAI_IMAGE_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const OPENAI_IMAGE_BACKGROUNDS = ['auto', 'opaque', 'transparent'] as const
const OPENAI_IMAGE_TIERS = ['1K', '2K', '4K'] as const

/** 所有图片模型统一的生成数量（用户 2026-10-03：「数量…每个模型统一一下」） */
const IMAGE_COUNTS = [1, 2, 4] as const

export const IMAGE_PARAM_SPECS: Record<string, ImageParamSpec> = {
  'agnes-image-2.0-flash': {
    sizes: ['1024x1024', '1024x768', '768x1024'],
    ratios: [],
    qualities: [],
    backgrounds: [],
    counts: IMAGE_COUNTS,
    maxReferenceImages: 4,
    dialect: 'pixel',
  },
  'agnes-image-2.1-flash': {
    sizes: AGNES_IMAGE_TIERS,
    ratios: AGNES_IMAGE_RATIOS,
    qualities: [],
    backgrounds: [],
    counts: IMAGE_COUNTS,
    maxReferenceImages: 4,
    dialect: 'tier',
  },
  'agnes-image-2.5-flash': {
    sizes: AGNES_IMAGE_TIERS,
    ratios: AGNES_IMAGE_RATIOS,
    qualities: [],
    backgrounds: [],
    counts: IMAGE_COUNTS,
    maxReferenceImages: 4,
    dialect: 'tier',
  },
  /**
   * **GPT Image 三档 —— 直接用 OpenAI 官方规范**（用户 2026-10-03：「就走官方的，
   * 你直接看前端是什么模型就去看什么官方的模型就行了」）。
   *
   * 出处：OpenAI 官方 OpenAPI 规范（`openai/openai-openapi` 仓库的 `CreateImageRequest`，
   * 2026-10-03 实读）——
   * - `size`：`auto / 1024x1024 / 1536x1024 / 1024x1536`（`256x256` / `512x512` /
   *   `1792x1024` 在规范里已标为**废弃的老尺寸**，故不摆）；
   * - `quality`：`low / medium / high / xhigh / max / auto`（`standard` / `hd` 已废弃）；
   * - `n`：**1–10**（面板给 1 / 2 / 4 / 9，都在范围内）。
   *
   * 中转站实测与官方一致：它自己的报错原文也是这六个 quality 值；`size` 必须是
   * `WxH`（官方这几个尺寸正好都是）。
   */
  ...Object.fromEntries(
    (['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const).map((id) => [
      id,
      {
        sizes: OPENAI_IMAGE_TIERS,
        ratios: OPENAI_IMAGE_RATIOS,
        qualities: OPENAI_IMAGE_QUALITIES,
        backgrounds: OPENAI_IMAGE_BACKGROUNDS,
        counts: IMAGE_COUNTS,
        maxReferenceImages: 4,
        dialect: 'openai-images' as const,
      },
    ]),
  ),
  /**
   * **Nano Banana Pro（`gemini-3-pro-image`）** —— 参数全部来自 Google 官方文档
   * 《Nano Banana 图片生成》（2026-10-03 实读，浏览器抓的正文）：
   * 宽高比 14 档、`image_size` 支持 `1K / 2K / 4K`（Pro 不含 512）。
   * 文档特别注明 **`image_size` 必须大写 K**（小写会被拒）。
   */
  'gemini-3-pro-image': {
    sizes: ['1K', '2K', '4K'],
    ratios: GEMINI_RATIOS_WITH_AUTO,
    qualities: [],
    backgrounds: [],
    counts: IMAGE_COUNTS,
    maxReferenceImages: 0,
    dialect: 'gemini',
  },
  /**
   * **Nano Banana 2（`gemini-3.1-flash-image`）**：同一份官方文档，多一档 `512`
   * （「Gemini 3.1 Flash Image 新增了较小的 512 像素 (0.5K) 分辨率」）。
   */
  'gemini-3.1-flash-image': {
    sizes: ['512', '1K', '2K', '4K'],
    ratios: GEMINI_RATIOS_WITH_AUTO,
    qualities: [],
    backgrounds: [],
    counts: IMAGE_COUNTS,
    maxReferenceImages: 0,
    dialect: 'gemini',
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
