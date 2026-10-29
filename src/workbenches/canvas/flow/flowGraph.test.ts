import { describe, expect, it } from 'vitest'
import {
  childrenByParent,
  isContainerType,
  nodeMeasurementKey,
  nodesIntersectingMarquee,
  topLevelNodes,
} from './flowGraph'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'

const node = (id: string, parentId: string | null = null, type = 'generation') =>
  ({ id, type, parentId, x: 0, y: 0, w: 100, h: 100, title: id, data: {} }) as unknown as NodeSnapshot

const graphOf = (nodes: NodeSnapshot[]) => ({ nodes, edges: [], resultGroups: [] }) as unknown as GraphSnapshot

describe('画布图层面的图索引', () => {
  it('分组 / 批量是容器类型；其它不是', () => {
    expect(isContainerType('group')).toBe(true)
    expect(isContainerType('batch')).toBe(true)
    expect(isContainerType('generation')).toBe(false)
    expect(isContainerType('loop')).toBe(false)
  })

  it('子节点只按 parentId 归拢；顶层节点没有 parentId', () => {
    const graph = graphOf([node('a'), node('b', 'a'), node('c', 'a'), node('d')])
    const index = childrenByParent(graph)
    expect(index.get('a')?.map((n) => n.id)).toEqual(['b', 'c'])
    expect(index.has('d')).toBe(false)
    expect(topLevelNodes(graph).map((n) => n.id)).toEqual(['a', 'd'])
  })

  it('结果组的子节点（父不在 nodes 表）同样被索引出来 —— 渲染与否由调用方判断', () => {
    const graph = graphOf([node('a'), node('orphan', 'rg-1')])
    expect(childrenByParent(graph).get('rg-1')?.map((n) => n.id)).toEqual(['orphan'])
    // 它不会出现在顶层（画布不给它摆位）
    expect(topLevelNodes(graph).map((n) => n.id)).toEqual(['a'])
  })

  it('框选只收真实矩形与选框相交的顶层节点', () => {
    const graph = graphOf([
      { ...node('in'), x: 20, y: 20 },
      { ...node('touch'), x: 95, y: 20 },
      { ...node('outside'), x: 300, y: 300 },
      { ...node('child', 'in'), x: 200, y: 200 },
    ])
    expect(
      nodesIntersectingMarquee(graph, { x: 0, y: 0, w: 100, h: 100 }),
    ).toEqual(['in', 'touch'])
    expect(
      nodesIntersectingMarquee(graph, { x: 0, y: 0, w: 100, h: 100 }, ['outside']),
    ).toEqual(['outside', 'in', 'touch'])
  })

  it('节点尺寸或父级变化会触发 React Flow 重新测量', () => {
    const before = graphOf([node('a'), node('b')])
    const resized = graphOf([{ ...node('a'), w: 240, h: 180 }, node('b')])
    const reparented = graphOf([{ ...node('b'), parentId: 'a' }, node('a')])
    expect(nodeMeasurementKey(before)).not.toBe(nodeMeasurementKey(resized))
    expect(nodeMeasurementKey(before)).not.toBe(nodeMeasurementKey(reparented))
  })
})
