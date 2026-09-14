import { describe, it, expect } from 'vitest'
import { computeArrange, canArrange, ARRANGE_GAP } from './arrange'
import type { EdgeLike } from '../model/graph'

function n(id: string, x: number, y: number, w = 100, h = 50) {
  return { id, rect: { x, y, w, h } }
}

function e(id: string, source: string, target: string): EdgeLike {
  return { id, source, target }
}

describe('computeArrange', () => {
  it('选中少于 2 个时不整理（§6.5「≥ 2 个节点选中时可用」）', () => {
    const r = computeArrange([n('a', 0, 0)], [])
    expect(r.targets.size).toBe(0)
    expect(r.layers).toEqual([])
  })

  it('按上下游分层：无上游为第 1 层，其后逐层递推（§6.5 层级判定）', () => {
    const r = computeArrange(
      [n('a', 0, 0), n('b', 0, 0), n('c', 0, 0)],
      [e('e1', 'a', 'b'), e('e2', 'b', 'c')],
    )
    expect(r.layers).toEqual([['a'], ['b'], ['c']])
  })

  it('层级从左到右排布，水平间距 24', () => {
    const r = computeArrange(
      [n('a', 0, 0, 100, 50), n('b', 0, 0, 100, 50)],
      [e('e1', 'a', 'b')],
    )
    const ax = r.targets.get('a')?.x ?? 0
    const bx = r.targets.get('b')?.x ?? 0
    expect(bx - ax).toBe(100 + ARRANGE_GAP) // 层宽 100 + 间距 24
  })

  it('同层节点纵向排列，垂直间距 24', () => {
    const r = computeArrange([n('a', 0, 0, 100, 50), n('b', 0, 0, 100, 50)], [])
    const ys = [r.targets.get('a')?.y, r.targets.get('b')?.y]
    expect(Math.abs((ys[1] ?? 0) - (ys[0] ?? 0))).toBe(50 + ARRANGE_GAP)
  })

  it('间距常量即产品文档要求的 24px', () => {
    expect(ARRANGE_GAP).toBe(24)
  })

  it('有环时返回 cycles 且不产出坐标（§6.5「存在环时提示」）', () => {
    const r = computeArrange(
      [n('a', 0, 0), n('b', 0, 0)],
      [e('e1', 'a', 'b'), e('e2', 'b', 'a')],
    )
    expect(r.cycles.length).toBeGreaterThan(0)
    expect(r.targets.size).toBe(0)
    expect(r.layers).toEqual([])
  })

  it('自环也算环', () => {
    const r = computeArrange([n('a', 0, 0), n('b', 0, 0)], [e('e1', 'a', 'a')])
    expect(r.cycles.length).toBeGreaterThan(0)
    expect(r.targets.size).toBe(0)
  })

  it('只看选中集合内部的边：外部节点不参与分层', () => {
    // a → b 相连，但只选中 b 与 c：c 虽无内部上游，b 也无内部上游 → 同层
    const r = computeArrange([n('b', 0, 0), n('c', 0, 0)], [e('e1', 'a', 'b')])
    expect(r.layers).toEqual([['b', 'c']])
  })

  it('以原包围盒中心为锚点原地重排（不把整组甩走）', () => {
    const items = [n('a', 1000, 1000, 100, 50), n('b', 1300, 1000, 100, 50)]
    const before = { x: (1000 + 1300 + 100) / 2, y: (1000 + 1000) / 2 + 25 }
    const r = computeArrange(items, [])
    const xs = items.map((it) => r.targets.get(it.id)?.x ?? it.rect.x)
    const ys = items.map((it) => r.targets.get(it.id)?.y ?? it.rect.y)
    const hs = items.map((it) => it.rect.h)
    const after = {
      x: (Math.min(...xs) + Math.max(...xs) + 100) / 2,
      y: (Math.min(...ys) + Math.max(...ys) + Math.max(...hs)) / 2 - Math.max(...hs) / 2,
    }
    // 中心纵坐标基本保持（±1px 取整误差）
    expect(Math.abs(after.y + 25 - before.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
  })

  it('结果只含需要移动的节点', () => {
    const r = computeArrange([n('a', 0, 0, 100, 50), n('a2', 0, 74, 100, 50)], [])
    expect(r.targets.size).toBe(0) // 已经是 0 / 74（50 + 24），无需移动
  })

  it('多次整理结果稳定（幂等：第二次不再产生移动）', () => {
    const items = [n('a', 0, 0), n('b', 500, 300), n('c', 100, 800)]
    const first = computeArrange(items, [e('e1', 'a', 'b'), e('e2', 'b', 'c')])
    const moved = items.map((it) => {
      const t = first.targets.get(it.id)
      return { id: it.id, rect: { ...it.rect, ...(t ?? {}) } }
    })
    const second = computeArrange(moved, [e('e1', 'a', 'b'), e('e2', 'b', 'c')])
    expect(second.targets.size).toBe(0)
  })

  it('层内按输入顺序稳定排列（同层不因坐标而乱序）', () => {
    const r = computeArrange([n('c', 900, 0), n('a', 0, 0), n('b', 500, 0)], [])
    expect(r.layers).toEqual([['c', 'a', 'b']])
  })

  it('菱形结构：汇合节点在最后一层', () => {
    const r = computeArrange(
      [n('root', 0, 0), n('l', 0, 0), n('r', 0, 0), n('join', 0, 0)],
      [e('e1', 'root', 'l'), e('e2', 'root', 'r'), e('e3', 'l', 'join'), e('e4', 'r', 'join')],
    )
    expect(r.layers).toEqual([['root'], ['l', 'r'], ['join']])
  })
})

describe('canArrange', () => {
  it('需 ≥ 2 个选中', () => {
    expect(canArrange(1)).toBe(false)
    expect(canArrange(2)).toBe(true)
  })
})
