import type { Point, Rect } from '../../domain/canvas/geometry/rect'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import { CONTAINER_TYPES } from '../../domain/canvas/model/node'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import { indexNodes } from '../../domain/canvas/model/graph'
import { toWorldRect, toWorldRectInGraph } from '../../domain/canvas/geometry/coords'
import { packedCellAt } from '../../domain/canvas/layout/packContainer'
import { canReparent } from '../../domain/canvas/graph/reparent'
import { childIdsOfNode } from '../../domain/canvas/nodeSpecs/group'

/**
 * 拖拽落点 → 归属判定（产品文档 §6.11「拖入 / 拖出」）。
 *
 * 视图层只做「命中几何 + 落位坐标」这类展示计算，合法性仍走 domain 的 canReparent，
 * 命令层会再校验一次（同一份规则，不重复实现）。
 *
 * 优先级：指针（或节点中心）落在哪个容器里就归谁——
 * 分组 / 批量 → 空白（脱离容器回根层）。
 * 容器自身不参与，保持单层收纳。
 */
export interface DropReparent {
  toParent: string | null
  /** 目标归属下的左上角坐标：有父级 = 它的 local；`null` = 世界坐标 */
  at: Point
}

/** 落点判定结果：要么给出归属，要么给出被拒绝的原因（§6.12 弱提示需要原因） */
export type DropOutcome =
  | { kind: 'ok'; drop: DropReparent }
  /** 落点命中容器但不允许收纳（如批量集合二选一）——UI 据此弹弱提示 */
  | { kind: 'rejected'; reason: string; containerId: string }
  /** 无需 reparent（原地落下 / 已在根层的空白） */
  | { kind: 'none' }

/** 判定点：优先指针所在位置，指针不在节点内（快速甩动）时退回节点中心 */
export function dropPointOf(
  pointer: Point | null,
  node: NodeSnapshot,
  graph: GraphSnapshot,
): Point {
  // 走 `toWorldRectInGraph` 而非直接 `toWorldRect`：父级可能是结果组（不在 nodes 表），
  // 那时必须回 resultGroups 查原点，否则子节点的 local 坐标会被当成世界坐标。
  const rect = toWorldRectInGraph(node, graph)
  const center: Point = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  if (!pointer) return center
  const inside =
    pointer.x >= rect.x && pointer.x <= rect.x + rect.w && pointer.y >= rect.y && pointer.y <= rect.y + rect.h
  return inside ? pointer : center
}

