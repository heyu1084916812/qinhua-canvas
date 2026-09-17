import { describe, it, expect } from 'vitest'
import { carrierCellAt } from './canvasPlacement'

/**
 * 多结果新建承载节点的排布（§6.9 第 638–645 行）：
 * N=2 / 3 单行、N=4 为 2×2、5–8 每排最多 4 个。
 */
describe('carrierCellAt · 复用 §6.9 格位规则', () => {
  const src = { x: 0, y: 0, w: 240, h: 240 }
  const N = 200
  const GAP = 16
  const PAD = 16

  const at = (count: number) => Array.from({ length: count }, (_, i) => carrierCellAt(src, i, count))

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
    expect(xs[1]! - xs[0]!).toBe(N + GAP)
    expect(ys[1]! - ys[0]!).toBe(N + GAP)
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
})
