import { describe, it, expect } from 'vitest'
import { resultImagesOf, upstreamImagesOf } from './resultImages'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot, GenerationData } from '../model/node'

function gen(id: string, assetHash?: string, parentId?: string): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type: 'generation',
    title: id,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    disabled: false,
    parentId: parentId ?? null,
    data: { mode: 'image', assetHash: assetHash ?? null } as unknown as GenerationData,
  }
}

function graphOf(nodes: NodeSnapshot[]): GraphSnapshot {
  return { projectId: 'p1', nodes, edges: [] }
}

/**
 * 结果组下线后，产物一定落在节点自己身上（每次调用一个承载节点），
 * 于是 `resultImagesOf` 退化成「读自身 assetHash」。这几条锁住的是**退化后的口径**：
 * 有图就出这一张、没图就空、不编造也不去重出一个假的长度。
 */
describe('resultImagesOf', () => {
  it('有产物 → 就是自身 assetHash', () => {
    const g = graphOf([gen('a', 'h1')])
    expect(resultImagesOf(g.nodes[0]!)).toEqual(['h1'])
  })

  it('没跑过 / 无图 → 空（不猜、不占位）', () => {
    const g = graphOf([gen('a')])
    expect(resultImagesOf(g.nodes[0]!)).toEqual([])
  })

  it('节点不存在 → 空', () => {
    expect(resultImagesOf(undefined)).toEqual([])
  })
})

describe('upstreamImagesOf', () => {
  const g = graphOf([gen('a', 'r1'), gen('b', 'h9')])

  it('每个上游出 1 张（生成节点口径）', () => {
    expect(upstreamImagesOf(['a', 'b'], g, false)).toEqual([
      { nodeId: 'a', assetHash: 'r1' },
      { nodeId: 'b', assetHash: 'h9' },
    ])
  })

  /**
   * `expandResults` 曾是「要不要把一组 N 张摊开」的开关（对比节点要全部）。
   * 组没了，两个取值必须**同结果**——否则说明还有一处按旧语义分支，
   * 那会让「对比节点拿到几张」取决于一个已经没有意义的参数。
   */
  it('expandResults 两种取值同结果（组已下线，无从展开）', () => {
    expect(upstreamImagesOf(['a', 'b'], g, true)).toEqual(upstreamImagesOf(['a', 'b'], g, false))
  })

  it('重复上游去重，且不丢顺序', () => {
    expect(upstreamImagesOf(['a', 'a', 'b'], g, true)).toEqual([
      { nodeId: 'a', assetHash: 'r1' },
      { nodeId: 'b', assetHash: 'h9' },
    ])
  })

  it('来源 nodeId 记的是上游节点，不是下游自己（溯源不能失效）', () => {
    expect(upstreamImagesOf(['a'], g, true)).toEqual([{ nodeId: 'a', assetHash: 'r1' }])
  })

  it('上游不存在 → 跳过', () => {
    expect(upstreamImagesOf(['ghost', 'b'], g, true)).toEqual([{ nodeId: 'b', assetHash: 'h9' }])
  })
})
