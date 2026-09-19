import { describe, it, expect } from 'vitest'
import { ARRANGE_GAP, computeArrangeMode, type ArrangeModeInput } from './arrangeModes'
import type { Rect } from '../geometry/rect'

/** 造一个统一尺寸的节点 */
const n = (id: string, x: number, y: number, w = 100, h = 100): ArrangeModeInput => ({
  id,
  rect: { x, y, w, h },
})

const get = (t: Map<string, { x: number; y: number }>, id: string) => t.get(id)!
const centerY = (r: Rect) => r.y + r.h / 2

describe('排列方式（§6.5 ④）', () => {
  it('少于 2 个 → 不排列（与对齐同口径）', () => {
    expect(computeArrangeMode([n('a', 0, 0)], 'grid').size).toBe(0)
    expect(computeArrangeMode([], 'row').size).toBe(0)
  })

  it('★ 水平排列：全部同一行、垂直中心对齐、水平间距 24', () => {
    const nodes = [n('a', 0, 0), n('b', 300, 200), n('c', 50, 400)]
    const t = computeArrangeMode(nodes, 'row')
    // 一排三个：x 依次相差 100 + 24
    expect(get(t, 'a').x).toBeLessThan(get(t, 'b').x)
    expect(get(t, 'b').x - get(t, 'a').x).toBe(100 + ARRANGE_GAP)
    // 全部同一 y（尺寸相同 ⇒ 中心也自然对齐）
    expect(get(t, 'a').y).toBe(get(t, 'b').y)
    expect(get(t, 'b').y).toBe(get(t, 'c').y)
  })

  it('★ 垂直排列：全部同一列、水平中心对齐、垂直间距 24', () => {
    const nodes = [n('a', 0, 0), n('b', 300, 200)]
    const t = computeArrangeMode(nodes, 'column')
    expect(get(t, 'a').x).toBe(get(t, 'b').x)
    expect(get(t, 'b').y - get(t, 'a').y).toBe(100 + ARRANGE_GAP)
  })

  it('★ 宫格排列：4 个排成 2×2（列数取接近正方形的 ceil(sqrt(n))）', () => {
    const nodes = [n('a', 0, 0), n('b', 500, 0), n('c', 0, 500), n('d', 500, 500)]
    const t = computeArrangeMode(nodes, 'grid')
    // 2 列：第 1、2 个同一行；第 1、3 个同一列
    expect(get(t, 'a').y).toBe(get(t, 'b').y)
    expect(get(t, 'c').y).toBe(get(t, 'd').y)
    expect(get(t, 'a').x).toBe(get(t, 'c').x)
    expect(get(t, 'b').x).toBe(get(t, 'd').x)
    expect(get(t, 'b').x - get(t, 'a').x).toBe(100 + ARRANGE_GAP)
    expect(get(t, 'c').y - get(t, 'a').y).toBe(100 + ARRANGE_GAP)
  })

  it('★ 宫格 3 个 → 2 列（不是 1 列长条，也不是 3 列一线）', () => {
    const nodes = [n('a', 0, 0), n('b', 400, 0), n('c', 800, 0)]
    const t = computeArrangeMode(nodes, 'grid')
    expect(get(t, 'a').y).toBe(get(t, 'b').y)
    expect(get(t, 'c').y).toBeGreaterThan(get(t, 'a').y)
    expect(get(t, 'c').x).toBe(get(t, 'a').x)
  })

  it('★ 整块包围盒中心保持不动（不许排一次就甩走整组）', () => {
    const nodes = [n('a', 0, 0), n('b', 300, 200)]
    const before = {
      cx: (Math.min(...nodes.map((x) => x.rect.x)) + Math.max(...nodes.map((x) => x.rect.x + x.rect.w))) / 2,
      cy: (Math.min(...nodes.map((x) => x.rect.y)) + Math.max(...nodes.map((x) => x.rect.y + x.rect.h))) / 2,
    }
    const t = computeArrangeMode(nodes, 'row')
    const after = nodes.map((x) => ({ ...x.rect, ...t.get(x.id) }))
    const cx = (Math.min(...after.map((r) => r.x)) + Math.max(...after.map((r) => r.x + r.w))) / 2
    const cy = (Math.min(...after.map((r) => r.y)) + Math.max(...after.map((r) => r.y + r.h))) / 2
    expect(cx).toBeCloseTo(before.cx, 6)
    expect(cy).toBeCloseTo(before.cy, 6)
  })

  it('★ 尺寸不一时按各列最大宽度留位，不会互相压住', () => {
    const nodes = [n('wide', 0, 0, 200, 100), n('narrow', 0, 300, 80, 100)]
    const t = computeArrangeMode(nodes, 'row')
    const wide = { ...nodes[0].rect, ...t.get('wide') }
    const narrow = { ...nodes[1].rect, ...t.get('narrow') }
    /**
     * 水平排列时每列只放一个节点，故列宽 = 该节点自身宽度，
     * 间距按「前一列宽 + ARRANGE_GAP」递推 —— 关键是**不重叠**。
     */
    expect(narrow.x - (wide.x + wide.w)).toBe(ARRANGE_GAP)
    // 两个节点不重叠
    expect(narrow.x).toBeGreaterThan(wide.x + wide.w)
  })

  it('★ 尺寸不一时垂直方向也在格内居中（行高取该行最大）', () => {
    const nodes = [n('tall', 0, 0, 100, 200), n('short', 0, 300, 100, 60)]
    const t = computeArrangeMode(nodes, 'row')
    const tall = { ...nodes[0].rect, ...t.get('tall') }
    const short = { ...nodes[1].rect, ...t.get('short') }
    expect(centerY(short)).toBeCloseTo(centerY(tall), 6)
  })

  it('★ 按位置排序而非传入顺序（框选次序随机也不打乱结果）', () => {
    /**
     * 用 y 错开的一组（都在同一行概念上，但传入顺序随机）：
     * 按「先上后下、先左后右」排，两次传入顺序不同也必须得到同一份结果。
     */
    const layout = [n('a', 0, 0), n('b', 300, 10), n('c', 600, 20)]
    const shuffled = [layout[2], layout[0], layout[1]]
    const a = computeArrangeMode(layout, 'row')
    const b = computeArrangeMode(shuffled, 'row')
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('位置本来就不用动的节点不进结果表（不产生 no-op 补丁）', () => {
    // 已经是规整的 2×2，再排一次不该产生任何位移
    const nodes = [n('a', 0, 0), n('b', 124, 0), n('c', 0, 124), n('d', 124, 124)]
    const t = computeArrangeMode(nodes, 'grid')
    expect(t.size).toBe(0)
  })

  it('单节点也能算，但返回空（≥ 2 才可用）', () => {
    expect(computeArrangeMode([n('a', 10, 20)], 'grid').size).toBe(0)
  })
})
