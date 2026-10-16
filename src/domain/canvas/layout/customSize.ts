/**
 * 「自定义像素尺寸」的**唯一一份**规则与实现（gpt-image 官方硬约束）。
 *
 * ## 为什么抽到 domain
 *
 * 这份规则有**两个消费者**：
 * ① 传输层（`platform/channels/openaiImages` 决定发不发 `size`）；
 * ② 面板（用户 2026-10-15 第 9 轮「自定义要加上」那一格）。
 *
 * 原先只有 ①，于是面板这一侧是**静默**的：用户填 `1024x1000`（不是 16 的倍数），
 * 传输层默默回落到「比例 × 档位」，界面上一个字都不说 —— 用户只会觉得"我填了没用"。
 * 两处各写一遍必然漂移（面板放行、传输层拒收，或反过来），所以规则只留这一份：
 * 面板拿 `customSizeIssue()` 给一句人话，传输层拿 `customImageSize()` 决定发不发。
 */

/** 官方要求长宽都是 16 的倍数 */
export const CUSTOM_SIZE_SNAP = 16
/** 最长边上限 */
export const CUSTOM_SIZE_MAX_EDGE = 3840
/** 总像素下限（655360 = 1024×640）与上限 */
export const CUSTOM_SIZE_MIN_PIXELS = 655360
export const CUSTOM_SIZE_MAX_PIXELS = 8294400
/** 长短边比上限（文档明确拒绝更扁的尺寸） */
export const CUSTOM_SIZE_MAX_ASPECT = 3

/**
 * 过不了的原因（面板据此说人话）：
 * - `format`：压根不是 `宽x高`（含空串、只写了一半）
 * - `snap`：不是 16 的倍数
 * - `edge`：最长边超 3840
 * - `pixels`：总像素不在 655360–8294400
 * - `aspect`：长短边比超 3:1
 */
export type CustomSizeIssue = 'format' | 'snap' | 'edge' | 'pixels' | 'aspect'

export interface CustomSize {
  w: number
  h: number
}

/**
 * 解析 `宽x高`：`x`（**大小写都认**）/ `×` / `*` 都行，允许两侧空格；**只认正整数**。
 * 这里**不判约束**（约束在 `customSizeIssue` 里）—— 因为面板要把"格式不对"与
 * "格式对但越界"分开说，两种情况的提示语完全不同。
 *
 * ⚠️ 大写 `X` 原先**不认**（老实现的字符集只有小写 x）：手机键盘上敲 `1024X1536` 很常见，
 * 那种输入以前会被静默当成"不是自定义尺寸"、回落到"比例 × 档位"——用户只会觉得填了没用。
 */
export function parseCustomSize(value: unknown): CustomSize | null {
  if (typeof value !== 'string') return null
  const m = /^(\d+)\s*[xX×*]\s*(\d+)$/.exec(value.trim())
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

type Checked = { ok: true; text: string } | { ok: false; issue: CustomSizeIssue }

/** 解析 + 逐条判约束，**只算一次**（两个出口共用它） */
function check(value: unknown): Checked {
  const size = parseCustomSize(value)
  if (!size) return { ok: false, issue: 'format' }
  const { w, h } = size
  if (w % CUSTOM_SIZE_SNAP !== 0 || h % CUSTOM_SIZE_SNAP !== 0) return { ok: false, issue: 'snap' }
  if (Math.max(w, h) > CUSTOM_SIZE_MAX_EDGE) return { ok: false, issue: 'edge' }
  if (w * h < CUSTOM_SIZE_MIN_PIXELS || w * h > CUSTOM_SIZE_MAX_PIXELS) {
    return { ok: false, issue: 'pixels' }
  }
  if (Math.max(w / h, h / w) > CUSTOM_SIZE_MAX_ASPECT) return { ok: false, issue: 'aspect' }
  return { ok: true, text: `${w}x${h}` }
}

/** 这个值**为什么**过不了（`null` = 合法）。面板用它决定要不要提示、提示哪一句 */
export function customSizeIssue(value: unknown): CustomSizeIssue | null {
  const r = check(value)
  return r.ok ? null : r.issue
}

/**
 * 合法就归一成 `宽x高`（小写 x、去空格、`×`/`*` 统一成 `x`），否则 `null`。
 * **传输层用的就是它**：`null` = 不下发 `size`（回落到"比例 × 档位"那条老路）。
 */
export function customImageSize(value: unknown): string | null {
  const r = check(value)
  return r.ok ? r.text : null
}
