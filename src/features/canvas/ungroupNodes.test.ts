import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../state/workbenches/canvas/store'
import { groupNodes } from './groupNodes'
import { arrangeGroupMembers, ungroupNodes } from './ungroupNodes'

/**
 * 组的两个"整组"动作（用户 2026-10-06 第 13 批第 5 条：
 * 组的功能栏里要有 **整理节点 / 整组执行 / 解组**）。
 */

beforeEach(() => registerAllSpecs())

const store = (): CanvasStore =>
  createCanvasStore({ platform: createMemoryPlatform() as never, projectId: 'p1' })

function add(s: CanvasStore, x: number, y: number, w = 200, h = 160): string {
  const id = `node_${x}_${y}`
  s.dispatch({ kind: 'node.create', projectId: 'p1', type: 'generation', id, at: { x, y }, size: { w, h } })
  return id
}

describe('ungroupNodes · 解组', () => {
  it('★★ 子节点一个像素都不动（WYSIWYG），组消失，放出来的被选中', () => {
    const s = store()
    const a = add(s, 100, 100)
    const b = add(s, 500, 300)
    const gid = groupNodes(s, [a, b])!
    const released = ungroupNodes(s, gid)
    expect(released).toBe(2)

    const g = s.getSnapshot()
    expect(g.nodes.find((n) => n.id === gid)).toBeUndefined()
    const na = g.nodes.find((n) => n.id === a)!
    const nb = g.nodes.find((n) => n.id === b)!
    expect(na.parentId).toBeNull()
    expect(nb.parentId).toBeNull()
    /**
     * 组是"背景板"（子节点按自己的坐标显示，不排网格）⇒ 解组就是把它们**原样**放回世界层：
     * 世界坐标与尺寸与打组前逐字相同（`convertOnReparent` 保持世界位置）。
     * 早先按 3×3 格位算的那版会把它们搬到格子去、还改成 200×160 —— 排版会散架。
     */
    expect({ x: na.x, y: na.y }).toEqual({ x: 100, y: 100 })
    expect({ x: nb.x, y: nb.y }).toEqual({ x: 500, y: 300 })
    expect({ w: na.w, h: na.h }).toEqual({ w: 200, h: 160 })
    expect(s.getSelection()).toEqual([a, b])
  })

  it('★ 一步撤销：组与归属一起回退', () => {
    const s = store()
    const a = add(s, 0, 0)
    const b = add(s, 400, 200)
    const gid = groupNodes(s, [a, b])!
    ungroupNodes(s, gid)
    expect(s.getSnapshot().nodes.some((n) => n.id === gid)).toBe(false)

    s.undo()
    const g = s.getSnapshot()
    expect(g.nodes.find((n) => n.id === gid)).toBeTruthy()
    expect(g.nodes.find((n) => n.id === a)!.parentId).toBe(gid)
  })

  it('空组直接移除（不留空壳）', () => {
    const s = store()
    s.dispatch({ kind: 'node.create', projectId: 'p1', type: 'group', id: 'g1', at: { x: 0, y: 0 } })
    expect(ungroupNodes(s, 'g1')).toBe(0)
    expect(s.getSnapshot().nodes.some((n) => n.id === 'g1')).toBe(false)
  })
})

describe('arrangeGroupMembers · 把组框贴回内容', () => {
  it('★★ 手工拖大的框被收回"内容 + 四边等距"', () => {
    const s = store()
    const a = add(s, 100, 100)
    const b = add(s, 500, 100)
    const gid = groupNodes(s, [a, b])!
    const before = s.getSnapshot().nodes.find((n) => n.id === gid)!

    /** 模拟"用户把框拖大过" */
    s.dispatch({
      kind: 'node.resize',
      id: gid,
      rect: { x: before.x, y: before.y, w: before.w + 400, h: before.h + 300 },
      phase: 'end',
    })
    const r = arrangeGroupMembers(s, gid)
    expect(r.changed).toBe(true)

    const after = s.getSnapshot().nodes.find((n) => n.id === gid)!
    /** 收回到"打组那一刻算出的贴合框"（= 孩子们包围盒 + 四边 20） */
    expect({ w: after.w, h: after.h }).toEqual({ w: before.w, h: before.h })
    /** 位置一个字都不动（这里孩子们的包围盒没挪过，原点无需平移） */
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y })
  })

  it('★ 孩子们被拖到原点左上时，收紧要连组原点一起挪（世界位置零变化）', () => {
    const s = store()
    const a = add(s, 100, 100)
    const b = add(s, 500, 100)
    const gid = groupNodes(s, [a, b])!
    /** 把一个孩子往左上拖出组框（local 变成负数）——松手前它就在外面 */
    s.dispatch({ kind: 'node.move', ids: [a], dx: -80, dy: -60, phase: 'end' })
    const worldBefore = (() => {
      const g = s.getSnapshot()
      const group = g.nodes.find((n) => n.id === gid)!
      const na = g.nodes.find((n) => n.id === a)!
      return { x: group.x + na.x, y: group.y + na.y }
    })()

    const r = arrangeGroupMembers(s, gid)
    expect(r.changed).toBe(true)

    const g = s.getSnapshot()
    const group = g.nodes.find((n) => n.id === gid)!
    const na = g.nodes.find((n) => n.id === a)!
    /** 框挪了、孩子的 local 坐标被同步修正 ⇒ 孩子在世界里没动过 */
    expect({ x: group.x + na.x, y: group.y + na.y }).toEqual(worldBefore)
    expect(na.x).toBe(20)
    expect(na.y).toBe(20)
  })

  it('本来就贴住内容 ⇒ changed=false（按钮不会像没反应，界面拿它出提示）', () => {
    const s = store()
    const a = add(s, 100, 100)
    const b = add(s, 500, 100)
    const gid = groupNodes(s, [a, b])!

    const r = arrangeGroupMembers(s, gid)
    expect(r.ok).toBe(true)
    expect(r.changed).toBe(false)
  })
})
