import { describe, it, expect } from 'vitest'
import { resultImagesOf, latestResultGroupOf, upstreamImagesOf } from './resultImages'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot, GenerationData } from '../model/node'
import type { ResultGroup } from '../model/resultGroup'

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

function rg(id: string, sourceNodeId: string, childIds: string[], createdAt: number): ResultGroup {
  return {
    id,
    projectId: 'p1',
    sourceNodeId,
    taskId: 't',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    childIds,
    collapsed: false,
    createdAt,
    summary: { success: childIds.length, failed: 0 },
  }
}

function graphOf(nodes: NodeSnapshot[], resultGroups: ResultGroup[] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges: [], resultGroups }
}

describe('resultImagesOf', () => {
  it('无结果组时退化为节点自身 assetHash', () => {
    const g = graphOf([gen('a', 'h1')])
    expect(resultImagesOf(g.nodes[0]!, g)).toEqual(['h1'])
  })

  it('没跑过、也没有自身图 → 空', () => {
    const g = graphOf([gen('a')])
    expect(resultImagesOf(g.nodes[0]!, g)).toEqual([])
  })

  it('有结果组时以组内顺序为准，且不再重复拼自身 hash（第 1 张同图）', () => {
    const g = graphOf(
      [gen('a', 'r1'), gen('c1', 'r1', 'rg1'), gen('c2', 'r2', 'rg1'), gen('c3', 'r3', 'rg1')],
      [rg('rg1', 'a', ['c1', 'c2', 'c3'], 1)],
    )
    expect(resultImagesOf(g.nodes[0]!, g)).toEqual(['r1', 'r2', 'r3'])
  })

  it('childIds 里的缺失 / 无图子节点被跳过', () => {
    const g = graphOf(
      [gen('a', 'r1'), gen('c1', 'r1', 'rg1'), gen('c2', undefined, 'rg1')],
      [rg('rg1', 'a', ['c1', 'c2', 'ghost'], 1)],
    )
    expect(resultImagesOf(g.nodes[0]!, g)).toEqual(['r1'])
  })

  it('同一来源多批结果取最新一组（createdAt 最大）', () => {
    const g = graphOf(
      [gen('a', 'old'), gen('n1', 'new1', 'rg2'), gen('n2', 'new2', 'rg2')],
      [rg('rg1', 'a', [], 10), rg('rg2', 'a', ['n1', 'n2'], 20)],
    )
    expect(latestResultGroupOf('a', g)?.id).toBe('rg2')
    expect(resultImagesOf(g.nodes[0]!, g)).toEqual(['new1', 'new2', 'old'])
  })

  it('节点不存在 → 空', () => {
    expect(resultImagesOf(undefined, graphOf([]))).toEqual([])
  })
})

describe('upstreamImagesOf', () => {
  const g = graphOf(
    [gen('a', 'r1'), gen('c1', 'r1', 'rg1'), gen('c2', 'r2', 'rg1'), gen('b', 'h9')],
    [rg('rg1', 'a', ['c1', 'c2'], 1)],
  )

  it('不展开时仍是「每个上游 1 张」（生成节点口径不变）', () => {
    expect(upstreamImagesOf(['a', 'b'], g, false)).toEqual([
      { nodeId: 'a', assetHash: 'r1' },
      { nodeId: 'b', assetHash: 'h9' },
    ])
  })

  it('展开时把上游的整批结果铺开，且来源 nodeId 仍是上游节点（对比节点口径）', () => {
    expect(upstreamImagesOf(['a', 'b'], g, true)).toEqual([
      { nodeId: 'a', assetHash: 'r1' },
      { nodeId: 'a', assetHash: 'r2' },
      { nodeId: 'b', assetHash: 'h9' },
    ])
  })

  it('跨上游去重，且不丢顺序', () => {
    expect(upstreamImagesOf(['a', 'a', 'b'], g, true)).toEqual([
      { nodeId: 'a', assetHash: 'r1' },
      { nodeId: 'a', assetHash: 'r2' },
      { nodeId: 'b', assetHash: 'h9' },
    ])
  })

  it('上游不存在 → 跳过', () => {
    expect(upstreamImagesOf(['ghost', 'b'], g, true)).toEqual([{ nodeId: 'b', assetHash: 'h9' }])
  })
})
