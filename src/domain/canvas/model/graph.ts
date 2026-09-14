import type { NodeSnapshot, NodeType } from './node'
import type { Edge } from './edge'
import type { ResultGroup } from './resultGroup'

export interface GraphSnapshot {
  projectId: string
  nodes: NodeSnapshot[]
  edges: Edge[]
  resultGroups: ResultGroup[]
}

/** 图算法的最小依赖：只要 id / parentId / type，方便测试里造数据 */
export interface NodeLike {
  id: string
  parentId: string | null
  type: NodeType
  x: number
  y: number
  w: number
  h: number
}

export interface EdgeLike {
  id: string
  source: string
  target: string
}

export function indexNodes<T extends NodeLike>(nodes: readonly T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const n of nodes) map.set(n.id, n)
  return map
}

/** 直接子节点（按数组顺序） */
export function childrenOf<T extends NodeLike>(nodes: readonly T[], parentId: string): T[] {
  return nodes.filter((n) => n.parentId === parentId)
}

/** 从节点向上到根的父链，含自身；环或缺失时截断，避免死循环 */
export function ancestorChain<T extends NodeLike>(
  nodes: readonly T[],
  nodeId: string,
): T[] {
  const index = indexNodes(nodes)
  const chain: T[] = []
  const seen = new Set<string>()
  let current = index.get(nodeId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parentId ? index.get(current.parentId) : undefined
  }
  return chain
}

export function isDescendantOf(
  nodes: readonly NodeLike[],
  nodeId: string,
  maybeAncestorId: string,
): boolean {
  const index = indexNodes(nodes)
  let current = index.get(nodeId)
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.parentId === maybeAncestorId) return true
    current = index.get(current.parentId)
  }
  return false
}
