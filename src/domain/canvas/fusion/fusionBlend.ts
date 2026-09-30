import type { FusionRect } from '../model/node'

/**
 * 融合的**混合数学**（产品文档 §6.23）。
 *
 * 口径对齐大雄无限画布 `local-patch` 插件的 `local_patch_ops.py`（抄概念与数值，
 * 实现按 canvas 重写）。它那边这两段是**逐像素的 Python 循环 + Pillow**，
 * 这里把**算式**抽成纯函数（可单测），像素读写留在执行层。
 *
 * 为什么值得照抄它的数值而不是自己发挥：这两个数字（0.8px 模糊、±24 色偏上限）
 * 是它迭代了好几个版本调出来的（见 `融合节点插件-版本迭代与故障排查-v2.6.0.md`），
 * 自己另调一组等于把它的试错重做一遍。
 */

/**
 * 羽化遮罩的额外模糊半径（px）。
 *
 * 光有 smoothstep 的解析剖面，边缘在放大看时仍是一圈可见的折线；
 * 0.8px 的轻微模糊把这条折线抹掉。**取小值是有意的** ——
 * 模糊太大等于把选区边缘的内容也糊掉。
 */
export const FUSION_FEATHER_BLUR_PX = 0.8

/**
 * 色彩匹配的单通道上限（0–255 的 ±）。
 *
 * 为什么必须**限制**：补丁与原图的色差有时很大（换了光照、换了材质），
 * 无上限地「把补丁拉成原图的颜色」会把补丁自己的颜色信息一起抹掉 ——
 * 用户要的是「接缝不刺眼」，不是「补丁变成原图的颜色」。
 * 大雄取 ±24，本实现照抄。
 */
export const FUSION_COLOR_MATCH_LIMIT = 24

export interface Box {
  w: number
  h: number
}

/** 选区在外扩框内的位置（相对左上角） */
export function innerRectOf(rect: FusionRect, padded: FusionRect): FusionRect {
  return {
    x: rect.x - padded.x,
    y: rect.y - padded.y,
    w: rect.w,
    h: rect.h,
  }
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/**
 * 遮罩在某一点的透明度（0..1）。
 *
 * 剖面 = `smoothstep(min(到最近边的横向距离, 到最近边的纵向距离))`：
 * - **取 `min` 而不是两者相乘**：相乘会让四个角各淡一次（角上明显比边更透），
 *   而「离选区边界多远」本来就该由**最近的那条边**决定。大雄用的就是 min。
 * - 选区内部恒为 1（不透明度满），故选区内不会被羽化啃掉。
 */
export function featherAlpha(
  x: number,
  y: number,
  padded: Box,
  inner: FusionRect,
): number {
  const left = inner.x
  const top = inner.y
  const right = inner.x + inner.w
  const bottom = inner.y + inner.h

  // 横向：在选区左边 = 越靠左越淡；右边同理；区间内 = 1
  let wx: number
  if (x < left) wx = x / Math.max(1, left)
  else if (x >= right) wx = (padded.w - 1 - x) / Math.max(1, padded.w - right)
  else wx = 1

  let wy: number
  if (y < top) wy = y / Math.max(1, top)
  else if (y >= bottom) wy = (padded.h - 1 - y) / Math.max(1, padded.h - bottom)
  else wy = 1

  return smoothstep(Math.min(wx, wy))
}

/**
 * 整张羽化遮罩的 alpha 缓冲（长度 `w × h`，行优先）。
 *
 * 返回裸缓冲而不是 ImageData：纯函数层不该认识 DOM 类型，执行层拿到后
 * 直接塞进 `ImageData` 的 alpha 通道即可。
 *
 * 注意**这里不含模糊**：0.8px 模糊是像素层的操作（`ctx.filter`），
 * 纯函数只负责解析剖面 —— 否则「模糊」这件事就得在纯函数里造一个卷积核，
 * 而它与 canvas 自带的那一个未必等价。
 */
export function featherMaskAlpha(padded: Box, inner: FusionRect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(Math.max(0, padded.w * padded.h))
  for (let y = 0; y < padded.h; y += 1) {
    for (let x = 0; x < padded.w; x += 1) {
      out[y * padded.w + x] = Math.round(255 * featherAlpha(x, y, padded, inner))
    }
  }
  return out
}

export type Rgb = readonly [number, number, number]

/**
 * 受限色彩偏移：`原图均值 − 补丁均值`，每个通道夹在 ±`limit`。
 *
 * 采样的「环」= 外扩框里**挖掉选区**之后剩下的那一圈（`_ring_mask` 的口径）——
 * 那一圈既属于补丁的覆盖范围、又紧贴原图未改动的内容，是两者色差的唯一可比之处。
 */
export function limitedColorOffset(
  originalMean: Rgb,
  patchMean: Rgb,
  limit = FUSION_COLOR_MATCH_LIMIT,
): Rgb {
  const clamp = (v: number) => Math.max(-limit, Math.min(limit, Math.round(v)))
  return [clamp(originalMean[0] - patchMean[0]), clamp(originalMean[1] - patchMean[1]), clamp(originalMean[2] - patchMean[2])]
}

/** 把偏移加到某个颜色上（夹到 0–255） */
export function applyColorOffset(rgb: Rgb, offset: Rgb): Rgb {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return [clamp(rgb[0] + offset[0]), clamp(rgb[1] + offset[1]), clamp(rgb[2] + offset[2])]
}

/** 一个通道值是否是「有效偏移」（全 0 就没必要逐像素重写整张位图） */
export function isZeroOffset(offset: Rgb): boolean {
  return offset[0] === 0 && offset[1] === 0 && offset[2] === 0
}
