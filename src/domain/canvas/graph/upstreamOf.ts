import type { EdgeLike } from '../model/graph'

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
