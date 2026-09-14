import type { Point } from '../../domain/canvas/geometry/rect'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import { CONTAINER_TYPES } from '../../domain/canvas/model/node'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import { indexNodes } from '../../domain/canvas/model/graph'
import { toWorldRect, worldToLocal, toWorldRectInGraph } from '../../domain/canvas/geometry/coords'
import { packedCellAt } from '../../domain/canvas/layout/packContainer'
import { CONTAINER_PADDING } from '../../domain/canvas/layout/constants'
import { canReparent } from '../../domain/canvas/graph/reparent'

/**
 * 拖拽落点 → 归属判定（产品文档 §6.11「拖入 / 拖出」）。
 *
 * 视图层只做「命中几何 + 落位坐标」这类展示计算，合法性仍走 domain 的 canReparent，
 * 命令层会再校验一次（同一份规则，不重复实现）。
 *
 * 优先级：指针（或节点中心）落在哪个容器里就归谁——
 * 分组 / 批量 → 画板 → 空白（脱离容器回根层）。
 * 容器自身不参与（也只允许拖进画板），保持单层收纳。
 */
export interface DropReparent {
  toParent: string | null
  /** 容器内的 local 坐标 */
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

/** 指针（world）下最靠上的容器 / 画板：分组批量优先于画板 */
function hitContainer(point: Point, graph: GraphSnapshot): NodeSnapshot | null {
  const index = indexNodes(graph.nodes)
  const ascending = [...graph.nodes].reverse() // 后添加的在上层
  let board: NodeSnapshot | null = null
  for (const n of ascending) {
    if (n.disabled) continue
    if (!CONTAINER_TYPES.has(n.type)) continue
    const rect = toWorldRect(n, n.parentId ? index.get(n.parentId) ?? null : null)
    if (!contains(rect, point)) continue
    // group / batch 是收纳容器，命中即返回；画板作为退路
    if (n.type === 'group' || n.type === 'batch') return n
    if (!board) board = n
  }
  return board
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
  // 容器本体拖动只改坐标（是否进画板由下面的画板分支决定）
  if (CONTAINER_TYPES.has(dragged.type)) {
    const board = hitContainer(worldPoint, graph)
    if (board && board.type === 'board' && board.id !== dragged.parentId) {
      const check = canReparent(dragged, board, graph)
      if (!check.ok) return { kind: 'rejected', reason: check.reason, containerId: board.id }
      return { kind: 'ok', drop: { toParent: board.id, at: localInBoard(worldPoint, board, dragged, graph) } }
    }
    return { kind: 'none' }
  }

  /**
   * 结果组子节点（父不在 nodes 表）落在**组内** → 不动。
   *
   * 两条理由，缺一不可：
   * 1. 组内没有位置语义——格位是算出来的，「在组内挪个位」无从谈起；
   * 2. 更实际的坑：**单击**也会走一遍松手判定（按下即注册、无位移也会走到这），
   *    若照「有 parentId + 落在空白 = 脱离容器」处理，点一下就把结果甩出组了。
   * 「取出」由拖动阈值（NodeLayer）负责，那里才是用户真的想拿走的时候。
   */
  const homeRg =
    dragged.parentId && !index.has(dragged.parentId)
      ? graph.resultGroups.find((g) => g.id === dragged.parentId) ?? null
      : null
  if (homeRg && contains({ x: homeRg.x, y: homeRg.y, w: homeRg.w, h: homeRg.h }, worldPoint)) {
    return { kind: 'none' }
  }

  // 落点所在容器：与自己当前归属相同 → 不重复 reparent（否则每拖一次都吸到新单元）
  const container = hitContainer(worldPoint, graph)
  if (container) {
    if (container.id === dragged.parentId) return { kind: 'none' }
    const check = canReparent(dragged, container, graph)
    if (!check.ok) return { kind: 'rejected', reason: check.reason, containerId: container.id }
    if (container.type === 'group' || container.type === 'batch') {
      // 吸附：空闲单元 = 现有子节点数（已在容器内的不算新增）
      const existing = childrenOfContainer(container, graph).filter((c) => c.id !== nodeId)
      const cell = packedCellAt(existing.length)
      const rect = toWorldRect(container, container.parentId ? index.get(container.parentId) ?? null : null)
      return { kind: 'ok', drop: { toParent: container.id, at: { x: rect.x + cell.x, y: rect.y + cell.y } } }
    }
    // 画板不重排内部坐标，保留相对位置
    return {
      kind: 'ok',
      drop: { toParent: container.id, at: localInBoard(worldPoint, container, dragged, graph) },
    }
  }

  // 落点不在任何容器内：已在容器 / 画板里的节点脱离回根层
  if (!dragged.parentId) return { kind: 'none' }
  return {
    kind: 'ok',
    drop: { toParent: null, at: { x: worldPoint.x - dragged.w / 2, y: worldPoint.y - dragged.h / 2 } },
  }
}

/**
 * 画板内的 local 坐标：保留节点相对位置（画板不重排内容）。
 * worldPoint 是判定点，节点左上角 = 判定点 - 节点内偏移。
 */
function localInBoard(
  worldPoint: Point,
  board: NodeSnapshot,
  dragged: NodeSnapshot,
  graph: GraphSnapshot,
): Point {
  const index = indexNodes(graph.nodes)
  const prevParent = dragged.parentId ? index.get(dragged.parentId) ?? null : null
  const rect = toWorldRect(dragged, prevParent)
  const offsetX = worldPoint.x - rect.x
  const offsetY = worldPoint.y - rect.y
  const world = { x: worldPoint.x - offsetX, y: worldPoint.y - offsetY }
  const local = worldToLocal(world, board)
  const w = Math.max(0, board.w - dragged.w)
  const h = Math.max(0, board.h - dragged.h)
  return {
    x: Math.min(Math.max(CONTAINER_PADDING, local.x), w),
    y: Math.min(Math.max(CONTAINER_PADDING, local.y), h),
  }
}

export { packedCellAt }
