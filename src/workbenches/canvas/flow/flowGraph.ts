import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'

/**
 * 画布图层面的小helper（纯函数，可单测）。
 *
 * 为什么要有：React Flow 面只把**顶层节点**交给库摆位，容器里的子节点必须由容器本体渲染
 * （与老画布那套「容器子节点按网格渲染」同一套语义）—— 于是"谁是顶层、谁是谁的孩子"这件事
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

export interface MarqueeRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * React Flow 的框选以内部测量值为准；节点刚出图、尺寸变化时偶尔会晚一拍。
 * 最终落库前再用 store 里的真实矩形和用户画出的世界矩形裁一次，避免选中框外的节点。
 */
export function nodesIntersectingMarquee(
  graph: GraphSnapshot,
  marquee: MarqueeRect,
  baseline: readonly string[] = [],
): string[] {
  const left = Math.min(marquee.x, marquee.x + marquee.w)
  const right = Math.max(marquee.x, marquee.x + marquee.w)
  const top = Math.min(marquee.y, marquee.y + marquee.h)
  const bottom = Math.max(marquee.y, marquee.y + marquee.h)
  const out = new Set(baseline)
  for (const node of topLevelNodes(graph)) {
    if (
      node.x < right &&
      node.x + node.w > left &&
      node.y < bottom &&
      node.y + node.h > top
    ) {
      out.add(node.id)
    }
  }
  return [...out]
}

/**
 * 节点测量缓存键：尺寸或父级变化后，React Flow 必须重新量 handle。
 * 出图会让生成节点突然换尺寸；只监听 id 集合会漏掉这次重测，表现就是线突然消失。
 */
export function nodeMeasurementKey(graph: GraphSnapshot): string {
  return graph.nodes
    .map((node) => `${node.id}:${node.w}x${node.h}:${node.parentId ?? ''}`)
    .join('|')
}
