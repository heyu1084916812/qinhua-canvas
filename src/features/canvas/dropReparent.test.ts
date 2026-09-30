import { describe, it, expect, beforeEach } from 'vitest'
import { resolveDropReparent } from './dropReparent'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import { packContainerChildren, packedCellAt } from '../../domain/canvas/layout/packContainer'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../domain/canvas/model/node'

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

function graph(nodes: NodeSnapshot[]): GraphSnapshot {
  return { projectId: 'p1', nodes, edges: [] }
}

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

describe('拖拽落点归属（§6.11 拖入 / 拖出）', () => {
  const group = () =>
    node({ id: 'grp', type: 'group', x: 100, y: 100, w: 240, h: 192, data: { childIds: [] } as never })
  const gen = (over: Partial<NodeSnapshot> = {}) =>
    node({ id: 'gen', type: 'generation', x: 800, y: 100, w: 200, h: 160, ...over })

  it('落点在分组内 → 归属该分组，并吸附到第 0 个单元', () => {
    const g = graph([group(), gen()])
    const drop = resolveDropReparent('gen', { x: 150, y: 150 }, g)
    expect(drop?.toParent).toBe('grp')
    const cell = packedCellAt(0)
    expect(drop?.at).toEqual({ x: 100 + cell.x, y: 100 + cell.y })
  })

  it('分组已有 2 个孩子时吸附到第 2 个单元（3×3 列优先）', () => {
    const kids = [
      node({ id: 'k1', type: 'generation', parentId: 'grp' }),
      node({ id: 'k2', type: 'generation', parentId: 'grp' }),
    ]
    const g = graph([group(), ...kids, gen({ x: 150, y: 150 })])
    const drop = resolveDropReparent('gen', { x: 250, y: 230 }, g)
    expect(drop?.at).toEqual({ x: 100 + packedCellAt(2).x, y: 100 + packedCellAt(2).y })
  })

  it('落点在空白 → 已在容器内的节点脱离回根层', () => {
    const g = graph([group(), gen({ parentId: 'grp' })])
    const drop = resolveDropReparent('gen', { x: 900, y: 600 }, g)
    expect(drop).toEqual({ toParent: null, at: { x: 800, y: 520 } })
  })

  it('落点在空白且本来就在根层 → 不产生 reparent', () => {
    const g = graph([group(), gen()])
    expect(resolveDropReparent('gen', { x: 900, y: 600 }, g)).toBeNull()
  })

  it('落在自己所在的同一容器内 → 不重复 reparent', () => {
    const g = graph([group(), gen({ parentId: 'grp' })])
    expect(resolveDropReparent('gen', { x: 150, y: 150 }, g)).toBeNull()
  })

  it('容器自身拖动不改变归属（只改坐标）', () => {
    const g = graph([group(), gen()])
    expect(resolveDropReparent('grp', { x: 150, y: 150 }, g)).toBeNull()
  })
})

describe('容器动态最小尺寸与打包结果一致', () => {
  it('分组 4 个孩子的最小尺寸与 packContainerChildren(4) 一致', () => {
    const { containerMin } = packContainerChildren(4)
    expect(containerMin.w / containerMin.h).toBeCloseTo(5 / 4, 2)
  })
})
