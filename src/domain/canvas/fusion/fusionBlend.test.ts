/**
 * 混合数学的单测（产品文档 §6.23）。
 *
 * 口径逐条对齐大雄无限画布 `local-patch` 插件（`local_patch_ops.py`）：
 * 它的 `test_feather_mask_keeps_rect_opaque_and_outer_edge_transparent` 断言的两件事，
 * 这里用纯函数版本再钉一遍；另外补上它没测、但很容易写错的**角落剖面**。
 */
import { describe, it, expect } from 'vitest'
import {
  FUSION_COLOR_MATCH_LIMIT,
  applyColorOffset,
  featherAlpha,
  featherMaskAlpha,
  innerRectOf,
  isZeroOffset,
  limitedColorOffset,
} from './fusionBlend'

/** 外扩框 40×30、选区居中 20×10（左上角相对外扩框 (10,10)） */
const PADDED = { w: 40, h: 30 }
const INNER = { x: 10, y: 10, w: 20, h: 10 }

describe('innerRectOf', () => {
  it('选区坐标从原图坐标系换算成「相对外扩框左上角」', () => {
    expect(innerRectOf({ x: 100, y: 50, w: 20, h: 10 }, { x: 90, y: 40, w: 40, h: 30 })).toEqual(INNER)
  })
})

describe('羽化剖面 · featherAlpha', () => {
  it('★ 选区内部完全不透明（羽化不许啃到选区自己）', () => {
    for (const [x, y] of [
      [10, 10],
      [29, 10],
      [10, 19],
      [29, 19],
      [20, 15],
    ]) {
      expect(featherAlpha(x, y, PADDED, INNER), `${x},${y}`).toBe(1)
    }
  })

  it('★ 最外圈完全透明（贴到外扩边界时补丁彻底让位于原图，接缝因此看不见）', () => {
    expect(featherAlpha(0, 15, PADDED, INNER)).toBe(0)
    expect(featherAlpha(39, 15, PADDED, INNER)).toBe(0)
    expect(featherAlpha(20, 0, PADDED, INNER)).toBe(0)
    expect(featherAlpha(20, 29, PADDED, INNER)).toBe(0)
  })

  it('★ 从外向内单调递增（中间不会出现「又变淡」的回头段）', () => {
    let prev = -1
    for (let x = 0; x <= 10; x += 1) {
      const a = featherAlpha(x, 15, PADDED, INNER)
      expect(a, `x=${x}`).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    expect(prev).toBe(1)
  })

  it('★★ 角落取两边距离的**较小者**，不是两者相乘', () => {
    // (5,5) 在左带宽 5/10、上带宽 5/10 —— 两边一样，故 min 与乘积在这里同值，
    // 取一个两边不同的点才测得出来：(2,5)：横向 0.2、纵向 0.5
    const a = featherAlpha(2, 5, PADDED, INNER)
    const smooth = (t: number) => t * t * (3 - 2 * t)
    expect(a).toBeCloseTo(smooth(0.2), 6) // min(0.2, 0.5) → 用横向那个
    // 若误写成「两者相乘」，这里会是 smooth 之前就乘掉的结果，明显更小
    expect(a).toBeGreaterThan(smooth(0.2) * smooth(0.5))
  })

  it('数值与解析式一致（smoothstep(3t²−2t³)，在 t 两端导数为 0）', () => {
    const smooth = (t: number) => t * t * (3 - 2 * t)
    expect(featherAlpha(5, 15, PADDED, INNER)).toBeCloseTo(smooth(0.5), 6)
    expect(featherAlpha(8, 15, PADDED, INNER)).toBeCloseTo(smooth(0.8), 6)
  })
})

describe('羽化遮罩 · featherMaskAlpha', () => {
  it('长度 = 宽 × 高，且取值落在 0–255', () => {
    const buf = featherMaskAlpha(PADDED, INNER)
    expect(buf.length).toBe(40 * 30)
    for (const v of buf) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of buf) expect(v).toBeLessThanOrEqual(255)
  })

  it('★ 行优先：第 (x,y) 个像素在 y*w+x（执行层按这个下标写进 alpha 通道）', () => {
    const buf = featherMaskAlpha(PADDED, INNER)
    expect(buf[15 * 40 + 0]).toBe(0) // 左边界
    expect(buf[15 * 40 + 20]).toBe(255) // 选区内部
  })
})

describe('受限色彩匹配', () => {
  it('偏移 = 原图均值 − 补丁均值', () => {
    expect(limitedColorOffset([100, 50, 200], [90, 40, 190])).toEqual([10, 10, 10])
  })

  it('★★ 每通道夹在 ±24：不设上限就等于把补丁刷成原图的颜色', () => {
    const offset = limitedColorOffset([255, 0, 128], [0, 255, 128])
    expect(offset).toEqual([FUSION_COLOR_MATCH_LIMIT, -FUSION_COLOR_MATCH_LIMIT, 0])
  })

  it('色差在阈值内时如实返回（不是一律顶到上限）', () => {
    expect(limitedColorOffset([130, 130, 130], [120, 125, 118])).toEqual([10, 5, 12])
  })

  it('加偏移时夹到 0–255', () => {
    expect(applyColorOffset([250, 5, 128], [24, -24, 0])).toEqual([255, 0, 128])
  })

  it('零偏移可被识别（省掉一次整张位图的逐像素重写）', () => {
    expect(isZeroOffset([0, 0, 0])).toBe(true)
    expect(isZeroOffset([0, 1, 0])).toBe(false)
    // 均值相等时（差 <0.5 被 round 掉）也算零偏移
    expect(isZeroOffset(limitedColorOffset([100.2, 100.4, 100], [100, 100, 100]))).toBe(true)
  })
})
