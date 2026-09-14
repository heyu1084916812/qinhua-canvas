import type { Rect } from '../geometry/rect'
import { rectUnion } from '../geometry/rect'
import type { NodeLike, EdgeLike } from '../model/graph'
import { findCycles } from '../graph/topoSort'

/** 整理节点的水平 / 垂直间距（产品文档 §6.5 ③「间距：水平 / 垂直间距统一 24px」） */
export const ARRANGE_GAP = 24

export interface ArrangeNodeInput {
  id: string
  rect: Rect
}

export interface ArrangeResult {
  /** id → 目标左上角坐标（只含需要移动的节点） */
  targets: Map<string, { x: number; y: number }>
  /** 拓扑层级（层索引 → 该层节点 id 列表），供测试与调试 */
  layers: string[][]
  /** 环路；非空表示无法整理（§6.5「存在环时提示」） */
  cycles: string[][]
}

/**
 * 整理节点（产品文档 §6.5 ③）。
 *
 * 语义取舍（已与产品确认）：**只对选中的节点集合做内部分层**，未选中节点完全不动。
 * 层内外的连通关系只看「选中集合内部」的边——外部节点不参与布局，
 * 否则局部整理会被无关节点拖出很远的空层。
 *
 * 布局方向：层级从左到右依次排布（层 0 在最左），同层节点纵向排列。
 * 每层内部的纵向顺序取稳定拓扑序（选中集合按原数组顺序的稳定 Kahn 出队），
 * 保证同一输入多次整理结果一致（可测试、可复现）。
 *
 * 参考点：以选中集合当前包围盒的中心为锚点原地重排 —— 不允许整理把整组甩到画布别处。
 */
export function computeArrange(
  nodes: readonly ArrangeNodeInput[],
  edges: readonly EdgeLike[],
): ArrangeResult {
  const ids = new Set(nodes.map((n) => n.id))
  if (nodes.length < 2) return { targets: new Map(), layers: [], cycles: [] }

  // 只看选中集合内部的边（外部节点不参与布局，否则局部整理会被无关节点拖出空层）
  const internalEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  // 图算法要求完整 NodeLike；这里只用到 id，其余字段按最小可用值填充
  const nodeLikes: NodeLike[] = nodes.map((n) => ({
    id: n.id,
    parentId: null,
    type: 'prompt',
    x: n.rect.x,
    y: n.rect.y,
    w: n.rect.w,
    h: n.rect.h,
  }))

  const cycles = findCycles(nodeLikes, internalEdges)
  if (cycles.length > 0) return { targets: new Map(), layers: [], cycles }

  const layers = topoLayers(nodeLikes, internalEdges)
  const index = new Map(nodes.map((n) => [n.id, n] as const))
  const bounds = rectUnion(nodes.map((n) => n.rect))
  if (!bounds) return { targets: new Map(), layers, cycles: [] }

  // 层宽 = 该层最宽节点；层高累加 = 该层所有节点高度之和
  const layerW = layers.map((layer) =>
    layer.reduce((w, id) => Math.max(w, index.get(id)?.rect.w ?? 0), 0),
  )
  const layerH = layers.map((layer) =>
    layer.reduce((h, id, i) => h + (index.get(id)?.rect.h ?? 0) + (i > 0 ? ARRANGE_GAP : 0), 0),
  )

  const totalW =
    layerW.reduce((sum, w) => sum + w, 0) + Math.max(0, layers.length - 1) * ARRANGE_GAP
  const totalH = Math.max(0, ...layerH)

  // 以原包围盒中心为锚点放置整块布局
  const originX = bounds.x + bounds.w / 2 - totalW / 2
  const originY = bounds.y + bounds.h / 2 - totalH / 2

  const targets = new Map<string, { x: number; y: number }>()
  let cursorX = originX
  for (let li = 0; li < layers.length; li += 1) {
    let cursorY = originY + (totalH - layerH[li]) / 2
    for (const id of layers[li]) {
      const rect = index.get(id)?.rect
      if (rect) {
        const x = Math.round(cursorX + (layerW[li] - rect.w) / 2)
        const y = Math.round(cursorY)
        if (x !== rect.x || y !== rect.y) targets.set(id, { x, y })
        cursorY += rect.h + ARRANGE_GAP
      }
    }
    cursorX += layerW[li] + ARRANGE_GAP
  }

  return { targets, layers, cycles }
}

/**
 * Kahn 分层（不排序，只算层）：无上游 = 第 1 层，其后逐层递推（§6.5 ③「层级判定」）。
 * 同层内保持输入数组顺序，保证稳定；调用前需确保无环。
 */
function topoLayers(nodes: readonly NodeLike[], edges: readonly EdgeLike[]): string[][] {
  const known = new Set(nodes.map((n) => n.id))
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()

  for (const n of nodes) {
    indegree.set(n.id, 0)
    outgoing.set(n.id, [])
  }
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue
    outgoing.get(e.source)!.push(e.target)
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  }

  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const layers: string[][] = []
  let frontier = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id)

  while (frontier.length > 0) {
    frontier.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    layers.push(frontier)
    const next: string[] = []
    for (const id of frontier) {
      for (const to of outgoing.get(id) ?? []) {
        const left = (indegree.get(to) ?? 0) - 1
        indegree.set(to, left)
        if (left === 0) next.push(to)
      }
    }
    frontier = next
  }
  return layers
}

/** 供 UI 判断按钮是否可用（§6.5：≥ 2 个节点选中） */
export function canArrange(selectedCount: number): boolean {
  return selectedCount >= 2
}
