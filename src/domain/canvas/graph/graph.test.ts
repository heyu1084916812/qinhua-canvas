import { describe, it, expect } from 'vitest'
import { canConnect } from './canConnect'
import { edgesToDropOnReparent, canReparent, applyReparent } from './reparent'
import { traverseDownstream } from './traverseDownstream'
import { directUpstream, upstreamOf, downstreamOf } from './upstreamOf'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot, NodeType } from '../model/node'

function node(id: string, type: NodeType = 'generation', parentId: string | null = null): NodeSnapshot {
  const data =
    type === 'prompt'
      ? { text: '', upstreamPromptLinked: false }
      : { mode: 'image' as const, prompt: '', linkedPromptNodeIds: [], channelId: '', model: '', thumbOrder: [], upstreamHidden: [] }
  return {
    id,
    projectId: 'p1',
    type,
    parentId,
    x: parentId ? 0 : 100,
    y: parentId ? 0 : 100,
    w: 200,
    h: 200,
    title: id,
    disabled: false,
    data,
  }
}

function graph(nodes: NodeSnapshot[], pairs: [string, string][] = []): GraphSnapshot {
  return {
    projectId: 'p1',
    nodes,
    edges: pairs.map(([source, target]) => ({ id: `${source}->${target}`, projectId: 'p1', source, target })),
  }
}

describe('连线合法性', () => {
  it('普通连接放行', () => {
    const g = graph([node('a', 'prompt'), node('b')])
    expect(canConnect(g.nodes[0]!, g.nodes[1]!, g).ok).toBe(true)
  })

  it('不能连自己', () => {
    const g = graph([node('a')])
    expect(canConnect(g.nodes[0]!, g.nodes[0]!, g)).toEqual({ ok: false, reason: '不能连自己' })
  })

  it('重复连线被拒绝', () => {
    const g = graph([node('a', 'prompt'), node('b')], [['a', 'b']])
    expect(canConnect(g.nodes[0]!, g.nodes[1]!, g).ok).toBe(false)
  })

  it('画板没有端点', () => {
    const g = graph([node('a', 'prompt'), node('b', 'board')])
    expect(canConnect(g.nodes[0]!, g.nodes[1]!, g)).toEqual({ ok: false, reason: '画板没有端点' })
  })

  it('画板内外不建立边', () => {
    const g = graph([node('a', 'generation', 'board1'), node('board1', 'board'), node('out')])
    const inner = g.nodes[0]!
    const outer = g.nodes[2]!
    expect(canConnect(inner, outer, g)).toEqual({ ok: false, reason: '画板内外不建立边' })
  })

  it('容器内子节点不与外部连线', () => {
    const g = graph([node('a', 'generation', 'g1'), node('g1', 'group'), node('out')])
    expect(canConnect(g.nodes[0]!, g.nodes[2]!, g)).toEqual({ ok: false, reason: '容器内节点不直接与外部连线' })
  })

  it('会成环的连接被拒绝', () => {
    const g = graph([node('a', 'prompt'), node('b'), node('c')], [['a', 'b'], ['b', 'c']])
    expect(canConnect(g.nodes[2]!, g.nodes[0]!, g)).toEqual({ ok: false, reason: '会形成环路' })
  })
})

describe('父子归属变更', () => {
  it('不能放进自己或自己的后代', () => {
    const g = graph([node('a', 'group'), node('b', 'generation', 'a')])
    expect(canReparent(g.nodes[0]!, g.nodes[0]!, g).ok).toBe(false)
    expect(canReparent(g.nodes[1]!, g.nodes[1]!, g).ok).toBe(false)
  })

  it('拖回画布根总是允许', () => {
    const g = graph([node('a', 'group'), node('b', 'generation', 'a')])
    expect(canReparent(g.nodes[1]!, null, g).ok).toBe(true)
  })

  it('进入容器换算为相对坐标，拖出换回世界坐标', () => {
    const g = graph([node('a', 'group'), node('b', 'generation')])
    const into = applyReparent(g.nodes[1]!, 'a', g)
    expect(into.parentId).toBe('a')
    const out = applyReparent(into, null, g)
    expect(out.parentId).toBeNull()
    expect(out.x).toBeCloseTo(g.nodes[1]!.x, 10)
  })

  it('重挂父级时列出需要清理的连线', () => {
    const g = graph([node('a'), node('b')], [['a', 'b']])
    expect(edgesToDropOnReparent('a', g.edges)).toEqual(['a->b'])
    expect(edgesToDropOnReparent('c', g.edges)).toEqual([])
  })
})

describe('上下游解析', () => {
  const g = graph([node('a'), node('b'), node('c')], [['a', 'b'], ['b', 'c']])

  it('直接上游与全部上游', () => {
    expect(directUpstream('b', g.edges)).toEqual(['a'])
    expect(upstreamOf('c', g.edges)).toEqual(['b', 'a'])
  })

  it('全部下游', () => {
    expect(downstreamOf('a', g.edges)).toEqual(['b', 'c'])
  })
})

describe('下游遍历', () => {
  const g = graph([node('a'), node('b'), node('c'), node('d')], [['a', 'b'], ['b', 'c'], ['a', 'd']])

  it('深度优先覆盖全部下游', () => {
    const seen: string[] = []
    traverseDownstream('a', g, (n) => {
      seen.push(n.id)
    })
    expect(seen).toEqual(['a', 'b', 'c', 'd'])
  })

  it('返回 false 终止该分支', () => {
    const seen: string[] = []
    traverseDownstream('a', g, (n) => {
      seen.push(n.id)
      return n.id === 'b' ? false : undefined
    })
    expect(seen).toEqual(['a', 'b', 'd'])
  })

  it('带 depth 参数', () => {
    const depths: number[] = []
    traverseDownstream('a', g, (_n, depth) => {
      depths.push(depth)
    })
    expect(Math.max(...depths)).toBe(2)
  })
})
