import { describe, expect, it, beforeEach } from 'vitest'
import { reduce } from './reducer'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import { containerMinSize } from '../../domain/canvas/layout/packContainer'

/**
 * 容器"贴住内容"（#319 + 第 14 批第 1 / 2 条）——**两套布局，两条口径**：
 *
 * - **批量**：子节点进 3×3 网格（固定 200×160 单元）⇒ 框 = 网格尺寸 + 四边等距，
 *   且**每次都贴**（第 14 批第 2 条：用户实测"两个节点进批量，下方空一大片"——
 *   根因就是旧的"装得下就不动"把打组/收进批量时那个包装框一直留着）。
 * - **分组**：子节点**保持原位原尺寸**（自由布局）⇒ 框 = 孩子们的包围盒 + 四边等距，
 *   原点必要时跟着挪（孩子跑到原点左上时），世界位置一个字都不变（第 14 批第 1 条）。
 */

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

const emptyGraph = (): GraphSnapshot => ({ projectId: 'p1', nodes: [], edges: [] })

function withContainer(kind: 'group' | 'batch', size?: { w: number; h: number }) {
  let g = emptyGraph()
  g = reduce({ kind: 'node.create', projectId: 'p1', type: kind, at: { x: 0, y: 0 }, ...(size ? { size } : {}) }, g).next
  for (let i = 0; i < 3; i += 1) {
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 600 + i * 260, y: 0 } }, g).next
  }
  const containerId = g.nodes.find((n) => n.type === kind)!.id
  const kidIds = g.nodes.filter((n) => n.type === 'prompt').map((n) => n.id)
  return { g, containerId, kidIds }
}
const sizeOf = (g: GraphSnapshot, id: string) => {
  const n = g.nodes.find((x) => x.id === id)!
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

describe('批量：贴住网格内容（#319 / 第 14 批第 2 条）', () => {
  it('第一个子节点进来：高度贴到内容（192 → 200），不是 5:4 的 300', () => {
    const { g, containerId, kidIds } = withContainer('batch')
    expect(sizeOf(g, containerId)).toEqual({ x: 0, y: 0, w: 240, h: 192 })
    const next = reduce({ kind: 'node.reparent', id: kidIds[0]!, toParent: containerId }, g).next
    expect(sizeOf(next, containerId)).toMatchObject(containerMinSize('batch', 1))
    expect(sizeOf(next, containerId)).toEqual({ x: 0, y: 0, w: 240, h: 200 })
  })

  it('★★ 两个子节点：456×200（不是旧口径的 456×365，下方空 183px）', () => {
    let g = withContainer('batch').g
    const containerId = g.nodes.find((n) => n.type === 'batch')!.id
    const kidIds = g.nodes.filter((n) => n.type === 'prompt').map((n) => n.id)
    for (const id of kidIds.slice(0, 2)) g = reduce({ kind: 'node.reparent', id, toParent: containerId }, g).next
    expect(sizeOf(g, containerId).w).toBe(456)
    expect(sizeOf(g, containerId).h).toBe(200)
  })

  it('★★ 手工拖大的框，下次子节点增删时收回（第 14 批第 2 条）', () => {
    const { g, containerId, kidIds } = withContainer('batch', { w: 800, h: 600 })
    const next = reduce({ kind: 'node.reparent', id: kidIds[0]!, toParent: containerId }, g).next
    expect(sizeOf(next, containerId)).toEqual({ x: 0, y: 0, w: 240, h: 200 })
  })

  it('子节点拖出后框收回；删掉子节点也一样（并清掉 childIds 死引用）', () => {
    let g = withContainer('batch').g
    const containerId = g.nodes.find((n) => n.type === 'batch')!.id
    const kidIds = g.nodes.filter((n) => n.type === 'prompt').map((n) => n.id)
    for (const id of kidIds.slice(0, 2)) g = reduce({ kind: 'node.reparent', id, toParent: containerId }, g).next
    const out = reduce({ kind: 'node.reparent', id: kidIds[0]!, toParent: null }, g).next
    expect(sizeOf(out, containerId)).toMatchObject(containerMinSize('batch', 1))

    const del = reduce({ kind: 'node.delete', ids: [kidIds[1]!] }, g).next
    expect((del.nodes.find((n) => n.id === containerId)!.data as { childIds: string[] }).childIds).toEqual([kidIds[0]!])
  })
})

describe('分组：自由布局的贴合（第 14 批第 1 条）', () => {
  it('★★ 拖进组的节点：世界位置与尺寸一个字不变；框 = 包围盒 + 四边等距', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 500, y: 400 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 }, size: { w: 300, h: 200 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const kid = g.nodes.find((n) => n.type === 'generation')!.id

    const next = reduce({ kind: 'node.reparent', id: kid, toParent: gid }, g).next
    const grp = next.nodes.find((n) => n.id === gid)!
    const moved = next.nodes.find((n) => n.id === kid)!
    /** 世界位置不变（组原点为了贴合孩子挪到了 (80,80)） */
    expect({ x: grp.x, y: grp.y }).toEqual({ x: 80, y: 80 })
    expect({ x: grp.x + moved.x, y: grp.y + moved.y }).toEqual({ x: 100, y: 100 })
    expect({ w: moved.w, h: moved.h }).toEqual({ w: 300, h: 200 })
    /** 框 = 孩子 + 四边等距 20 */
    expect({ w: grp.w, h: grp.h }).toEqual({ w: 340, h: 240 })
  })

  it('★★ 两个子节点：框=包围盒+40，各自的位置与尺寸都不动', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 200, y: 120 }, size: { w: 400, h: 500 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 700, y: 200 }, size: { w: 300, h: 200 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const [a, b] = g.nodes.filter((n) => n.type === 'generation').map((n) => n.id)

    g = reduce({ kind: 'node.reparent', id: a!, toParent: gid }, g).next
    g = reduce({ kind: 'node.reparent', id: b!, toParent: gid }, g).next
    const grp = g.nodes.find((n) => n.id === gid)!
    const na = g.nodes.find((n) => n.id === a!)!
    const nb = g.nodes.find((n) => n.id === b!)!
    expect({ x: grp.x + na.x, y: grp.y + na.y }).toEqual({ x: 200, y: 120 })
    expect({ x: grp.x + nb.x, y: grp.y + nb.y }).toEqual({ x: 700, y: 200 })
    /** 宽 = (700+300) - 200 + 40 = 840；高 = (120+500) - 120 + 40 = 540 */
    expect({ w: grp.w, h: grp.h }).toEqual({ w: 840, h: 540 })
  })

  it('★ 空组：回落到类型最小尺寸（一块空背景板也得有地方站）', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    expect(sizeOf(g, gid)).toEqual({ x: 0, y: 0, w: 240, h: 192 })
  })

  /**
   * ★★ 「拖出」这条链路（第 14 批第 1 条现场报的：把一个孩子拖出去之后，**组框跑掉了**）。
   *
   * 真实顺序和拖拽一致：孩子先在**组内**被拖（`node.move` 改的是它的 local 坐标，
   * 组框**不动**）→ 松手时脱离（`node.reparent → null`）。脱离那一步要用**剩下的孩子**
   * 重算框 —— 若谁拿被拖走的那个也算一遍（或者拿它的新坐标当包围盒），
   * 整块背景板就会跟着那个节点飞出去。
   */
  it('★★ 组内孩子被拖出去：组框回到"剩下孩子的包围盒 + 四边 20"，原点不许跟着飞', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 500, y: 100 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const [a, b] = g.nodes.filter((n) => n.type === 'generation').map((n) => n.id)
    g = reduce({ kind: 'node.reparent', id: a!, toParent: gid }, g).next
    g = reduce({ kind: 'node.reparent', id: b!, toParent: gid }, g).next
    const before = sizeOf(g, gid)

    /** 第三个孩子拖进来（在组的下方 ⇒ 框变高） */
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 300, y: 400 } }, g).next
    const c = g.nodes.filter((n) => n.type === 'generation')[2]!.id
    g = reduce({ kind: 'node.reparent', id: c, toParent: gid }, g).next
    expect(sizeOf(g, gid).h).toBeGreaterThan(before.h)

    /** 拖出去：先在组内拖（只动它自己的 local 坐标），再脱离 */
    g = reduce({ kind: 'node.move', ids: [c], dx: 600, dy: 500, phase: 'end' }, g).next
    const out = reduce({ kind: 'node.reparent', id: c, toParent: null }, g).next

    expect(sizeOf(out, gid)).toEqual(before)
    expect(out.nodes.find((n) => n.id === c)!.parentId).toBeNull()
  })
})
