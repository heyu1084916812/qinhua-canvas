import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { buildRunPlan, type RunPlan } from './buildRunPlan'

/**
 * 分组执行必须和普通画布运行共用同一条规划链。
 *
 * 旧实现把组内每个可执行节点分别调用 `runNode`：多个生成节点会各建各的承载节点，
 * 没有提示词 / 上游输入的节点还会先生成一个空壳。这里先把组内节点裁成子图，
 * 再交给 `buildRunPlan(..., 'rerunAll')`：拓扑、输入收集、空计划过滤和落位规则
 * 都与画布原逻辑一致。
 */
export function buildGroupRunPlan(
  graph: GraphSnapshot,
  memberIds: readonly string[],
): RunPlan {
  const ids = new Set(memberIds)
  const subgraph: GraphSnapshot = {
    ...graph,
    nodes: graph.nodes.filter((node) => ids.has(node.id)),
    edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  }
  return buildRunPlan(
    'node',
    { subgraph, containerKind: 'group' },
    graph,
    'rerunAll',
  )
}
