import { describe, it, expect } from 'vitest'
import { planSlots } from './slotPlacement'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot } from '../model/node'

function gen(id: string, title: string, assetHash?: string): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    title,
    disabled: false,
    data: {
      mode: 'image',
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: 'c1',
      model: 'm1',
      thumbOrder: [],
      upstreamHidden: [],
      ...(assetHash ? { assetHash } : {}),
    },
  }
}

function graph(nodes: NodeSnapshot[], edges: { source: string; target: string }[]): GraphSnapshot {
  return {
    projectId: 'p1',
    nodes,
    edges: edges.map((e) => ({ id: `${e.source}->${e.target}`, projectId: 'p1', ...e })),
    resultGroups: [],
  }
}

describe('空槽位 BFS（产品文档 §6.19.3）', () => {
  it('触发节点为空时优先填自己', () => {
    const g = graph([gen('a', '节点A'), gen('b', '节点B', 'h1')], [{ source: 'a', target: 'b' }])
    const plans = planSlots({ startNodeId: 'a', graph: g, count: 1 })
    expect(plans).toEqual([{ kind: 'reuse', nodeId: 'a' }])
  })

  it('触发节点有内容时跳过，落下游空槽', () => {
    const g = graph([gen('a', '节点A', 'h1'), gen('b', '节点B')], [{ source: 'a', target: 'b' }])
    const plans = planSlots({ startNodeId: 'a', graph: g, count: 1 })
    expect(plans).toEqual([{ kind: 'reuse', nodeId: 'b' }])
  })

  it('槽位不够时铺新节点并命名「原节点名的输出N」', () => {
    const g = graph([gen('a', '节点A', 'h1'), gen('b', '节点B', 'h2')], [{ source: 'a', target: 'b' }])
    const plans = planSlots({ startNodeId: 'a', graph: g, count: 2 })
    expect(plans).toHaveLength(2)
    expect(plans[0]).toEqual({ kind: 'new', title: '节点A的输出1', connectFrom: 'a' })
    expect(plans[1]).toEqual({ kind: 'new', title: '节点A的输出2', connectFrom: 'a' })
  })

  it('count > 1 时累加，已找到的槽位视为占用', () => {
    const g = graph(
      [gen('a', '节点A'), gen('b', '节点B'), gen('c', '节点C')],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    )
    const plans = planSlots({ startNodeId: 'a', graph: g, count: 3 })
    expect(plans.map((p) => (p.kind === 'reuse' ? p.nodeId : 'new'))).toEqual(['a', 'b', 'c'])
  })

  it('count=3 但只有 1 个空槽：1 复用 + 2 新建', () => {
    const g = graph([gen('a', '节点A'), gen('b', '节点B', 'h1')], [{ source: 'a', target: 'b' }])
    const plans = planSlots({ startNodeId: 'a', graph: g, count: 3 })
    expect(plans.filter((p) => p.kind === 'reuse')).toHaveLength(1)
    expect(plans.filter((p) => p.kind === 'new')).toHaveLength(2)
  })

  it('Alt+R：不复用旧内容，全部铺新下游节点', () => {
    const g = graph([gen('a', '节点A'), gen('b', '节点B')], [{ source: 'a', target: 'b' }])
    const plans = planSlots({ startNodeId: 'a', graph: g, count: 2, newDownstream: true })
    expect(plans.every((p) => p.kind === 'new')).toBe(true)
    expect(plans.map((p) => (p.kind === 'new' ? p.title : ''))).toEqual(['节点A的输出1', '节点A的输出2'])
  })

  it('起始节点不存在时返回空', () => {
    const g = graph([gen('a', '节点A')], [])
    expect(planSlots({ startNodeId: 'ghost', graph: g, count: 1 })).toEqual([])
  })
})