/** 点是否落在矩形内（含边界） */
function contains(r: { x: number; y: number; w: number; h: number }, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** 两个矩形有没有**重叠**（"完整拖出去"的判据：一点都不重叠才算出去了） */
function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** 指针（world）下最靠上的容器（分组 / 批量）：后添加的在上层 */
function hitContainer(point: Point, graph: GraphSnapshot): NodeSnapshot | null {
  const index = indexNodes(graph.nodes)
  const ascending = [...graph.nodes].reverse() // 后添加的在上层
  for (const n of ascending) {
    if (n.disabled) continue
    if (!CONTAINER_TYPES.has(n.type)) continue
    const rect = toWorldRect(n, n.parentId ? index.get(n.parentId) ?? null : null)
    if (!contains(rect, point)) continue
    return n
  }
  return null
}

/** 组的子节点清单（含刚拖入、尚未写进 childIds 的），供网格吸附取序号 */
function childrenOfContainer(container: NodeSnapshot, graph: GraphSnapshot): NodeSnapshot[] {
  return graph.nodes.filter((n: NodeSnapshot) => n.parentId === container.id)
}

export function resolveDropReparent(
  nodeId: string,
  worldPoint: Point,
  graph: GraphSnapshot,
): DropReparent | null {
  const outcome = resolveDropOutcome(nodeId, worldPoint, graph)
  return outcome.kind === 'ok' ? outcome.drop : null
}

/**
 * 与 resolveDropReparent 同一套判定，但把「被拒绝」也当作结果返回。
 *
 * 为什么需要：§6.12 要求「另一种类型拖入被拒绝并给出弱提示」——
 * 只返回 null 的话，调用方无法区分「不需要 reparent」与「想放但被拒绝」，
 * 后者才是要给用户提示的情形。
 */
export function resolveDropOutcome(
  nodeId: string,
  worldPoint: Point,
  graph: GraphSnapshot,
): DropOutcome {
  const index = indexNodes(graph.nodes)
  const dragged = index.get(nodeId)
  if (!dragged) return { kind: 'none' }
  /**
   * 容器本体拖动**只改坐标**：不嵌套容器，保持单层收纳。
   * 容器不再支持互相嵌套。
   */
  if (CONTAINER_TYPES.has(dragged.type)) return { kind: 'none' }

  /**
   * ① **已在分组里**：归属由**节点矩形**（不是指针位置）决定。
   *
   * 「移出分组」只有三种情形（用户 2026-10-06 第 14 批第 1 条）：选中节点拖出分组 /
   * 节点的边缘超出分组边缘（有一部分在外面）/ 解散分组。前两种是**同一件事** ——
   * 只要节点不再完整落在组框里，就算它出去了。
   *
   * 这条口径同时消掉「单击组内节点就被甩出组」那个 bug：按住点一下矩形没动，
   * 判定结果与按下前逐字一致。旧口径看的是**指针落在哪**：节点只要有一部分探出组框
   * （打组的包装框比内容大时很常见），点在探出的那一块上就被当成"落在组外的空白"，
   * 于是**单击**也能把它逐出 —— 完全不是用户做的动作。
   *
   * ⚠️ 只对**分组**生效。批量的单元是固定的 200×160 网格位（拖进去按空位吸附），
   * 拿"完整包含"当进门条件会把大素材永远挡在门外。
   */
  const rect = toWorldRectInGraph(dragged, graph)
  const parent = dragged.parentId ? index.get(dragged.parentId) ?? null : null
  /** 容器不做嵌套 ⇒ 父级的世界矩形就是它自己 */
  const worldRectOf = (n: NodeSnapshot): Rect => toWorldRect(n, null)

  if (parent?.type === 'group') {
    /**
     * 「拖出分组」的判据（用户第 15 批 #334-④）：
     * **完整拖出去**（节点的矩形与组框**完全不重叠**）才算离开；
     * 只拖出一半 ⇒ **留在组里**，松手时由调用方把框**长到包住它**
     * （「如果只拖了一半的话要适应分组边缘与节点的留白规则」+「分组背景适应节点」）。
     */
    if (intersects(worldRectOf(parent), rect)) return { kind: 'none' }
    return { kind: 'ok', drop: { toParent: null, at: { x: rect.x, y: rect.y } } }
  }

  // 落点所在容器：与自己当前归属相同 → 不重复 reparent（否则每拖一次都吸到新单元）
  const container = hitContainer(worldPoint, graph)
  if (container) {
    if (container.id === dragged.parentId) return { kind: 'none' }
    /**
     * **进组**按落点判（指针 / 节点中心落在组框里就算，与历史口径一致），
     * 不像"出组"那样要求整个矩形都在里面 —— 进组之后组框会自己长到包住它
     *（`refitGroupPatches` 按孩子的包围盒算），所以"进去时差一点点"会立刻被抹平；
     * 反过来要求"完整落进去才收"，会让"把一个大节点拖进小框"变成一件做不到的事。
     */
    const check = canReparent(dragged, container, graph)
    if (!check.ok) return { kind: 'rejected', reason: check.reason, containerId: container.id }
    /**
     * `at` 是"目标归属下面的左上角坐标"：进**分组**就是它被拖到的世界位置
     * （组不排网格、不吸附，"落在哪就是哪"）；进**批量**才吸到空的网格位。
     */
    if (container.type === 'group') {
      return { kind: 'ok', drop: { toParent: container.id, at: { x: rect.x, y: rect.y } } }
    }
    // 吸附：空闲单元 = 现有子节点数（已在容器内的不算新增）
    const existing = childrenOfContainer(container, graph).filter((c) => c.id !== nodeId)
    const cell = packedCellAt(existing.length)
    const hostRect = worldRectOf(container)
    return {
      kind: 'ok',
      drop: { toParent: container.id, at: { x: hostRect.x + cell.x, y: hostRect.y + cell.y } },
    }
  }

  // 落点不在任何容器内：已在容器里的节点脱离回根层
  if (!dragged.parentId) return { kind: 'none' }
  return {
    kind: 'ok',
    drop: { toParent: null, at: { x: rect.x, y: rect.y } },
  }
}

export { packedCellAt }

/**
 * 批量里的**格位归属**：这个子节点该待在哪个格位（返回值是"重投一次归属"的落位）。
 *
 * 批量的位置语义是 3×3 格位（按 `childIds` 顺序），不是画布位置，所以有三处要用它：
 * ① 拖进来自动吸空位（`resolveDropOutcome` 已经算好 `at`）；
 * ② 在批量里拖完**贴回自己的格位**（第 15 批 #335-③ 只要求"看得见拖动"，格内重排不是这一批的事）；
 * ③ **拖动开始时先归一**（把坐标写成格位）—— 视图才能用"坐标 − 格位"算出这一趟的真实位移，
 *    否则批量里的子节点坐标是历史残留（可能是世界坐标），一拖就会出现莫名其妙的偏移。
 *
 * 不是批量的子节点（含分组子节点、顶层节点）返回 null。
 */
export function batchSlotOf(
  childId: string,
  graph: GraphSnapshot,
): { parentId: string; at: Point } | null {
  const child = graph.nodes.find((n) => n.id === childId)
  if (!child?.parentId) return null
  const parent = graph.nodes.find((n) => n.id === child.parentId)
  if (!parent || parent.type !== 'batch') return null
  const idx = childIdsOfNode(parent, graph).indexOf(childId)
  if (idx < 0) return null
  return { parentId: parent.id, at: packedCellAt(idx) }
}
