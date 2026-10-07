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

/**
 * 分组的范围：x 100..340、y 100..292（240×192）。
 * 「进组 / 出组」的判据是**节点矩形是否完整落在组框里**，与指针落在哪无关
 * （用户 2026-10-06 第 14 批第 1 条）。
 */
describe('拖拽落点归属 · 分组（§6.11 拖入 / 拖出）', () => {
  const group = () =>
    node({ id: 'grp', type: 'group', x: 100, y: 100, w: 240, h: 192, data: { childIds: [] } as never })
  const gen = (over: Partial<NodeSnapshot> = {}) =>
    node({ id: 'gen', type: 'generation', x: 800, y: 100, w: 200, h: 160, ...over })

  it('★ 整个拖进组里（矩形完整落进框内）→ 归属该分组，落在它被拖到的地方', () => {
    const g = graph([group(), gen({ x: 120, y: 130 })])
    const drop = resolveDropReparent('gen', { x: 150, y: 150 }, g)
    expect(drop?.toParent).toBe('grp')
    /** 不再吸附到 3×3 格位：拖进去落在哪就是哪（组是背景板，不排网格） */
    expect(drop?.at).toEqual({ x: 120, y: 130 })
  })

  it('★ 落点在组框外面 → 不进组（根层节点落在空白处，什么也不发生）', () => {
    const g = graph([group(), gen({ x: 300, y: 150 })])
    expect(resolveDropReparent('gen', { x: 900, y: 600 }, g)).toBeNull()
  })

  it('★★ 组内节点的边缘探出组框（有一部分在外面）→ 这就是第 ② 种"移出"', () => {
    /** 局部 (170, 60)：世界右边 = 100 + 170 + 200 = 470 > 组框右边 340 ⇒ 露出去了 */
    const g = graph([group(), gen({ parentId: 'grp', x: 170, y: 60 })])
    const drop = resolveDropReparent('gen', { x: 100 + 170, y: 100 + 60 }, g)
    expect(drop).toEqual({ toParent: null, at: { x: 270, y: 160 } })
  })

  it('★ 组内节点被拖到框外 → 脱离回根层（世界位置原样带出去）', () => {
    const g = graph([group(), gen({ parentId: 'grp', x: -60, y: 20 })])
    const drop = resolveDropReparent('gen', { x: 900, y: 600 }, g)
    expect(drop).toEqual({ toParent: null, at: { x: 40, y: 120 } })
  })

  it('★★ 单击组内节点（矩形一点没动）→ 判定与按下前一致，绝不会被甩出组', () => {
    const g = graph([group(), gen({ parentId: 'grp', x: 20, y: 20 })])
    /** 指针可以落在任何地方（快速甩动 / 点在节点探出组框的那一块上）——都不影响归属 */
    expect(resolveDropReparent('gen', { x: 900, y: 600 }, g)).toBeNull()
    expect(resolveDropReparent('gen', { x: 120, y: 120 }, g)).toBeNull()
  })

  it('已经在组里、松手时也还在框内 → 不重复 reparent', () => {
    const g = graph([group(), gen({ parentId: 'grp', x: 20, y: 20 })])
    expect(resolveDropReparent('gen', { x: 150, y: 150 }, g)).toBeNull()
  })

  it('容器自身拖动不改变归属（只改坐标）', () => {
    const g = graph([group(), gen()])
    expect(resolveDropReparent('grp', { x: 150, y: 150 }, g)).toBeNull()
  })
})

/**
 * 批量**不适用**"完整包含"：它的单元是固定的 200×160 网格位，
 * 指针落进去就吸到空位（素材比容器大也得能进）。
 */
describe('拖拽落点归属 · 批量（网格位吸附）', () => {
  const batch = () =>
    node({ id: 'bat', type: 'batch', x: 100, y: 100, w: 240, h: 192, data: { childIds: [] } as never })
  const gen = (over: Partial<NodeSnapshot> = {}) =>
    node({ id: 'gen', type: 'generation', x: 800, y: 100, w: 200, h: 160, ...over })

  it('落点在批量内 → 归属它，并吸附到第 0 个单元', () => {
    const g = graph([batch(), gen()])
    const drop = resolveDropReparent('gen', { x: 150, y: 150 }, g)
    expect(drop?.toParent).toBe('bat')
    const cell = packedCellAt(0)
    expect(drop?.at).toEqual({ x: 100 + cell.x, y: 100 + cell.y })
  })

  it('批量已有 2 个孩子时吸附到第 2 个单元（3×3 列优先）', () => {
    const kids = [
      node({ id: 'k1', type: 'generation', parentId: 'bat' }),
      node({ id: 'k2', type: 'generation', parentId: 'bat' }),
    ]
    const g = graph([batch(), ...kids, gen({ x: 150, y: 150 })])
    const drop = resolveDropReparent('gen', { x: 250, y: 230 }, g)
    expect(drop?.at).toEqual({ x: 100 + packedCellAt(2).x, y: 100 + packedCellAt(2).y })
  })

  it('落点在空白 → 已在批量内的节点脱离回根层', () => {
    const g = graph([batch(), gen({ parentId: 'bat' })])
    const drop = resolveDropReparent('gen', { x: 900, y: 600 }, g)
    /** 带走的是它的**世界**位置（local 800,100 + 批量原点 100,100），一个像素都不动 */
    expect(drop).toEqual({ toParent: null, at: { x: 900, y: 200 } })
  })

  it('落点在空白且本来就在根层 → 不产生 reparent', () => {
    const g = graph([batch(), gen()])
    expect(resolveDropReparent('gen', { x: 900, y: 600 }, g)).toBeNull()
  })
})

describe('容器动态最小尺寸与打包结果一致', () => {
  it('分组 4 个孩子的最小尺寸 = 内容 + 四边等距（不再归一 5:4）', () => {
    const { containerMin } = packContainerChildren(4)
    expect(containerMin).toEqual({ w: 3 * 200 + 2 * 16 + 40, h: 2 * 160 + 16 + 40 })
  })
})
