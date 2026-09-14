import type { NodeLike, EdgeLike } from '../model/graph'

export interface TopoResult {
  /** 拓扑序；有环时只包含可排序的部分 */
  order: string[]
  /** 环路；空数组表示无环 */
  cycles: string[][]
}

/**
 * Kahn 拓扑排序。同层按节点数组原顺序出队，保证结果稳定（可测试、可复现）。
 * 有环时把剩余节点交给 findCycles 提取完整环路。
 */
export function topoSort(nodes: readonly NodeLike[], edges: readonly EdgeLike[]): TopoResult {
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

  // 用索引保持原顺序稳定
  const orderIndex = new Map(nodes.map((n, i) => [n.id, i]))
  const queue = nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id)

  const order: string[] = []
  while (queue.length > 0) {
    queue.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))
    const id = queue.shift()!
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }

  const cycles = order.length === nodes.length ? [] : findCycles(nodes, edges)
  return { order, cycles }
}

/** Tarjan 强连通分量：分量内节点数 > 1，或单点自环，即为环路 */
export function findCycles(nodes: readonly NodeLike[], edges: readonly EdgeLike[]): string[][] {
  const known = new Set(nodes.map((n) => n.id))
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  const selfLoops = new Set<string>()

  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue
    if (e.source === e.target) selfLoops.add(e.source)
    adj.get(e.source)!.push(e.target)
  }

  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  let counter = 0

  const strongConnect = (v: string): void => {
    index.set(v, counter)
    low.set(v, counter)
    counter += 1
    stack.push(v)
    onStack.add(v)

    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w)
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0))
      }
    }

    if ((low.get(v) ?? 0) === (index.get(v) ?? 0)) {
      const component: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        component.push(w)
      } while (w !== v)

      if (component.length > 1 || selfLoops.has(v)) cycles.push(component)
    }
  }

  for (const n of nodes) if (!index.has(n.id)) strongConnect(n.id)
  return cycles
}

export function hasCycle(nodes: readonly NodeLike[], edges: readonly EdgeLike[]): boolean {
  return topoSort(nodes, edges).cycles.length > 0
}

/** target 是否可从 source 到达（连线前的成环预判） */
export function isReachable(
  edges: readonly EdgeLike[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const list = adj.get(e.source)
    if (list) list.push(e.target)
    else adj.set(e.source, [e.target])
  }
  const seen = new Set<string>([source])
  const stack = [source]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const next of adj.get(cur) ?? []) {
      if (next === target) return true
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return false
}
