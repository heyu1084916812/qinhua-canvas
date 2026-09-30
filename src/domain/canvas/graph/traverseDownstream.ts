import type { NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
import { indexNodes } from '../model/graph'
import { directDownstream } from './upstreamOf'

export type DownstreamVisitor = (node: NodeSnapshot, depth: number) => boolean | void

/**
 * 下游深度优先遍历（产品文档 §6.19.7）。
 * 内部工具：供批量 / 分组 / Agent 的实现使用，不绑定 UI 入口与快捷键。
 * callback 返回 false 时停止继续深入该分支；visited 保证有环图也不会死循环。
 */
export function traverseDownstream(
  startNodeId: string,
  graph: GraphSnapshot,
  callback: DownstreamVisitor,
): void {
  const index = indexNodes(graph.nodes)
  const start = index.get(startNodeId)
  if (!start) return

  const visited = new Set<string>([startNodeId])
  const walk = (node: NodeSnapshot, depth: number): void => {
    if (callback(node, depth) === false) return
    for (const childId of directDownstream(node.id, graph.edges)) {
      if (visited.has(childId)) continue
      visited.add(childId)
      const child = index.get(childId)
      if (child) walk(child, depth + 1)
    }
  }

  walk(start, 0)
}
