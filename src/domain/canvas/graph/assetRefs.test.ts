import { describe, it, expect } from 'vitest'
import { assetHashesOf, assetHashesOfNode } from './assetRefs'
import type { NodeSnapshot, NodeType } from '../model/node'

function node(id: string, type: NodeType, data: Record<string, unknown>): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type,
    title: id,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    disabled: false,
    parentId: null,
    data: data as NodeSnapshot['data'],
  }
}

const HASH = 'a'.repeat(64)

describe('assetHashesOfNode', () => {
  it('生成节点：产物图就是 data.assetHash', () => {
    expect(assetHashesOfNode(node('g', 'generation', { mode: 'image', assetHash: HASH }))).toEqual([HASH])
  })

  it('没跑过 / 无图 → 空（不猜、不占位）', () => {
    expect(assetHashesOfNode(node('g', 'generation', { mode: 'image' }))).toEqual([])
    expect(assetHashesOfNode(node('p', 'prompt', { text: 'x' }))).toEqual([])
  })

  it('对比节点：左 / 右兜底图都算引用了素材', () => {
    const n = node('c', 'compare', { leftAssetHash: 'L', rightAssetHash: 'R', splitRatio: 0.5 })
    expect(assetHashesOfNode(n)).toEqual(['L', 'R'])
  })

  it('融合产物：compareWith 指的原图也要一起带走', () => {
    const n = node('f', 'generation', { mode: 'image', assetHash: 'OUT', compareWith: 'SRC' })
    expect(assetHashesOfNode(n)).toEqual(['OUT', 'SRC'])
  })

  it('局部选区：cropContext.source 的原图要带走；{ full: true } 不带', () => {
    const local = node('g', 'generation', {
      mode: 'image',
      assetHash: 'OUT',
      cropContext: { source: { assetHash: 'SRC', width: 10, height: 10 }, rect: { x: 0, y: 0, w: 1, h: 1 }, paddedRect: { x: 0, y: 0, w: 1, h: 1 }, paddingRatio: 0.08 },
    })
    expect(assetHashesOfNode(local)).toEqual(['OUT', 'SRC'])

    const full = node('g2', 'generation', { mode: 'image', assetHash: 'OUT', cropContext: { full: true } })
    expect(assetHashesOfNode(full)).toEqual(['OUT'])
  })

  it('同一张图被两处引用 → 只算一次', () => {
    const n = node('f', 'generation', { mode: 'image', assetHash: HASH, compareWith: HASH })
    expect(assetHashesOfNode(n)).toEqual([HASH])
  })

  it('thumbOrder 不收：那是上次跑出来的顺序，画面已经不显示它了', () => {
    const n = node('g', 'generation', { mode: 'image', assetHash: 'OUT', thumbOrder: ['OLD1', 'OLD2'] })
    expect(assetHashesOfNode(n)).toEqual(['OUT'])
  })
})

describe('assetHashesOf', () => {
  it('★ 复制项目的场景：图归谁的项目不重要，节点引用了就带走', () => {
    const nodes = [
      node('src', 'generation', { mode: 'image', assetHash: HASH }),
      node('out', 'generation', { mode: 'image', assetHash: 'OUT', compareWith: HASH }),
      node('p', 'prompt', { text: 'x' }),
    ]
    expect(assetHashesOf(nodes)).toEqual([HASH, 'OUT'])
  })

  it('一个节点都没引用 → 空（导出不会把整个素材库打进去）', () => {
    expect(assetHashesOf([node('p', 'prompt', { text: 'x' })])).toEqual([])
    expect(assetHashesOf([])).toEqual([])
  })
})
