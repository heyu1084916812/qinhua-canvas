import { describe, it, expect, beforeAll } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { boardSubgraph } from '../../../domain/canvas/board/boardSubgraph'
import { buildRunPlan } from './buildRunPlan'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { registerAllSpecs, getSpec } from '../../../domain/canvas/nodeSpecs'

beforeAll(() => {
  registerAllSpecs()
})

function gen(parentId: string | null, id: string, linked: string[]): NodeSnapshot {
  return {
    id,
    projectId: 'p',
    type: 'generation',
    parentId,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    title: id,
    disabled: false,
    data: {
      ...generationSpec.createDefaultData(),
      channelId: 'c',
      model: 'm',
      prompt: 'hi',
      linkedPromptNodeIds: linked,
    },
  } as NodeSnapshot
}
function prompt(parentId: string | null, id: string): NodeSnapshot {
  return {
    id,
    projectId: 'p',
    type: 'prompt',
    parentId,
    x: 0,
    y: 0,
    w: 160,
    h: 80,
    title: id,
    disabled: false,
    data: { text: 'x', upstreamPromptLinked: false },
  } as NodeSnapshot
}
function board(id: string): NodeSnapshot {
  return {
    id,
    projectId: 'p',
    type: 'board',
    parentId: null,
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    title: id,
    disabled: false,
    data: { bg: { color: '#fff', opacity: 1 }, strokes: [], texts: [] },
  } as NodeSnapshot
}

function makeGraph(): GraphSnapshot {
  const nodes: NodeSnapshot[] = [
    prompt(null, 'p1'),
    gen(null, 'g1', ['p1']),
    board('b1'),
    prompt('b1', 'pb'),
    gen('b1', 'gb', ['pb']),
  ]
  const edges: GraphSnapshot['edges'] = [
    { id: 'e1', projectId: 'p', source: 'p1', target: 'g1' },
    { id: 'e2', projectId: 'p', source: 'pb', target: 'gb' },
  ]
  return { projectId: 'p', nodes, edges, }
}

describe('buildRunPlan · 画板子图', () => {
  it('rerunAll 选出画板内可生成节点，不含画板外节点', () => {
    expect(getSpec('generation')).not.toBeNull()
    const graph = makeGraph()
    const sg = boardSubgraph(graph, 'b1')
    const plan = buildRunPlan('board', { subgraph: sg }, graph, 'rerunAll')
    expect(plan.tasks.map((t) => t.nodeId)).toEqual(['gb'])
  })

  it('boardSubgraph 仅含画板内节点与内部连线', () => {
    const graph = makeGraph()
    const sg = boardSubgraph(graph, 'b1')
    expect(sg.nodes.map((n) => n.id).sort()).toEqual(['gb', 'pb'])
    expect(sg.edges.map((e) => e.id)).toEqual(['e2'])
  })
})
