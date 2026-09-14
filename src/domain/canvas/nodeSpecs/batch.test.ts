import { describe, it, expect, beforeEach } from 'vitest'
import { registerAllSpecs, resetSpecs } from './index'
import { getSpec } from './registry'
import { batchItemsOf, batchItemCount, canAcceptIntoBatch, contentTypeOf, externalInputsOf } from './batch'
import { batchData, genData, promptData } from '../../../dev/preview/fixtures'
import type { GraphSnapshot } from '../model/graph'
import type { BatchData, NodeSnapshot } from '../model/node'

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
  return { projectId: 'p1', nodes, edges, resultGroups: [] }
}

/** 一个装了指定子节点的批量节点（子节点 id 由调用方给定；`t-` 前缀视为提示词节点） */
function batchWith(childIds: string[], over: Partial<BatchData> = {}): { batch: NodeSnapshot; g: GraphSnapshot } {
  const children: NodeSnapshot[] = []
  for (const id of childIds) {
    const isPrompt = id.startsWith('t-')
    children.push(
      isPrompt
        ? node({ id, type: 'prompt', parentId: 'bp', data: promptData({ text: `文本:${id}` }) as never })
        : node({ id, type: 'generation', parentId: 'bp', data: genData({ assetHash: `h:${id}` }) as never }),
    )
  }
  const batch = node({ id: 'bp', type: 'batch', data: batchData({ childIds, hiddenIds: [], ...over }) as never })
  return { batch, g: graph([batch, ...children]) }
}

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

describe('批量节点规格（§6.12）', () => {
  it('是生成类节点：有端点、接受提示词与生成上游、只能放在画板里', () => {
    const spec = getSpec('batch')!
    expect(spec.type).toBe('batch')
    expect(spec.label).toBe('批量')
    expect(spec.ports).toEqual({ input: true, output: true })
    expect(spec.accepts.upstream).toEqual(['prompt', 'generation'])
    expect(spec.accepts.children).toEqual(['prompt', 'generation'])
    expect(spec.accepts.parent).toEqual(['board'])
    expect(spec.sizing.lockAspect).toBe(true)
    expect(typeof spec.toRunRequest).toBe('function')
  })

  it('默认数据是空的 BatchData，默认按素材集合（media）', () => {
    const data = getSpec('batch')!.createDefaultData() as BatchData
    expect(data).toMatchObject({
      mode: 'image',
      prompt: '',
      channelId: '',
      model: '',
      childIds: [],
      hiddenIds: [],
      contentType: 'media',
    })
  })

  it('collectInputs 把集合本体包成一个 collection 项（§6.12 批量 vs 分组的分界）', () => {
    const { batch, g } = batchWith(['img-1', 't-1', 'img-2'])
    const spec = getSpec('batch')!
    // 必须包成 collection：平铺会退化成「一张出图用全部素材」（= 分组语义）
    expect(spec.collectInputs({ node: batch, graph: g })).toEqual([
      {
        kind: 'collection',
        nodeId: 'bp',
        items: [
          { kind: 'asset', nodeId: 'img-1', assetHash: 'h:img-1', mime: 'image/png' },
          { kind: 'text', nodeId: 't-1', text: '文本:t-1' },
          { kind: 'asset', nodeId: 'img-2', assetHash: 'h:img-2', mime: 'image/png' },
        ],
      },
    ])
  })

  it('collectInputs 跳过被隐藏的集合项', () => {
    const { batch, g } = batchWith(['img-1', 'img-2'], { hiddenIds: ['img-1'] })
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: g })).toEqual([
      {
        kind: 'collection',
        nodeId: 'bp',
        items: [{ kind: 'asset', nodeId: 'img-2', assetHash: 'h:img-2', mime: 'image/png' }],
      },
    ])
  })

  it('空集合时只返回外部上游（没有可迭代项，不做空洞展开）', () => {
    const { batch, g } = batchWith([])
    const withUpstream = graph(
      [...g.nodes, node({ id: 'ext', type: 'generation', data: genData({ assetHash: 'h-ext' }) as never })],
      [{ id: 'e1', projectId: 'p1', source: 'ext', target: 'bp' }],
    )
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: withUpstream })).toEqual([
      { kind: 'asset', nodeId: 'ext', assetHash: 'h-ext', mime: 'image/png' },
    ])
    // 完全没有内容的空批量 → 空输入
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: g })).toEqual([])
  })

  it('collectInputs 把外部上游放在集合项之后（场景 2/4「+ 外部 1 张」）', () => {
    const { batch, g } = batchWith(['img-1', 'img-2'])
    const withUpstream = graph(
      [...g.nodes, node({ id: 'ext', type: 'generation', data: genData({ assetHash: 'h-ext' }) as never })],
      [{ id: 'e1', projectId: 'p1', source: 'ext', target: 'bp' }],
    )
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: withUpstream })).toEqual([
      {
        kind: 'collection',
        nodeId: 'bp',
        items: [
          { kind: 'asset', nodeId: 'img-1', assetHash: 'h:img-1', mime: 'image/png' },
          { kind: 'asset', nodeId: 'img-2', assetHash: 'h:img-2', mime: 'image/png' },
        ],
      },
      { kind: 'asset', nodeId: 'ext', assetHash: 'h-ext', mime: 'image/png' },
    ])
  })

  it('toRunRequest 未配渠道 / 模型或没有提示词时返回 null', () => {
    const spec = getSpec('batch')!
    // 空数据：渠道 / 模型先缺，直接 null
    const empty = graph([node({ id: 'bp', type: 'batch', data: { childIds: [] } as never })])
    expect(spec.toRunRequest!({ node: empty.nodes[0]!, inputs: [], params: empty.nodes[0]!.data, graph: empty })).toBeNull()

    // 渠道 / 模型都配了，但没有提示词（自身与上游都没有）→ 仍为 null
    const noPrompt = graph([
      node({ id: 'bp', type: 'batch', data: batchData({ channelId: 'ch1', model: 'm1' }) as never }),
    ])
    expect(
      spec.toRunRequest!({ node: noPrompt.nodes[0]!, inputs: [], params: noPrompt.nodes[0]!.data, graph: noPrompt }),
    ).toBeNull()
  })

  it('toRunRequest 配齐后把集合文本拼成提示词（与生成节点同源）', () => {
    const spec = getSpec('batch')!
    const g = graph([
      node({ id: 'bp', type: 'batch', data: batchData({ channelId: 'ch1', model: 'm1', prompt: '' }) as never }),
    ])
    const req = spec.toRunRequest!({
      node: g.nodes[0]!,
      inputs: [{ kind: 'text', nodeId: 't', text: '批量提示词' }],
      params: g.nodes[0]!.data,
      graph: g,
    })
    expect(req).toMatchObject({ kind: 'image', channelId: 'ch1', model: 'm1', prompt: '批量提示词' })
  })
})

