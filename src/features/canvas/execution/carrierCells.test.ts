import { describe, it, expect } from 'vitest'
import { carrierCellAt } from './canvasPlacement'
import { ratioNodeSize } from '../../../domain/canvas/layout/assetNodeSize'

/**
 * 多结果新建承载节点的排布（§6.9 第 638–645 行）：
 * N=2 / 3 单行、N=4 为 2×2、5–8 每排最多 4 个。
 */
describe('carrierCellAt · 复用 §6.9 格位规则', () => {
  const src = { x: 0, y: 0, w: 240, h: 240 }
  const GAP = 16
  const PAD = 16

  const at = (count: number, ratio?: string) =>
    Array.from({ length: count }, (_, i) => carrierCellAt(src, i, count, ratio))

  it('N=1：单个节点', () => {
    const p = at(1)
    expect(p).toHaveLength(1)
  })

  it('★ N=4 是 2×2 网格（两行两列，不重叠）', () => {
    const p = at(4)
    expect(new Set(p.map((c) => `${c.x},${c.y}`)).size).toBe(4)
    const xs = [...new Set(p.map((c) => c.x))].sort((a, b) => a - b)
    const ys = [...new Set(p.map((c) => c.y))].sort((a, b) => a - b)
    expect(xs).toHaveLength(2)
    expect(ys).toHaveLength(2)
    // 步长 = 节点实际尺寸 + 间距 16（未指定比例时用最小尺寸 240×240）
    const cell = ratioNodeSize(undefined)
    expect(xs[1]! - xs[0]!).toBe(cell.w + GAP)
    expect(ys[1]! - ys[0]!).toBe(cell.h + GAP)
  })

  it('★ N=2 / N=3 单行排布', () => {
    for (const n of [2, 3]) {
      const p = at(n)
      expect(new Set(p.map((c) => c.y)).size).toBe(1)
      expect(new Set(p.map((c) => c.x)).size).toBe(n)
    }
  })

  it('★ N=5..8 每排最多 4 个', () => {
    for (const n of [5, 6, 7, 8]) {
      const p = at(n)
      expect(new Set(p.map((c) => `${c.x},${c.y}`)).size).toBe(n)
      const perRow = new Map<number, number>()
      for (const c of p) perRow.set(c.y, (perRow.get(c.y) ?? 0) + 1)
      expect(Math.max(...perRow.values())).toBeLessThanOrEqual(4)
    }
  })

  it('起始位置在源节点右侧（水平间距 72 + 内边距 16）', () => {
    const first = at(1)[0]!
    expect(first.x).toBe(src.x + src.w + 72 + PAD)
  })

  /**
   * ★ 按**节点实际边界**排布，相邻行必须留出 16px 可见间隔（用户 2026-09-17 报「重叠一点点」）。
   *
   * 根因是格位固定 200×200 而节点按产物比例更高（16:9 → 427×240），
   * 行距 216 < 240 于是叠住。改为按实际尺寸排布后：下一行 y - 上一行 y = 实际高 + 16。
   */
  it('★ 相邻行按实际边界留出 16px 间隔（不再轻微重叠）', () => {
    const cell = ratioNodeSize('16:9')
    expect(cell.h).toBeGreaterThan(200) // 16:9 会算得比固定格位高
    const p = at(4, '16:9')
    const ys = [...new Set(p.map((c) => c.y))].sort((a, b) => a - b)
    expect(ys[1]! - ys[0]!).toBe(cell.h + GAP)
    // 上一行底边 + 16 = 下一行顶边 ⇒ 不重叠
    expect(ys[0]! + cell.h + GAP).toBe(ys[1]!)
  })

  it('★ 承载节点尺寸 = 按请求比例算出的节点尺寸', () => {
    for (const ratio of ['1:1', '16:9', '9:16', '4:3']) {
      const expected = ratioNodeSize(ratio)
      const c = carrierCellAt(src, 0, 1, ratio)
      expect({ w: c.w, h: c.h }).toEqual(expected)
      // 宽高比应与请求比例一致（允许取整误差）
      expect(Math.abs(c.w / c.h - expected.w / expected.h)).toBeLessThan(0.02)
    }
  })
})
