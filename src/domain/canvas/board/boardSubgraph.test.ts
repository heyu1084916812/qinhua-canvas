import { describe, it, expect } from 'vitest'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot } from '../model/node'
import { boardSubgraph } from './boardSubgraph'

function node(p: Partial<NodeSnapshot> & Pick<NodeSnapshot, 'id' | 'type' | 'data'>): NodeSnapshot {
  return {
    projectId: 'p',
    parentId: null,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    title: p.id,
    disabled: false,
    ...p,
  } as NodeSnapshot
}

function makeGraph(): GraphSnapshot {
  const nodes: NodeSnapshot[] = [
    node({
      id: 'p1',
      type: 'prompt',
      data: { text: 'a', upstreamPromptLinked: false },
    }),
    node({
      id: 'g1',
      type: 'generation',
      data: { mode: 'image', prompt: '', linkedPromptNodeIds: ['p1'], channelId: 'c', model: 'm', thumbOrder: [], upstreamHidden: [] },
    }),
    node({
      id: 'b1',
      type: 'board',
      data: { bg: { color: '#fff', opacity: 1 }, strokes: [], texts: [] },
    }),
    node({
      id: 'pb',
      type: 'prompt',
      parentId: 'b1',
      x: 10,
      y: 10,
      data: { text: 'b', upstreamPromptLinked: false },
    }),
    node({
      id: 'gb',
      type: 'generation',
      parentId: 'b1',
      x: 10,
      y: 90,
      data: { mode: 'image', prompt: '', linkedPromptNodeIds: ['pb'], channelId: 'c', model: 'm', thumbOrder: [], upstreamHidden: [] },
    }),
  ]
  const edges: GraphSnapshot['edges'] = [
    { id: 'e1', projectId: 'p', source: 'p1', target: 'g1' },
    { id: 'e2', projectId: 'p', source: 'pb', target: 'gb' },
    { id: 'e3', projectId: 'p', source: 'g1', target: 'pb' }, // 跨画板边，应被排除
  ]
  return { projectId: 'p', nodes, edges, resultGroups: [] }
}

describe('boardSubgraph', () => {
  it('只返回画板直接子节点', () => {
    const sg = boardSubgraph(makeGraph(), 'b1')
    expect(sg.nodes.map((n) => n.id).sort()).toEqual(['gb', 'pb'])
  })

  it('只保留两端都在子图内的边（排除跨画板边）', () => {
    const sg = boardSubgraph(makeGraph(), 'b1')
    expect(sg.edges.map((e) => e.id)).toEqual(['e2'])
  })

  it('projectId 沿用父图', () => {
    expect(boardSubgraph(makeGraph(), 'b1').projectId).toBe('p')
  })

  it('空画板返回空子图', () => {
    const sg = boardSubgraph(makeGraph(), 'p1') // p1 不是画板，无子节点
    expect(sg.nodes).toHaveLength(0)
    expect(sg.edges).toHaveLength(0)
  })
})
