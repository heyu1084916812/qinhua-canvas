import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'

/**
 * 画布图层面的小helper（纯函数，可单测）。
 *
 * 为什么要有：React Flow 面只把**顶层节点**交给库摆位，容器里的子节点必须由容器本体渲染
 * （与老表面 `NodeLayer.renderChild` 同一套语义）—— 于是"谁是顶层、谁是谁的孩子"这件事
 * 值得抽出来单独钉住，而不是埋在两层 `useMemo` 里。
 */

/** 容器类型：分组 / 批量的子节点由本体的网格布局决定位置，画布不为它们单独摆位 */
export function isContainerType(type: NodeType): boolean {
  return type === 'group' || type === 'batch'
}

/**
 * 父 → 子索引（整图一次，O(N)）。
 *
 * 注意 `parentId` 不一定指向 `nodes` 里的节点：结果组的子节点指向 `resultGroups` 表里的组
 * （那张表不在 `graph.nodes` 里）。所以索引照建，但**渲染时要不要用**由调用方判断。
 */
export function childrenByParent(graph: GraphSnapshot): Map<string, NodeSnapshot[]> {
  const out = new Map<string, NodeSnapshot[]>()
  for (const node of graph.nodes) {
    if (!node.parentId) continue
    const bucket = out.get(node.parentId)
    if (bucket) bucket.push(node)
    else out.set(node.parentId, [node])
  }
  return out
}

/** 顶层节点（画布要摆位的那些）：没有 parentId 的都算 */
export function topLevelNodes(graph: GraphSnapshot): NodeSnapshot[] {
  return graph.nodes.filter((n) => !n.parentId)
}
