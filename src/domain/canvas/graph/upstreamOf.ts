import type { EdgeLike } from '../model/graph'

/**
 * 反向邻接索引（target → sources 列表）。
 *
 * `directUpstream` 是 O(E)：对 N 个节点各调一次就是 O(N·E)——300 节点 / 500 边
 * 的画布上，每帧 15 万次比较，实测吃掉拖动帧预算的三分之一（M6-29 Profiler：
 * `directUpstream` 7.3% self time）。建一次索引是 O(E)，之后每次查询 O(1)。
 */
export function indexEdgesByTarget(edges: readonly EdgeLike[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of edges) {
    const bucket = out.get(e.target)
    if (bucket) bucket.push(e.source)
    else out.set(e.target, [e.source])
  }
  return out
}

/** 从索引里取直接上游；无上游时返回空数组（调用方无需判空） */
export function upstreamsFrom(index: Map<string, string[]>, nodeId: string): string[] {
  return index.get(nodeId) ?? []
}

export function directUpstream(nodeId: string, edges: readonly EdgeLike[]): string[] {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source)
}

export function directDownstream(nodeId: string, edges: readonly EdgeLike[]): string[] {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target)
}

/** 全部上游（祖先），按 BFS 由近及远返回 */
export function upstreamOf(nodeId: string, edges: readonly EdgeLike[]): string[] {
  const out: string[] = []
  const seen = new Set<string>([nodeId])
  let frontier = directUpstream(nodeId, edges)
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
      next.push(...directUpstream(id, edges))
    }
    frontier = next
  }
  return out
}

/** 全部下游（后代），按 BFS 由近及远返回 */
export function downstreamOf(nodeId: string, edges: readonly EdgeLike[]): string[] {
  const out: string[] = []
  const seen = new Set<string>([nodeId])
  let frontier = directDownstream(nodeId, edges)
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
      next.push(...directDownstream(id, edges))
    }
    frontier = next
  }
  return out
}
