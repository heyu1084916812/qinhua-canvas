import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../state/workbenches/canvas/store'
import { containerMinSize } from '../../domain/canvas/layout/packContainer'
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
  it('★★ 子节点落在它刚才显示的位置上（WYSIWYG），组消失，放出来的被选中', () => {
    const s = store()
    const a = add(s, 100, 100)
    const b = add(s, 500, 300)
    const gid = groupNodes(s, [a, b])!
    const group = s.getSnapshot().nodes.find((n) => n.id === gid)!
    const released = ungroupNodes(s, gid)
    expect(released).toBe(2)

    const g = s.getSnapshot()
    expect(g.nodes.find((n) => n.id === gid)).toBeUndefined()
    const na = g.nodes.find((n) => n.id === a)!
    const nb = g.nodes.find((n) => n.id === b)!
    expect(na.parentId).toBeNull()
    expect(nb.parentId).toBeNull()
    /** 网格第 1 格 = (20,20)；第 2 格 = (236,20)（200 宽 + 16 间距） */
    expect({ x: na.x, y: na.y }).toEqual({ x: group.x + 20, y: group.y + 20 })
    expect({ x: nb.x, y: nb.y }).toEqual({ x: group.x + 20 + 216, y: group.y + 20 })
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
  it('★★ 手工拖大的框被收回"内容 + 四边等距"，位置不动', () => {
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
    expect({ w: after.w, h: after.h }).toEqual(containerMinSize('group', 2))
    /** 位置一个字都不动（整理的是框，不是搬组） */
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y })
  })

  it('本来就贴住内容 ⇒ changed=false（按钮不会像没反应，界面拿它出提示）', () => {
    const s = store()
    const a = add(s, 100, 100)
    const b = add(s, 500, 100)
    const gid = groupNodes(s, [a, b])!
    const g = s.getSnapshot().nodes.find((n) => n.id === gid)!
    const fit = containerMinSize('group', 2)
    s.dispatch({ kind: 'node.resize', id: gid, rect: { x: g.x, y: g.y, w: fit.w, h: fit.h }, phase: 'end' })

    const r = arrangeGroupMembers(s, gid)
    expect(r.ok).toBe(true)
    expect(r.changed).toBe(false)
  })
})
