import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import { childIdsOf } from '../../domain/canvas/nodeSpecs/group'
import { containerMinSize, packContainerChildren } from '../../domain/canvas/layout/packContainer'

/**
 * 容器排序键的适配：`childIdsOf` 只认 `{ id, data.childIds }`（它同时服务分组与批量，
 * 见 `nodeSpecs/group.ts` 的 `ContainerLike`），而 `NodeSnapshot.data` 是个联合类型。
 * 只在这一层抹平，别去放宽 domain 的签名（那会把"谁都能当容器"混进来）。
 */
const asContainer = (n: NodeSnapshot): { id: string; data: { childIds?: string[] } } => ({
  id: n.id,
  data: n.data as { childIds?: string[] },
})

/**
 * 组的两个"整组"动作（用户 2026-10-06 第 13 批第 5 条：组的功能栏里要有
 * **整理节点 / 整组执行 / 解组**）。
 *
 * 与 `groupNodes.ts` 同一个形状：命令层不认识"组"这个业务动作，
 * 由这层把**多条命令**串成一个事务（一步撤销），组件只调用。
 */

/**
 * 组内「整理节点」= **把组框贴回内容**（= 内容 + 四边等距 20px，与自动贴合同一份数学）。
 *
 * 为什么不是"按依赖重排位置 / 顺序"：
 * ① 容器里**不建立边**（`canConnect` 规则 4：子节点之间、子节点与外部都不连线），
 *    所以没有依赖可排 —— 写一套"依赖整理"在这里是**永远不会被走到**的死路径；
 * ② 子节点的位置本来就由 3×3 网格**自动整理**（用户 2026-10-06 答复：
 *    「容器内不做吸附 —— 容器本身有自动整理」）。
 * 真正会"不整齐"的只有**框**：手工拖大之后它比内容大一圈，这里把它收回去。
 *
 * 返回 `changed`：没得收（本来就贴住内容）时也要**如实说**，别让按钮像点了没反应。
 */
export function arrangeGroupMembers(
  store: CanvasStore,
  groupId: string,
): { ok: boolean; reason?: string; changed: boolean } {
  const graph = store.getSnapshot()
  const group = graph.nodes.find((n) => n.id === groupId)
  if (!group) return { ok: false, reason: '分组不存在', changed: false }
  const count = childIdsOf(asContainer(group), graph).length
  const fit = containerMinSize('group', count)
  if (group.w === fit.w && group.h === fit.h) return { ok: true, changed: false }
  /**
   * `node.updateData` + `size`：只改尺寸、**位置一个字都不动**（正是这里要的语义，
   * 用 `node.resize` 还得自己把当前位置原样带回去）。
   */
  store.dispatch({ kind: 'node.updateData', id: groupId, patch: {}, size: fit })
  return { ok: true, changed: true }
}

/**
 * 解组：把组内节点**原地**放回世界层，再删掉组本身 —— 一步撤销。
 *
 * "原地"是指**看起来原地**：组内节点的 `x/y` 存的是"拖进去那一刻"的坐标（与网格无关），
 * 直接 reparent 会让它们叠在一角。所以逐个按**网格单元**算出世界坐标与格位尺寸
 * （`packContainerChildren` 与 `ContainerBody` 同一份数学），解组后节点落在它刚才显示的位置上。
 *
 * @returns 放出去的子节点个数（0 = 组本来就空）
 */
export function ungroupNodes(store: CanvasStore, groupId: string): number {
  const graph = store.getSnapshot()
  const group = graph.nodes.find((n) => n.id === groupId)
  if (!group) return 0
  const ordered = childIdsOf(asContainer(group), graph)

  if (ordered.length === 0) {
    store.dispatch({ kind: 'node.delete', ids: [groupId] })
    return 0
  }

  const { positions, cellSize } = packContainerChildren(ordered.length)
  /**
   * ⚠️ 事务边界必须**显式**传 `multi-step`（与 `useArrangeTools.applyTargets` 同一手法）：
   * 这里逐个子节点要发两条命令，其中 `node.resize` 自带的是 `coalesce`（key = `resize:<id>`）
   * —— 与计划 key 不同 ⇒ 会被拆成**另一个撤销单元**，用户按一次撤销只退掉一半
   * （实测：组回来了、子节点还在外面）。`multi-step` 让所有命令共用同一个 planId。
   */
  const tx = { mode: 'multi-step' as const, planId: `ungroup:${groupId}`, label: '解组' }
  ordered.forEach((id, i) => {
      const cell = positions[i] ?? { x: 0, y: 0 }
      /**
       * 先 reparent（把 local 换算成 world），再 `node.resize` **绝对矩形**落到格位 ——
       * 这是唯一能同时定位置与尺寸的既有命令（`node.updateData` 只改尺寸、不动位置）。
       */
    store.dispatch({ kind: 'node.reparent', id, toParent: null }, tx)
    store.dispatch(
      {
        kind: 'node.resize',
        id,
        rect: { x: group.x + cell.x, y: group.y + cell.y, w: cellSize.w, h: cellSize.h },
        phase: 'end',
      },
      tx,
    )
  })
  /**
   * 子节点这时已经不在组里（上一步逐个 reparent），所以删组不会级联删掉它们。
   * 选中**放出来的这批**：紧接着拖动 / 下载 / 再打组的都是它们。
   */
  store.dispatch({ kind: 'node.delete', ids: [groupId] }, tx)
  store.setSelection(ordered)
  return ordered.length
}
