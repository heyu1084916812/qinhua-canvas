import { createId } from '../../shared/id'
import type { CanvasStore } from '../../state/workbenches/canvas/store'

/** 分组框在选中内容四周留的边距（顶部多留一点：容器标题条在那儿） */
const PAD = 40
const PAD_TOP = 68

/**
 * 把选中的节点**收进一个新分组**（用户 2026-10-05 第 10 条：`Ctrl+G` 打组；
 * 第 11 条多选功能栏里的「打组」也走这一条）。
 *
 * 三条口径：
 * ① **只收顶层节点**：已经在别的容器里的不再套一层（分组不嵌套容器，`node.reparent`
 *    本身也拒绝「容器收容器」）；
 * ② **一次事务**：建组 + 逐个 reparent 之间 `beginPlan/endPlan`，撤销一步全回去；
 * ③ 分组的框**包住选中的内容**（坐标由内容算，不写死尺寸）。
 *
 * @returns 新分组的节点 id；没有可收的节点时返回 null
 */
export function groupNodes(store: CanvasStore, ids: readonly string[]): string | null {
  const graph = store.getSnapshot()
  const wanted = new Set(ids)
  const tops = graph.nodes.filter((n) => wanted.has(n.id) && !n.parentId)
  if (tops.length === 0) return null

  const minX = Math.min(...tops.map((n) => n.x)) - PAD
  const minY = Math.min(...tops.map((n) => n.y)) - PAD_TOP
  const maxX = Math.max(...tops.map((n) => n.x + n.w)) + PAD
  const maxY = Math.max(...tops.map((n) => n.y + n.h)) + PAD

  const groupId = createId('node')
  store.beginPlan(groupId, '打组')
  try {
    store.dispatch({
      kind: 'node.create',
      projectId: graph.projectId,
      type: 'group',
      id: groupId,
      at: { x: minX, y: minY },
      size: { w: maxX - minX, h: maxY - minY },
    })
    for (const n of tops) store.dispatch({ kind: 'node.reparent', id: n.id, toParent: groupId })
    /** 选中的是**新分组**：紧接着的拖动 / 删除都作用在组上，而不是里面某个节点 */
    store.setSelection([groupId])
  } finally {
    store.endPlan()
  }
  return groupId
}
