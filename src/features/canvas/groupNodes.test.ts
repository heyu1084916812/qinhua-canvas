import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../state/workbenches/canvas/store'
import { groupNodes } from './groupNodes'

/**
 * 打组（用户 2026-10-05 第 10 条：`Ctrl+G`；第 11 条多选功能栏里的「打组」按钮同源）。
 */

beforeEach(() => registerAllSpecs())

const store = (): CanvasStore =>
  createCanvasStore({ platform: createMemoryPlatform() as never, projectId: 'p1' })

function add(store: CanvasStore, x: number, y: number, w = 200, h = 160): string {
  const id = `node_${x}_${y}`
  store.dispatch({
    kind: 'node.create',
    projectId: 'p1',
    type: 'generation',
    id,
    at: { x, y },
    size: { w, h },
  })
  return id
}

describe('groupNodes · 把选中的节点收进新分组', () => {
  it('★★ 建组 + 把选中节点收进去，并选中新分组', () => {
    const s = store()
    const a = add(s, 0, 0)
    const b = add(s, 400, 200)
    const groupId = groupNodes(s, [a, b])

    expect(groupId).toBeTruthy()
    const g = s.getSnapshot()
    const group = g.nodes.find((n) => n.id === groupId)!
    expect(group.type).toBe('group')
    expect((group.data as { childIds?: string[] }).childIds).toEqual([a, b])
    expect(g.nodes.find((n) => n.id === a)!.parentId).toBe(groupId)
    expect(g.nodes.find((n) => n.id === b)!.parentId).toBe(groupId)
    /** 收完选中的是**组**：紧接着的拖动 / 删除作用在组上 */
    expect(s.getSelection()).toEqual([groupId])
  })

  it('★★ 分组的框包住选中的内容（不写死尺寸）', () => {
    const s = store()
    const a = add(s, 0, 0, 200, 160)
    const b = add(s, 400, 200, 300, 240)
    const groupId = groupNodes(s, [a, b])!
    const group = s.getSnapshot().nodes.find((n) => n.id === groupId)!
    expect(group.x).toBeLessThan(0)
    expect(group.y).toBeLessThan(0)
    expect(group.x + group.w).toBeGreaterThan(700)
    expect(group.y + group.h).toBeGreaterThan(440)
  })

  it('★★ 一整步撤销：组与两个归属一起回退', () => {
    const s = store()
    const a = add(s, 0, 0)
    const b = add(s, 400, 200)
    groupNodes(s, [a, b])
    expect(s.getSnapshot().nodes).toHaveLength(3)

    s.undo()
    const g = s.getSnapshot()
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes.every((n) => n.parentId === null)).toBe(true)
  })

  it('★ 没有可收的节点（空选 / 已在别的容器里）→ 不建组', () => {
    const s = store()
    const a = add(s, 0, 0)
    expect(groupNodes(s, [])).toBeNull()
    /** 已经在容器里的不再套一层（先手动收一次，再对它打组） */
    const groupId = groupNodes(s, [a])!
    expect(groupNodes(s, [a])).toBeNull()
    expect(s.getSnapshot().nodes.filter((n) => n.type === 'group')).toHaveLength(1)
    expect(s.getSnapshot().nodes.find((n) => n.id === a)!.parentId).toBe(groupId)
  })
})
