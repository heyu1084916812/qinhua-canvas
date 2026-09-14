import { describe, it, expect } from 'vitest'
import { expandInputs, expansionCount, hasCollection } from './collectionExpand'
import type { NodeInput } from '../model/runRecord'

const asset = (id: string): NodeInput => ({ kind: 'asset', nodeId: id, assetHash: `h:${id}`, mime: 'image/png' })
const text = (id: string, t: string): NodeInput => ({ kind: 'text', nodeId: id, text: t })
const collection = (id: string, items: NodeInput[]): NodeInput => ({ kind: 'collection', nodeId: id, items })

/**
 * 集合展开（产品文档 §6.12）：批量节点作为上游时，下游生成节点逐个素材各生成一次。
 * 这里是「批量套图 / 批量文生图」能出 N 份结果的核心规则，必须在 node 环境锁死。
 */
describe('collectionExpand（§6.12 集合卡展开）', () => {
  it('无集合时原样返回一个变体', () => {
    const inputs = [asset('a'), text('t', '一只猫')]
    expect(expansionCount(inputs)).toBe(1)
    expect(hasCollection(inputs)).toBe(false)
    const out = expandInputs(inputs)
    expect(out).toHaveLength(1)
    expect(out[0]!.inputs).toEqual(inputs)
    expect(out[0]!.itemNodeId).toBeNull()
  })

  it('单个集合按元素个数展开，每次取对应项', () => {
    const inputs = [collection('bp', [asset('a'), asset('b'), asset('c')])]
    expect(expansionCount(inputs)).toBe(3)
    expect(hasCollection(inputs)).toBe(true)
    const out = expandInputs(inputs)
    expect(out.map((e) => e.itemNodeId)).toEqual(['a', 'b', 'c'])
    // 展开出的元素带 collectionItemId，执行期据此区分「第几次调用」
    expect(out[0]!.inputs).toEqual([{ ...asset('a'), collectionItemId: 'a' }])
    expect(out[2]!.inputs).toEqual([{ ...asset('c'), collectionItemId: 'c' }])
  })

  it('「批量 2 张 + 外部 1 张」：外部输入原样复制到每一次调用（§6.12 场景 2 / 4）', () => {
    const inputs = [collection('bp', [asset('a'), asset('b')]), asset('ext')]
    const out = expandInputs(inputs)
    expect(out).toHaveLength(2)
    // 外部上游不带 collectionItemId：它不是集合项，语义上每次都相同
    expect(out[0]!.inputs).toEqual([{ ...asset('a'), collectionItemId: 'a' }, asset('ext')])
    expect(out[1]!.inputs).toEqual([{ ...asset('b'), collectionItemId: 'b' }, asset('ext')])
  })

  it('提示词集合展开成多条文本（批量文生图）', () => {
    const inputs = [collection('bp', [text('p1', '清晨'), text('p2', '雨夜')])]
    const out = expandInputs(inputs)
    expect(out).toHaveLength(2)
    expect(out[0]!.inputs).toEqual([{ ...text('p1', '清晨'), collectionItemId: 'p1' }])
    expect(out[1]!.inputs).toEqual([{ ...text('p2', '雨夜'), collectionItemId: 'p2' }])
  })

  it('多个集合取最大长度，短的按最后一项补齐（不制造空洞调用）', () => {
    const inputs = [
      collection('bp1', [asset('a1'), asset('a2'), asset('a3')]),
      collection('bp2', [text('b1', 'x'), text('b2', 'y')]),
    ]
    expect(expansionCount(inputs)).toBe(3)
    const out = expandInputs(inputs)
    expect(out).toHaveLength(3)
    expect(out[2]!.inputs).toEqual([
      { ...asset('a3'), collectionItemId: 'a3' },
      { ...text('b2', 'y'), collectionItemId: 'b2' },
    ])
  })

  it('空集合不参与展开，也不产生空洞', () => {
    const inputs = [collection('bp', []), asset('ext')]
    // expansionCount 只看 items.length，空集合不抬高次数
    expect(expansionCount(inputs)).toBe(1)
    const out = expandInputs(inputs)
    expect(out).toHaveLength(1)
    expect(out[0]!.inputs).toEqual([asset('ext')])
    expect(out[0]!.itemNodeId).toBeNull()
  })

  it('嵌套集合递归摊平（批量接批量）', () => {
    const inputs = [collection('outer', [collection('inner', [asset('a'), asset('b')])])]
    const out = expandInputs(inputs, 2)
    expect(out[0]!.inputs).toEqual([
      { ...asset('a'), collectionItemId: 'inner' },
      { ...asset('b'), collectionItemId: 'inner' },
    ])
  })

  it('显式 count 可覆盖自动推导（用于计划层统一槽位数）', () => {
    const inputs = [collection('bp', [asset('a')])]
    const out = expandInputs(inputs, 3)
    expect(out).toHaveLength(3)
    // 越界取最后一个，不产生 undefined
    expect(out[1]!.inputs).toEqual([{ ...asset('a'), collectionItemId: 'a' }])
    expect(out[2]!.inputs).toEqual([{ ...asset('a'), collectionItemId: 'a' }])
  })

  it('同一素材被放进集合两次：两次调用仍可区分（§6.12 同素材重复）', () => {
    const inputs = [collection('bp', [asset('a'), asset('a')])]
    const out = expandInputs(inputs)
    expect(out).toHaveLength(2)
    // nodeId / assetHash 完全相同，靠 collectionItemId 与序号区分
    expect(out[0]!.itemNodeId).toBe('a')
    expect(out[1]!.itemNodeId).toBe('a')
  })
})
