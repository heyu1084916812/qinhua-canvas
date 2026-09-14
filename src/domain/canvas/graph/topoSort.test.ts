import { describe, it, expect } from 'vitest'
import { topoSort, findCycles, hasCycle, isReachable } from './topoSort'
import type { NodeLike, EdgeLike } from '../model/graph'

function nodes(...ids: string[]): NodeLike[] {
  return ids.map((id) => ({ id, parentId: null, type: 'generation', x: 0, y: 0, w: 100, h: 100 }))
}

function edge(source: string, target: string): EdgeLike {
  return { id: `${source}->${target}`, source, target }
}

describe('拓扑排序', () => {
  it('线性链按顺序输出', () => {
    const result = topoSort(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c')])
    expect(result.order).toEqual(['a', 'b', 'c'])
    expect(result.cycles).toEqual([])
  })

  it('分叉结构：每条边的源都排在目标之前', () => {
    const ns = nodes('a', 'b', 'c', 'd')
    const es = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]
    const { order } = topoSort(ns, es)
    for (const e of es) {
      expect(order.indexOf(e.source)).toBeLessThan(order.indexOf(e.target))
    }
  })

  it('孤立节点全部保留', () => {
    const { order } = topoSort(nodes('a', 'b'), [])
    expect(order).toHaveLength(2)
  })

  it('有环时报告环路且只输出可排序部分', () => {
    const result = topoSort(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')])
    expect(result.cycles).toHaveLength(1)
    expect(result.cycles[0]!.sort()).toEqual(['b', 'c'])
    expect(result.order).toEqual(['a'])
    expect(hasCycle(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')])).toBe(true)
  })

  it('自环也算环', () => {
    expect(findCycles(nodes('a'), [edge('a', 'a')])).toEqual([['a']])
  })

  it('忽略指向未知节点的边', () => {
    const result = topoSort(nodes('a'), [edge('a', 'ghost')])
    expect(result.order).toEqual(['a'])
  })
})

describe('可达性', () => {
  const es = [edge('a', 'b'), edge('b', 'c')]

  it('沿边方向可达', () => {
    expect(isReachable(es, 'a', 'c')).toBe(true)
  })

  it('反向不可达（这是连线前成环预判的依据）', () => {
    expect(isReachable(es, 'c', 'a')).toBe(false)
  })

  it('自身视为可达', () => {
    expect(isReachable(es, 'a', 'a')).toBe(true)
  })
})

describe('随机 DAG 属性测试', () => {
  it('随机生成的 DAG 拓扑序始终满足边方向', () => {
    // 确定性伪随机（LCG），保证可复现
    let seed = 42
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    for (let round = 0; round < 50; round += 1) {
      const n = 3 + Math.floor(rand() * 20)
      const ns = nodes(...Array.from({ length: n }, (_, i) => `n${i}`))
      const es: EdgeLike[] = []
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          if (rand() < 0.2) es.push(edge(`n${i}`, `n${j}`)) // 只连 i<j，天然无环
        }
      }
      const { order, cycles } = topoSort(ns, es)
      expect(cycles).toEqual([])
      expect(order).toHaveLength(n)
      for (const e of es) {
        expect(order.indexOf(e.source)).toBeLessThan(order.indexOf(e.target))
      }
    }
  })
})
