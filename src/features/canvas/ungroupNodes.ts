import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { childIdsOfNode } from '../../domain/canvas/nodeSpecs/group'
import { groupFitSize } from '../../domain/canvas/layout/packContainer'
import { CONTAINER_PADDING } from '../../domain/canvas/layout/constants'

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
  /**
   * 打组改成"背景板"之后（用户 2026-10-06 第 14 批第 1 条），组的贴合尺寸是
   * **孩子们的包围盒 + 四边等距**（`groupFitSize`），不是批量的 200×160 网格贴合 ——
   * 早先这里用的是 `containerMinSize('group', 个数)`，会把自由于画布坐标上的
   * 孩子们算成一个跟谁都不贴的框。
   */
  const kids = graph.nodes.filter((n) => n.parentId === groupId)
  if (kids.length === 0) return { ok: false, reason: '组里还没有节点', changed: false }
  const fit = groupFitSize(kids)
  const minX = Math.min(...kids.map((k) => k.x))
  const minY = Math.min(...kids.map((k) => k.y))
  const tight =
    group.w === fit.w &&
    group.h === fit.h &&
    minX === CONTAINER_PADDING &&
    minY === CONTAINER_PADDING
  if (tight) return { ok: true, changed: false }
  /**
   * 收紧走 `node.refitContainer(mode:'tight')`：那份数学（`refitGroupPatches`）不只改尺寸 ——
   * 孩子跑到原点外时还要**连组原点一起挪**、并把每个孩子的 local 坐标同步修正
   * （世界位置零变化）。它是**唯一会缩框的路径**（自动路径只长不缩，见 `hug`）。
   */
  store.dispatch({ kind: 'node.refitContainer', id: groupId, mode: 'tight' })
  return { ok: true, changed: true }
}

/**
 * 把组框**贴合**到孩子们现在的包围盒（原点与尺寸一起算）。
 *
 * 两个调用方要的**模式不同**（别合成一条）：
 * - 组内「排列」（宫格 / 水平 / 垂直）⇒ **`'tight'`**：排列把整块内容重排成新尺寸，
 *   框必须**连收缩带上**，否则"内容 + 四边等距 20"这条规则当场破掉
 *（用户第 18 批：宫格排列后 940×280 的框留在 940 宽、内容只占 504 ⇒ 左右留白 **219 / 217**，
 *   而规格是 20 —— 因为这条一直走的是只长不缩的 `hug`）。
 * - 拖动组内某个节点松手时（#334-④：只拖出一半 ⇒ **分组背景适应节点**）⇒ **`'hug'`**：
 *   那一趟只该"长上去包住它"，绝不能因为别的节点被挪走就把板缩掉。
 */
export function refitGroupBox(
  store: CanvasStore,
  groupId: string,
  planId?: string,
  mode: 'hug' | 'tight' = 'hug',
): void {
  store.dispatch(
    { kind: 'node.refitContainer', id: groupId, mode },
    planId ? { mode: 'multi-step', planId, label: '排列节点' } : undefined,
  )
}

/**
 * 解组：把组内节点**原地**放回世界层，再删掉组本身 —— 一步撤销。
 *
 * 「原地」如今是**字面意义的原地**（用户 2026-10-06 第 14 批第 1 条把打组改成"背景板"之后）：
 * 组内的子节点本来就按自己的 local 坐标显示（`GroupBody`，不排网格、不缩放），
 * 而 `node.reparent` 的 `convertOnReparent` 天然保持世界位置不变 ⇒
 * 逐个 reparent 出去，它们**一个像素都不动**。
 *
 * ⚠️ 早先这里按 3×3 网格算"格位坐标 + 格位尺寸"（那是"组内走网格"时代的产物）：
 * 在新布局下它会把节点**搬到格子去、还改成 200×160** —— 解组会让用户的排版散架。
 *
 * @returns 放出去的子节点个数（0 = 组本来就空）
 */
export function ungroupNodes(store: CanvasStore, groupId: string): number {
  const graph = store.getSnapshot()
  const group = graph.nodes.find((n) => n.id === groupId)
  if (!group) return 0
  const ordered = childIdsOfNode(group, graph)

  if (ordered.length === 0) {
    store.dispatch({ kind: 'node.delete', ids: [groupId] })
    return 0
  }

  /**
   * ⚠️ 事务边界必须**显式**传 `multi-step`（与 `useArrangeTools.applyTargets` 同一手法）：
   * 这里每个子节点一条 reparent、外加删组，命令自带的事务边界各不相同
   * ⇒ 不锁成同一个 planId 就会被拆成好几个撤销单元，用户按一次撤销只退掉一半。
   */
  const tx = { mode: 'multi-step' as const, planId: `ungroup:${groupId}`, label: '解组' }
  for (const id of ordered) store.dispatch({ kind: 'node.reparent', id, toParent: null }, tx)
  /**
   * 子节点这时已经不在组里（上一步逐个 reparent），所以删组不会级联删掉它们。
   * 选中**放出来的这批**：紧接着拖动 / 下载 / 再打组的都是它们。
   */
  store.dispatch({ kind: 'node.delete', ids: [groupId] }, tx)
  store.setSelection(ordered)
  return ordered.length
}
