import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { NODE_MINIMUMS } from '../../../domain/canvas/layout/constants'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'

export interface CanvasRect {
  x: number
  y: number
  w: number
  h: number
}

export const AGENT_NODE_GAP = 48

export function intersectsRect(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Agent 移动的是顶层节点时，容器子节点也必须按世界矩形参与避让。 */
export function worldRects(graph: Pick<GraphSnapshot, 'nodes'>, exclude: readonly string[] = []) {
  const skipped = new Set(exclude)
  return graph.nodes
    .filter((node) => !skipped.has(node.id))
    .map((node) => toWorldRectInGraph(node, graph as unknown as GraphSnapshot))
}

/** 容器内的节点不应由 Agent 拖动或缩放，尺寸归容器自己的排版规则管理。 */
export function isTopLevelNode(node: Pick<NodeSnapshot, 'parentId'>): boolean {
  return !node.parentId
}

export function snapshotRects(
  nodes: readonly Pick<NodeSnapshot, 'x' | 'y' | 'w' | 'h'>[],
): CanvasRect[] {
  return nodes.map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h }))
}


/**
 * 目标矩形的相对位置优先；只有真的压住别人时才继续向右找空位。
 * 不把“移动 A 靠近 B”强行变成画布整理，避免用户明确指定的位置被改写。
 */
export function avoidRectOverlap(
  desired: CanvasRect,
  occupied: readonly CanvasRect[],
  gap = AGENT_NODE_GAP,
): CanvasRect {
  const out = { ...desired }
  for (let guard = 0; guard < 400; guard += 1) {
    const collisions = occupied.filter((other) => intersectsRect(out, other))
    if (collisions.length === 0) return out
    const nextX = Math.min(...collisions.map((other) => other.x + other.w + gap))
    out.x = nextX
    if (!Number.isFinite(out.x)) break
  }
  return out
}

export function nodeMinSize(node: NodeSnapshot): CanvasRect {
  const min = NODE_MINIMUMS[node.type] ?? { w: 120, h: 80 }
  return { x: node.x, y: node.y, w: Math.max(120, min.w), h: Math.max(80, min.h) }
}

export function placeNodeWithoutOverlap(
  store: CanvasStore,
  nodeId: string,
  desired: CanvasRect,
): CanvasRect {
  const graph = store.getSnapshot()
  const final = avoidRectOverlap(desired, worldRects(graph, [nodeId]))
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (node && (node.x !== final.x || node.y !== final.y)) {
    store.dispatch({
      kind: 'node.move',
      ids: [nodeId],
      dx: final.x - node.x,
      dy: final.y - node.y,
      phase: 'end',
    })
  }
  return final
}
