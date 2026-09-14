export interface Edge {
  id: string
  projectId: string
  source: string
  target: string
}

/** 边的去重键：同一对端点只允许一条边 */
export function edgeKey(source: string, target: string): string {
  return `${source}->${target}`
}

export function hasEdge(edges: readonly Edge[], source: string, target: string): boolean {
  return edges.some((e) => e.source === source && e.target === target)
}
