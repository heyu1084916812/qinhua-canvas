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

  /**
   * ★★ 口径在用户第 15 批 #335-① 改过：
   * 「放大批量节点的话，里面的子节点和素材**同步放大**，这样才能保持留白规则」
   * ⇒ 手工拖大的框是**缩放倍率**的表达，自动路径**不许**把它按回网格
   *（批 14 那条"下次增删就收回"的断言因此反过来了）。缩回去只有手动 `refitContainer(tight)`。
   */
  it('★★ 手工拖大的框（= 放大倍率）在下次子节点增删时**保持不动**', () => {
    const { g, containerId, kidIds } = withContainer('batch', { w: 800, h: 600 })
    const next = reduce({ kind: 'node.reparent', id: kidIds[0]!, toParent: containerId }, g).next
    expect(sizeOf(next, containerId)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    /** 手动「整理节点」才回到网格尺寸 */
    const tight = reduce({ kind: 'node.refitContainer', id: containerId, mode: 'tight' }, next).next
    expect(sizeOf(tight, containerId)).toEqual({ x: 0, y: 0, w: 240, h: 200 })
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
  /**
   * ★★ 拖进组的节点：世界位置与尺寸一个字不变；框**长到包住它 + 四边 20**。
   *
   * ⚠️ 判据是**规则**（框包含全部孩子、四边都 ≥ 20），不是"框 = 精确贴合"：
   * 第 15 批 #334-④ 之后自动路径**只长不缩**（用户：「拖出去…分组面板也不需要去自适应
   * 剩下的节点的大小」）⇒ 框本来就有余量时不会被收紧，缩框只有手动「整理节点」那一条路。
   */
  it('★★ 拖进组的节点：世界位置与尺寸一个字不变；框长到包住它 + 四边 20', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 500, y: 400 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 }, size: { w: 300, h: 200 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const kid = g.nodes.find((n) => n.type === 'generation')!.id

    const next = reduce({ kind: 'node.reparent', id: kid, toParent: gid }, g).next
    const grp = next.nodes.find((n) => n.id === gid)!
    const moved = next.nodes.find((n) => n.id === kid)!
    /** 世界位置与尺寸一个字不变 */
    expect({ x: grp.x + moved.x, y: grp.y + moved.y }).toEqual({ x: 100, y: 100 })
    expect({ w: moved.w, h: moved.h }).toEqual({ w: 300, h: 200 })
    /** 框包住孩子、四边都 ≥ 20 */
    expect(grp.x).toBeLessThanOrEqual(100 - 20)
    expect(grp.y).toBeLessThanOrEqual(100 - 20)
    expect(grp.x + grp.w).toBeGreaterThanOrEqual(400 + 20)
    expect(grp.y + grp.h).toBeGreaterThanOrEqual(300 + 20)
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
    /** 框包住两个孩子、四边都 ≥ 20（宽 ≥ (700+300)-200+40 = 840；高 ≥ 620-120+40 = 540） */
    expect(grp.x).toBeLessThanOrEqual(200 - 20)
    expect(grp.y).toBeLessThanOrEqual(120 - 20)
    expect(grp.x + grp.w).toBeGreaterThanOrEqual(1000 + 20)
    expect(grp.y + grp.h).toBeGreaterThanOrEqual(620 + 20)
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
  it('★★ 组内孩子被拖出去：框**保持不动**（不自适应剩下的节点），原点也不许跟着飞', () => {
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
    const grown = sizeOf(g, gid)
    const out = reduce({ kind: 'node.reparent', id: c, toParent: null }, g).next

    /** 不缩：还是长大之后的那个框（用户：「分组面板也不需要去自适应剩下的节点的大小」） */
    expect(sizeOf(out, gid)).toEqual(grown)
    expect(out.nodes.find((n) => n.id === c)!.parentId).toBeNull()
  })

  /**
   * ★★ 复制容器要**连成员一起复制**（用户第 15 批 #336：Alt+拖动复制分组面板 / 批量节点时，
   * 里面的节点素材没跟过来，复制出来是一个**空壳**）。
   *
   * 三条都要成立：① 成员有副本、父级指向新的容器；② 成员的 local 坐标照抄
   * （它们本来就是相对容器原点的）；③ 容器副本的 `childIds` 顺序表**改写成新 id**，
   * 否则副本"有子节点、但排序表指向原节点"。
   */
  it('★★ 复制分组：里面的节点一起复制，childIds 改写成新 id', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 500, y: 300 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const kids = g.nodes.filter((n) => n.type === 'generation').map((n) => n.id)
    for (const id of kids) g = reduce({ kind: 'node.reparent', id, toParent: gid }, g).next
    const before = g.nodes.filter((n) => n.parentId === gid)
    expect(before).toHaveLength(2)

    const next = reduce({ kind: 'node.duplicate', ids: [gid], newIds: ['g2'], dx: 40, dy: 30 }, g).next
    const copy = next.nodes.find((n) => n.id === 'g2')!
    const copyKids = next.nodes.filter((n) => n.parentId === 'g2')
    expect(copyKids).toHaveLength(2)
    /** ② local 坐标照抄 */
    expect(copyKids.map((k) => ({ x: k.x, y: k.y }))).toEqual(before.map((k) => ({ x: k.x, y: k.y })))
    /** ① 成员是**新**节点（不是复用原 id） */
    for (const k of copyKids) expect(kids).not.toContain(k.id)
    /** ③ 顺序表改写成新 id，且与原表**同序** */
    expect((copy.data as { childIds?: string[] }).childIds).toEqual(copyKids.map((k) => k.id))
    const originalOrder = (g.nodes.find((n) => n.id === gid)!.data as { childIds?: string[] }).childIds ?? []
    expect((copy.data as { childIds?: string[] }).childIds).toHaveLength(originalOrder.length)
  })

  /**
   * ★★ 组框「只长不缩」+「完整拖出去才离开」（用户第 15 批 #334-④）。
   *
   * 三条口径都是原话：
   * ① 「把其中一个节点拖出去，分组面板也**不需要**去自适应剩下的节点的大小」⇒ 自动路径不缩框；
   * ② 「如果只拖了一半的话要**适应分组边缘与节点的留白规则**」+「分组背景适应节点」⇒ 半拖出要把框长上去；
   * ③ 「节点拖出去要**完整的**拖出去才会是真正的离开了分组」⇒ 完整不重叠才离开（判据在 `dropReparent`）。
   * 唯一的"缩框"路径是手动「整理节点」（`mode: 'tight'`）。
   */
  it('★★ 孩子拖出去之后框**不缩**（剩下的节点少了一个，板保持原尺寸）', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 500, y: 100 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const [a, b] = g.nodes.filter((n) => n.type === 'generation').map((n) => n.id)
    g = reduce({ kind: 'node.reparent', id: a!, toParent: gid }, g).next
    g = reduce({ kind: 'node.reparent', id: b!, toParent: gid }, g).next
    const before = sizeOf(g, gid)

    const out = reduce({ kind: 'node.reparent', id: b!, toParent: null }, g).next
    expect(sizeOf(out, gid)).toEqual(before)
  })

  it('★★ 孩子只拖出一半：`hug` 把框长到包住它（世界位置不动，原点一起挪）', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 500, y: 100 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const [a, b] = g.nodes.filter((n) => n.type === 'generation').map((n) => n.id)
    g = reduce({ kind: 'node.reparent', id: a!, toParent: gid }, g).next
    g = reduce({ kind: 'node.reparent', id: b!, toParent: gid }, g).next
    const before = sizeOf(g, gid)

    /** 把 a 往左上拖出框（只出去一半）⇒ 框要往左上长 */
    g = reduce({ kind: 'node.move', ids: [a!], dx: -120, dy: -90, phase: 'end' }, g).next
    /** 拖动之后、贴框之前的世界位置：贴框**不许**动它 */
    const movedBox = sizeOf(g, gid)
    const aWorld = { x: movedBox.x + g.nodes.find((n) => n.id === a!)!.x, y: movedBox.y + g.nodes.find((n) => n.id === a!)!.y }
    const next = reduce({ kind: 'node.refitContainer', id: gid, mode: 'hug' }, g).next
    const grp = next.nodes.find((n) => n.id === gid)!
    const na = next.nodes.find((n) => n.id === a!)!
    expect(grp.x).toBeLessThan(before.x)
    expect(grp.y).toBeLessThan(before.y)
    expect(grp.w).toBeGreaterThanOrEqual(before.w)
    /** 世界位置一个字都不动 */
    expect({ x: grp.x + na.x, y: grp.y + na.y }).toEqual(aWorld)
  })

  it('★ `tight`（整理节点）是唯一会缩框的路径：框回到"内容 + 四边 20"', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 500, y: 100 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const [a, b] = g.nodes.filter((n) => n.type === 'generation').map((n) => n.id)
    g = reduce({ kind: 'node.reparent', id: a!, toParent: gid }, g).next
    g = reduce({ kind: 'node.reparent', id: b!, toParent: gid }, g).next
    /**
     * 贴合框 = 孩子们的世界包围盒 + 四边 20（这里自己算，别拿"进组之后的框"当期望值 ——
     * 自动路径只长不缩，那个框可能本来就带余量）。
     */
    const kids = g.nodes.filter((n) => n.parentId === gid)
    const box = g.nodes.find((n) => n.id === gid)!
    const worldRects = kids.map((k) => ({ x: box.x + k.x, y: box.y + k.y, w: k.w, h: k.h }))
    const tightBox = {
      x: Math.min(...worldRects.map((r) => r.x)) - 20,
      y: Math.min(...worldRects.map((r) => r.y)) - 20,
      w: Math.max(...worldRects.map((r) => r.x + r.w)) - Math.min(...worldRects.map((r) => r.x)) + 40,
      h: Math.max(...worldRects.map((r) => r.y + r.h)) - Math.min(...worldRects.map((r) => r.y)) + 40,
    }
    const worldBefore = worldRects.map((r) => ({ x: r.x, y: r.y }))

    /** 手工把框拖大 ⇒ `hug` 不会收（只长不缩），`tight` 收回去 */
    g = reduce(
      { kind: 'node.resize', id: gid, rect: { x: box.x, y: box.y, w: box.w + 300, h: box.h + 200 }, phase: 'end' },
      g,
    ).next
    const hugged = reduce({ kind: 'node.refitContainer', id: gid, mode: 'hug' }, g).next
    expect(sizeOf(hugged, gid)).toMatchObject({ w: box.w + 300, h: box.h + 200 })
    const tight = reduce({ kind: 'node.refitContainer', id: gid, mode: 'tight' }, g).next
    expect(sizeOf(tight, gid).w).toBe(tightBox.w)
    expect(sizeOf(tight, gid).h).toBe(tightBox.h)
    /** 缩框只挪原点、**不动孩子在世界里的位置** */
    expect(
      tight.nodes
        .filter((n) => n.parentId === gid)
        .map((k) => ({ x: sizeOf(tight, gid).x + k.x, y: sizeOf(tight, gid).y + k.y })),
    ).toEqual(worldBefore)
  })

  /**
   * ★★ 用户第 15 批 #334-⑤：「因为分组节点而连接的两个节点，在**离开分组后也不会取消**
   * 联系和连线」。
   *
   * 分组从来不清连线（批 14 #324 起：只有批量那条路清），所以"出组"这条也要保持 ——
   * 这条断言把"离开分组不动连线"钉死，免得哪天有人给组也加上清边。
   */
  it('★★ 组内节点带着连线离开分组：连线**不取消**', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 800, y: 100 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const [a, b] = g.nodes.filter((n) => n.type === 'generation').map((n) => n.id)
    g = reduce({ kind: 'node.reparent', id: a!, toParent: gid }, g).next
    /** a（组内）→ b（组外）连一条 */
    g = reduce({ kind: 'edge.connect', source: a!, target: b! }, g).next
    expect(g.edges).toHaveLength(1)

    const out = reduce({ kind: 'node.reparent', id: a!, toParent: null }, g).next
    expect(out.nodes.find((n) => n.id === a!)!.parentId).toBeNull()
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0]!.source).toBe(a!)
    expect(out.edges[0]!.target).toBe(b!)
  })

  it('★ 已经贴合时 `hug` 是一条静默 no-op（不发补丁，不进撤销栈）', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 100, y: 100 } }, g).next
    const gid = g.nodes.find((n) => n.type === 'group')!.id
    const kid = g.nodes.find((n) => n.type === 'generation')!.id
    g = reduce({ kind: 'node.reparent', id: kid, toParent: gid }, g).next
    const r = reduce({ kind: 'node.refitContainer', id: gid, mode: 'hug' }, g)
    expect(r.result.patches).toHaveLength(0)
    expect(r.result.transaction.mode).toBe('silent')
  })
})
