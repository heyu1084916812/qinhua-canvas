import type { NodeLike, GraphSnapshot, EdgeLike } from '../model/graph'
import { indexNodes, isDescendantOf } from '../model/graph'
import { convertOnReparent } from '../geometry/coords'
import { getSpec } from '../nodeSpecs/registry'
import { canAcceptIntoBatch } from '../nodeSpecs/batch'
import type { BatchLike } from '../nodeSpecs/batch'

export type ReparentCheck = { ok: true } | { ok: false; reason: string }

/** 进入或离开容器时清理该节点的全部连线（产品文档 §9.2） */
export function edgesToDropOnReparent(nodeId: string, edges: readonly EdgeLike[]): string[] {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => e.id)
}

export function canReparent(
  node: NodeLike,
  toParent: NodeLike | null,
  graph: GraphSnapshot,
): ReparentCheck {
  if (toParent && toParent.id === node.id) {
    return { ok: false, reason: '不能把节点放进自己' }
  }
  if (toParent && isDescendantOf(graph.nodes, toParent.id, node.id)) {
    return { ok: false, reason: '不能把节点放进自己的后代' }
  }
  if (!toParent) return { ok: true }

  const parentSpec = getSpec(toParent.type)
  if (parentSpec) {
    const children = parentSpec.accepts.children
    if (children && !children.includes(node.type)) {
      return { ok: false, reason: `${toParent.type} 不能收纳 ${node.type}` }
    }
  }

  const nodeSpec = getSpec(node.type)
  if (nodeSpec?.accepts.parent && !nodeSpec.accepts.parent.includes(toParent.type)) {
    return { ok: false, reason: `${node.type} 不能进入 ${toParent.type}` }
  }

  // 批量节点的「二选一」互斥（§6.12）：已收纳素材时不能再放提示词，反之亦然。
  // 与拖拽层共用同一函数，避免「能拖进去但落库失败」的割裂。
  if (toParent.type === 'batch' && (node.type === 'prompt' || node.type === 'generation')) {
    const reason = canAcceptIntoBatch(
      toParent as NodeLike & BatchLike,
      node.type === 'prompt' ? 'prompt' : 'generation',
      graph,
    )
    if (reason) return { ok: false, reason }
  }

  return { ok: true }
}

/** 按当前图状态换算坐标并改写 parentId；调用方负责先过 canReparent 与连线清理 */
export function applyReparent(
  node: NodeLike,
  toParentId: string | null,
  graph: GraphSnapshot,
): NodeLike {
  const index = indexNodes(graph.nodes)
  const from = node.parentId ? index.get(node.parentId) ?? null : null
  const to = toParentId ? index.get(toParentId) ?? null : null
  return convertOnReparent(node, from, to)
}