describe('batchItemsOf / batchItemCount / contentTypeOf', () => {
  it('元素清单按 childIds 顺序、隐藏项跳过、顺序即集合卡顺序', () => {
    const { batch, g } = batchWith(['img-2', 'img-1', 't-1'])
    expect(batchItemsOf(batch as never, g).map((i) => i.nodeId)).toEqual(['img-2', 'img-1', 't-1'])
    expect(batchItemCount(batch as never, g)).toBe(3)
  })

  it('内容类型由集合内首个子节点推断；空集合回落到声明的 contentType', () => {
    expect(contentTypeOf(batchWith(['img-1', 't-1']).batch as never, batchWith(['img-1', 't-1']).g)).toBe('media')
    const p = batchWith(['t-1', 'img-1'])
    expect(contentTypeOf(p.batch as never, p.g)).toBe('prompt')

    const empty = graph([node({ id: 'bp', type: 'batch', data: { childIds: [], contentType: 'prompt' } as never })])
    expect(contentTypeOf(empty.nodes[0] as never, empty)).toBe('prompt')
  })

  it('externalInputsOf 只取连线来的直接上游，不取集合内部子节点', () => {
    const { batch, g } = batchWith(['img-1'])
    const withUpstream = graph(
      [...g.nodes, node({ id: 'ext', type: 'prompt', data: promptData({ text: '外部提示' }) as never })],
      [{ id: 'e1', projectId: 'p1', source: 'ext', target: 'bp' }],
    )
    expect(externalInputsOf(batch as never, withUpstream)).toEqual([
      { kind: 'text', nodeId: 'ext', text: '外部提示' },
    ])
  })
})

describe('二选一互斥（§6.12）', () => {
  it('空集合两种类型都收', () => {
    const { batch, g } = batchWith([])
    expect(canAcceptIntoBatch(batch as never, 'generation', g)).toBeNull()
    expect(canAcceptIntoBatch(batch as never, 'prompt', g)).toBeNull()
  })

  it('已有素材时拒绝提示词，并给出可读原因', () => {
    const { batch, g } = batchWith(['img-1'])
    const reason = canAcceptIntoBatch(batch as never, 'prompt', g)
    expect(reason).toBe('批量节点内已有素材，只能收纳同类内容')
    expect(canAcceptIntoBatch(batch as never, 'generation', g)).toBeNull()
  })

  it('已有提示词时拒绝素材', () => {
    const { batch, g } = batchWith(['t-1'])
    expect(canAcceptIntoBatch(batch as never, 'generation', g)).toBe('批量节点内已有提示词，只能收纳同类内容')
    expect(canAcceptIntoBatch(batch as never, 'prompt', g)).toBeNull()
  })
})
