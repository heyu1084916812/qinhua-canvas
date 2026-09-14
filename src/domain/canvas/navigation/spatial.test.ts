import { describe, it, expect } from 'vitest'
import type { NavNode } from './spatial'
import { sortByPosition, firstNodeId, lastNodeId, nextNodeId, nearestInDirection } from './spatial'

// 布局（坐标单位任意）：
//   A(0,0)   B(200,0)
//   C(0,200) D(200,200)
function make(id: string, x: number, y: number): NavNode {
  return { id, rect: { x, y, w: 100, h: 80 } }
}
const nodes: NavNode[] = [make('A', 0, 0), make('B', 200, 0), make('C', 0, 200), make('D', 200, 200)]

describe('sortByPosition', () => {
  it('按 y 再 x 排序（上→下、左→右）', () => {
    expect(sortByPosition(nodes).map((n) => n.id)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('不修改入参', () => {
    const copy = [...nodes]
    sortByPosition(nodes)
    expect(nodes).toEqual(copy)
  })
})

describe('first / last', () => {
  it('首节点是左上 A', () => expect(firstNodeId(nodes)).toBe('A'))
  it('末节点是右下 D', () => expect(lastNodeId(nodes)).toBe('D'))
  it('空列表返回 null', () => {
    expect(firstNodeId([])).toBeNull()
    expect(lastNodeId([])).toBeNull()
  })
})

describe('nextNodeId（Tab 循环）', () => {
  it('currentId 为 null 取排序首个', () => expect(nextNodeId(nodes, null)).toBe('A'))
  it('A 之后是 B', () => expect(nextNodeId(nodes, 'A')).toBe('B'))
  it('D 之后回环到 A', () => expect(nextNodeId(nodes, 'D')).toBe('A'))
  it('未知 id 回退到首个', () => expect(nextNodeId(nodes, 'zzz')).toBe('A'))
  it('单节点时停在自身', () => expect(nextNodeId([make('X', 0, 0)], 'X')).toBe('X'))
})

describe('nearestInDirection', () => {
  it('从 A 向右命中 B（同轴优先，而非更近的 C）', () => {
    expect(nearestInDirection(nodes, 'A', 'right')).toBe('B')
  })
  it('从 A 向下命中 C', () => {
    expect(nearestInDirection(nodes, 'A', 'down')).toBe('C')
  })
  it('从 B 向左命中 A', () => {
    expect(nearestInDirection(nodes, 'B', 'left')).toBe('A')
  })
  it('从 C 向上命中 A', () => {
    expect(nearestInDirection(nodes, 'C', 'up')).toBe('A')
  })
  it('右侧无节点时返回 null', () => {
    expect(nearestInDirection([make('A', 0, 0)], 'A', 'right')).toBeNull()
  })
  it('同轴优先于斜向更近：C 的右侧应取 D 而非 B（B 在上方）', () => {
    // B 在 A 行、D 在 C 行；从 C 向右，B 虽 x 更近但 y 偏移大，应取同轴的 D
    expect(nearestInDirection(nodes, 'C', 'right')).toBe('D')
  })
})
