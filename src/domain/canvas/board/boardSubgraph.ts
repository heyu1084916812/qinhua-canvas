import type { GraphSnapshot } from '../model/graph'

/**
 * 提取画板内部的子图（产品文档 §6.13「运行整个画板」）。
 *
 * 节点：直接挂在画板下的节点（parentId === boardId）。
 * 连线：仅保留两端都在子图节点集合内的边——画板内节点不能跨出画板连线（§6.13），
 * 跨画板的边（source 或 target 在画板外）不属于本地子流程。
 *
 * 返回完整 GraphSnapshot（projectId 沿用），可直接喂给 buildRunPlan 的 { subgraph } 源。
 */
export function boardSubgraph(graph: GraphSnapshot, boardId: string): GraphSnapshot {
  const nodes = graph.nodes.filter((n) => n.parentId === boardId)
  const ids = new Set(nodes.map((n) => n.id))
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  return { projectId: graph.projectId, nodes, edges, resultGroups: [] }
}
