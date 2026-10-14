import { describe, expect, it } from 'vitest'
import { layoutMasonry } from './masonryLayout'

const OPTIONS = { minColumnWidth: 240, gap: 20 }

/** 从布局结果反推每列累计高度（末位扣掉间距），用来验「没有大空洞」 */
function columnBottoms(heights: readonly number[], layout: ReturnType<typeof layoutMasonry>) {
  const bottoms = new Array(layout.columns).fill(0)
  heights.forEach((h, i) => {
    const column = Math.round(layout.offsets[i]!.x / (layout.columnWidth + OPTIONS.gap))
    bottoms[column] = Math.max(bottoms[column], layout.offsets[i]!.y + Math.max(0, h))
  })
  return bottoms
}

describe('layoutMasonry', () => {
  it('★★ 列数按容器宽算（1000px / 240px 最小列宽 ⇒ 3 列，不是 4 列）', () => {
    const layout = layoutMasonry([100, 100], 1000, OPTIONS)
    expect(layout.columns).toBe(3)
    expect(layout.columnWidth).toBeCloseTo((1000 - 20 * 2) / 3)
  })

  it('★★ 每张卡放进当前最短的列（平局放最左，结果可复现）', () => {
    const heights = [100, 100, 100, 100, 100]
    const layout = layoutMasonry(heights, 500, OPTIONS)
    expect(layout.columns).toBe(2)
    expect(layout.offsets.map((o) => Math.round(o.x))).toEqual([0, 260, 0, 260, 0])
    expect(layout.offsets.map((o) => Math.round(o.y))).toEqual([0, 0, 120, 120, 240])
    expect(Math.round(layout.containerHeight)).toBe(340)
  })

  it('★★★ 列底差距不超过「最高的一张卡」（CSS 多列那种 1795px 大洞的判据）', () => {
    const heights = [420, 260, 300, 520, 180, 240, 480, 200, 360, 300, 640, 220]
    const layout = layoutMasonry(heights, 1040, OPTIONS)
    const bottoms = columnBottoms(heights, layout)
    const tailGap = Math.max(...bottoms) - Math.min(...bottoms)
    /** 最矮列与最高列的差距上界 = 最高一张卡 + 一个间距（最短列算法的性质） */
    expect(tailGap).toBeLessThanOrEqual(Math.max(...heights) + OPTIONS.gap)
  })

  it('★ 窄容器只给一列，宽度就是容器宽（不溢出、不出现负数列宽）', () => {
    const layout = layoutMasonry([100, 200], 200, OPTIONS)
    expect(layout.columns).toBe(1)
    expect(layout.columnWidth).toBe(200)
    expect(layout.offsets.map((o) => o.x)).toEqual([0, 0])
    expect(layout.containerHeight).toBe(320)
  })

  it('★ 没有卡片时高度归零（不产生 -Infinity / 负高度）', () => {
    const layout = layoutMasonry([], 1000, OPTIONS)
    expect(layout.offsets).toEqual([])
    expect(layout.containerHeight).toBe(0)
  })
})
