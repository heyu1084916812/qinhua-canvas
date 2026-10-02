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
 * 非 Agnes 的固定显示名（`GPT Image …` / `Nano Banana …` / `Midjourney`）**故意不在这里定义**：
 * 它们的参数由各自渠道上报的能力（`ModelCapability`）驱动，本轮没有逐家核对官方文档，
 * 凭空写一套等于把「猜的档位」钉进代码 —— 那正是这个项目反复踩过的坑。
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
  /** 尺寸方言：`tier` = 档位 + ratio；`pixel` = 直接给像素 */
  dialect: 'tier' | 'pixel'
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
}

/** 前端显示名 → 上游 ID（只列我们真在用的 Agnes 图片档） */
const ALIASES: Record<string, string> = {
  'Agnes Image 2.0 Flash': 'agnes-image-2.0-flash',
  'Agnes Image 2.1 Flash': 'agnes-image-2.1-flash',
  'Agnes Image 2.5 Flash': 'agnes-image-2.5-flash',
}

/** 按模型名取规格；认不出来返回 `undefined` ⇒ 面板退回「按渠道上报的能力渲染」 */
export function imageParamsFor(model: string): ImageParamSpec | undefined {
  const name = String(model ?? '').trim()
  if (!name) return undefined
  return IMAGE_PARAM_SPECS[name] ?? IMAGE_PARAM_SPECS[ALIASES[name] ?? ''] ?? undefined
}
