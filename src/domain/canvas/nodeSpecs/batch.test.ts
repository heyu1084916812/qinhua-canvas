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
  return { projectId: 'p1', nodes, edges, }
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
    // loop 于 2026-09-22 并入（§6.22）：循环节点分发的输入也能进批量
    // fusion 于 2026-09-29 并入（§6.23）：融合产物同样是「一张图」
    expect(spec.accepts.upstream).toEqual(['prompt', 'generation', 'loop', 'fusion'])
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

  /**
   * 语义更新（用户 2026-09-17）：外部连线的**素材**现在也进集合，
   * 于是「空批量 + 外部 1 张素材」会展开成 1 次调用（不是 0 次）。
   * 外部连线的**提示词**不进集合——它不是素材，不该被拆开迭代。
   */
  it('空集合 + 外部素材：素材进集合，提示词仍是共同输入', () => {
    const { batch, g } = batchWith([])
    const withUpstream = graph(
      [...g.nodes, node({ id: 'ext', type: 'generation', data: genData({ assetHash: 'h-ext' }) as never })],
      [{ id: 'e1', projectId: 'p1', source: 'ext', target: 'bp' }],
    )
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: withUpstream })).toEqual([
      {
        kind: 'collection',
        nodeId: 'bp',
        items: [{ kind: 'asset', nodeId: 'ext', assetHash: 'h-ext', mime: 'image/png' }],
      },
    ])
    // 外部是提示词节点 → 不进集合，原样作为共同输入
    const withPrompt = graph(
      [...g.nodes, node({ id: 'p', type: 'prompt', data: promptData({ text: '外部提示' }) as never })],
      [{ id: 'e2', projectId: 'p1', source: 'p', target: 'bp' }],
    )
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: withPrompt })).toEqual([
      { kind: 'text', nodeId: 'p', text: '外部提示' },
    ])
    // 完全没有内容的空批量 → 空输入
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: g })).toEqual([])
  })

  it('外部素材追加进集合，外部提示词放在集合之后（场景 2/4 的「+ 外部 1 张」）', () => {
    const { batch, g } = batchWith(['img-1', 'img-2'])
    const withUpstream = graph(
      [
        ...g.nodes,
        node({ id: 'ext', type: 'generation', data: genData({ assetHash: 'h-ext' }) as never }),
        node({ id: 'p', type: 'prompt', data: promptData({ text: '共同描述' }) as never }),
      ],
      [
        { id: 'e1', projectId: 'p1', source: 'ext', target: 'bp' },
        { id: 'e2', projectId: 'p1', source: 'p', target: 'bp' },
      ],
    )
    expect(getSpec('batch')!.collectInputs({ node: batch, graph: withUpstream })).toEqual([
      {
        kind: 'collection',
        nodeId: 'bp',
        items: [
          { kind: 'asset', nodeId: 'img-1', assetHash: 'h:img-1', mime: 'image/png' },
          { kind: 'asset', nodeId: 'img-2', assetHash: 'h:img-2', mime: 'image/png' },
          // 外部素材追加在内部素材之后，共 3 项 ⇒ 3 次调用
          { kind: 'asset', nodeId: 'ext', assetHash: 'h-ext', mime: 'image/png' },
        ],
      },
      // 外部提示词：共同输入，不进集合
      { kind: 'text', nodeId: 'p', text: '共同描述' },
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

/**
 * 用户 2026-09-17 报的两条批量语义。
 *
 * 这两条的共同点：旧实现把「素材从哪儿进来」当成了语义差别
 * （内部 = 逐张展开，外部连线 = 共同输入），于是
 * 「空批量 + 外部 2 张素材」退化成一次调用、两张一起出图。
 * 批量是「素材集合，逐个处理」——**进来的方式不该改变这件事**。
 */
describe('批量：素材来源与提示词拼接（用户 2026-09-17）', () => {
  /** 空批量 + 两张从外面连进来的素材（各带自己的描述与原始比例） */
  function emptyBatchWithExternal() {
    const batch = node({
      id: 'bp',
      type: 'batch',
      // 渠道 / 模型必须配齐，否则 toRunRequest 直接返回 null（这是它自己的早失败规则）
      data: batchData({
        childIds: [],
        hiddenIds: [],
        prompt: '人物单独吃饭',
        channelId: 'ch1',
        model: 'm1',
      }) as never,
    })
    const man = node({
      id: 'man',
      type: 'generation',
      data: genData({ assetHash: 'h-man', prompt: '男人站着', naturalSize: { width: 800, height: 600 } }) as never,
    })
    const woman = node({
      id: 'woman',
      type: 'generation',
      data: genData({ assetHash: 'h-woman', prompt: '女人坐着', naturalSize: { width: 600, height: 900 } }) as never,
    })
    const g = graph([batch, man, woman], [
      { id: 'e1', projectId: 'p1', source: 'man', target: 'bp' },
      { id: 'e2', projectId: 'p1', source: 'woman', target: 'bp' },
    ])
    return { batch, g }
  }

  it('★ 外部连线的素材也算集合成员（不再退化成「一次调用、两张一起」）', () => {
    const { batch, g } = emptyBatchWithExternal()
    const inputs = getSpec('batch')!.collectInputs({ node: batch, graph: g })
    const collection = inputs.find((i) => i.kind === 'collection')
    expect(collection).toBeDefined()
    // 2 张素材各成一项 ⇒ 下游会展开成 2 次调用
    expect(collection!.items.map((i) => i.nodeId)).toEqual(['man', 'woman'])
  })

  it('★ 素材项带上它自带的提示词与原始比例', () => {
    const { batch, g } = emptyBatchWithExternal()
    const inputs = getSpec('batch')!.collectInputs({ node: batch, graph: g })
    const items = inputs.find((i) => i.kind === 'collection')!.items
    expect(items[0]).toMatchObject({ nodeId: 'man', prompt: '男人站着', naturalSize: { width: 800, height: 600 } })
    expect(items[1]).toMatchObject({ nodeId: 'woman', prompt: '女人坐着', naturalSize: { width: 600, height: 900 } })
  })

  it('★ 提示词 = 素材自带 + 外部共同 + 批量自身（自身的在尾部）', () => {
    const { batch, g } = emptyBatchWithExternal()
    const spec = getSpec('batch')!
    // 模拟展开后：第 1 次调用只带「男人站着」这一项（打上 collectionItemId）
    const first = [
      { kind: 'asset' as const, nodeId: 'man', assetHash: 'h-man', mime: 'image/png', prompt: '男人站着', collectionItemId: 'man' },
    ]
    const req1 = spec.toRunRequest!({ node: batch, inputs: first, params: batch.data, graph: g })!
    expect(req1.prompt).toBe('男人站着\n人物单独吃饭')

    // 第 2 次只带「女人坐着」——两张互不污染
    const second = [
      { kind: 'asset' as const, nodeId: 'woman', assetHash: 'h-woman', mime: 'image/png', prompt: '女人坐着', collectionItemId: 'woman' },
    ]
    const req2 = spec.toRunRequest!({ node: batch, inputs: second, params: batch.data, graph: g })!
    expect(req2.prompt).toBe('女人坐着\n人物单独吃饭')
    expect(req1.prompt).not.toContain('女人坐着')
  })

  it('外部提示词节点是共同输入（不是素材，不进集合、不拆开）', () => {
    const { batch, g } = emptyBatchWithExternal()
    const style = node({ id: 'style', type: 'prompt', data: promptData({ text: '水彩风格' }) as never })
    const g2 = graph([...g.nodes, style], [
      ...g.edges,
      { id: 'e3', projectId: 'p1', source: 'style', target: 'bp' },
    ])
    const inputs = getSpec('batch')!.collectInputs({ node: batch, graph: g2 })
    // 素材仍只 2 项（提示词不进集合）
    expect(inputs.find((i) => i.kind === 'collection')!.items).toHaveLength(2)
    // 提示词作为共同输入，拼在素材描述之后、批量自身之前
    const req = getSpec('batch')!.toRunRequest!({
      node: batch,
      inputs: [
        { kind: 'text', nodeId: 'style', text: '水彩风格' },
        { kind: 'asset', nodeId: 'man', assetHash: 'h-man', mime: 'image/png', prompt: '男人站着', collectionItemId: 'man' },
      ],
      params: batch.data,
      graph: g2,
    })!
    expect(req.prompt).toBe('男人站着\n水彩风格\n人物单独吃饭')
  })
})
