import { describe, it, expect, beforeEach } from 'vitest'
import { registerAllSpecs, resetSpecs } from './index'
import { getSpec } from './registry'
import { childIdsOf } from './group'
import type { GraphSnapshot } from '../model/graph'
import type { GroupData, NodeSnapshot } from '../model/node'

function node(over: Partial<NodeSnapshot> & { id: string; type: NodeSnapshot['type'] }): NodeSnapshot {
  return {
    projectId: 'p1',
    parentId: null,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    title: over.id,
    disabled: false,
    data: {},
    ...over,
  } as NodeSnapshot
}

function graph(nodes: NodeSnapshot[], edges: GraphSnapshot['edges'] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges, }
}

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

describe('分组规格（§6.11）', () => {
  /**
   * ★★ 组**不做生成**（用户 2026-10-06 第 13 批第 5 条：「就不是把他当成生成节点了」）。
   *
   * 这条口径在 spec 上的落点是**能力缺失**：没有输入端点、没有 toRunRequest / generate
   * ⇒ 它进不了执行计划（buildRunPlan 靠"有没有生成入口"判定），最多是"整组执行"时
   * 被当成"没有可跑的东西"。
   */
  it('★★ 不是生成节点：只有右端点，没有 toRunRequest / generate', () => {
    const spec = getSpec('group')!
    expect(spec.ports).toEqual({ input: false, output: true })
    expect(spec.toRunRequest).toBeUndefined()
    expect(spec.generate).toBeUndefined()
    /** 不接上游：要让组内节点吃到上游，直接连到那个成员上（规则 4 已按新口径放宽） */
    expect(spec.accepts.upstream).toEqual([])
    expect(spec.accepts.children).toEqual(['prompt', 'generation'])
  })

  it('★ collectInputs 如实返回空数组（组自己什么都不吃）', () => {
    const g = graph([
      node({ id: 'grp', type: 'group', data: { childIds: ['img', 'txt'] } as never }),
      node({ id: 'img', type: 'generation', parentId: 'grp', data: { assetHash: 'h1' } as never }),
      node({ id: 'txt', type: 'prompt', parentId: 'grp', data: { text: '一只猫' } as never }),
    ])
    expect(getSpec('group')!.collectInputs({ node: g.nodes[0]!, graph: g })).toEqual([])
  })

  it('默认数据仍是空的 GroupData（含 childIds / hiddenIds / hiddenPromptIds —— 认识旧工程）', () => {
    const data = getSpec('group')!.createDefaultData() as GroupData
    expect(data).toMatchObject({
      mode: 'image',
      prompt: '',
      channelId: '',
      model: '',
      childIds: [],
      hiddenIds: [],
      hiddenPromptIds: [],
    })
  })
})

describe('childIdsOf：以图为准、childIds 只作排序', () => {
  it('childIds 里的顺序优先，刚拖入（未写 childIds）的补在尾部', () => {
    const g = graph([
      node({ id: 'grp', type: 'group', data: { childIds: ['c2', 'c1'] } as never }),
      node({ id: 'c1', type: 'generation', parentId: 'grp' }),
      node({ id: 'c2', type: 'generation', parentId: 'grp' }),
      node({ id: 'c3', type: 'generation', parentId: 'grp' }),
    ])
    expect(childIdsOf(g.nodes[0]! as never, g as never)).toEqual(['c2', 'c1', 'c3'])
  })

  it('childIds 指向已不在组内的节点时忽略它', () => {
    const g = graph([
      node({ id: 'grp', type: 'group', data: { childIds: ['gone', 'c1'] } as never }),
      node({ id: 'c1', type: 'generation', parentId: 'grp' }),
    ])
    expect(childIdsOf(g.nodes[0]! as never, g as never)).toEqual(['c1'])
  })
})
