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
  it('是生成类节点：有端点、可生成、接受提示词与生成上游', () => {
    const spec = getSpec('group')!
    expect(spec.ports).toEqual({ input: true, output: true })
    expect(spec.accepts.upstream).toEqual(['prompt', 'generation'])
    expect(spec.accepts.children).toEqual(['prompt', 'generation'])
    expect(spec.accepts.parent).toEqual(['board'])
    // 有 toRunRequest 才会进入 buildRunPlan（isGeneratableType 已含 group）
    expect(typeof spec.toRunRequest).toBe('function')
  })

  it('默认数据是空的 GroupData（含 childIds / hiddenIds / hiddenPromptIds）', () => {
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

  it('collectInputs 按 childIds 顺序取组内素材与提示词', () => {
    const g = graph([
      node({ id: 'grp', type: 'group', data: { childIds: ['img', 'txt'] } as never }),
      node({ id: 'img', type: 'generation', parentId: 'grp', data: { assetHash: 'h1' } as never }),
      node({ id: 'txt', type: 'prompt', parentId: 'grp', data: { text: '一只猫' } as never }),
    ])
    const inputs = getSpec('group')!.collectInputs({ node: g.nodes[0]!, graph: g })
    expect(inputs).toEqual([
      { kind: 'asset', nodeId: 'img', assetHash: 'h1', mime: 'image/png' },
      { kind: 'text', nodeId: 'txt', text: '一只猫' },
    ])
  })

  it('collectInputs 跳过被隐藏的素材与提示词（§6.11 小眼睛）', () => {
    const g = graph([
      node({
        id: 'grp',
        type: 'group',
        data: { childIds: ['a', 'b', 'p'], hiddenIds: ['a'], hiddenPromptIds: ['p'] } as never,
      }),
      node({ id: 'a', type: 'generation', parentId: 'grp', data: { assetHash: 'ha' } as never }),
      node({ id: 'b', type: 'generation', parentId: 'grp', data: { assetHash: 'hb' } as never }),
      node({ id: 'p', type: 'prompt', parentId: 'grp', data: { text: '不参与' } as never }),
    ])
    const inputs = getSpec('group')!.collectInputs({ node: g.nodes[0]!, graph: g })
    expect(inputs).toEqual([{ kind: 'asset', nodeId: 'b', assetHash: 'hb', mime: 'image/png' }])
  })

  it('collectInputs 同时收取外部上游（组内 + 组外，§6.11「与生成节点完全一致」）', () => {
    const g = graph(
      [
        node({ id: 'grp', type: 'group', data: { childIds: ['img'] } as never }),
        node({ id: 'img', type: 'generation', parentId: 'grp', data: { assetHash: 'in' } as never }),
        node({ id: 'out', type: 'generation', data: { assetHash: 'up' } as never }),
      ],
      [{ id: 'e1', projectId: 'p1', source: 'out', target: 'grp' }],
    )
    const inputs = getSpec('group')!.collectInputs({ node: g.nodes[0]!, graph: g })
    expect(inputs.map((i) => (i.kind === 'asset' ? i.assetHash : i.kind === 'text' ? i.text : ''))).toEqual([
      'in',
      'up',
    ])
  })

  it('toRunRequest 未配渠道 / 模型时返回 null；配好时把组内文本拼成提示词', () => {
    const spec = getSpec('group')!
    const base = graph([node({ id: 'grp', type: 'group', data: { childIds: [] } as never })])
    expect(spec.toRunRequest!({ node: base.nodes[0]!, inputs: [], params: base.nodes[0]!.data, graph: base })).toBeNull()

    const ok = graph([
      node({
        id: 'grp',
        type: 'group',
        data: { childIds: [], mode: 'image', channelId: 'ch1', model: 'm1', prompt: '' } as never,
      }),
    ])
    const req = spec.toRunRequest!({
      node: ok.nodes[0]!,
      inputs: [{ kind: 'text', nodeId: 't', text: '写实风格' }],
      params: ok.nodes[0]!.data,
      graph: ok,
    })
    expect(req).toMatchObject({ kind: 'image', channelId: 'ch1', model: 'm1', prompt: '写实风格' })
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
