/**
 * 端点 id（产品文档 §6.23 融合节点）。
 *
 * 绝大多数节点只有一对口（左 `input` / 右 `output`），这时字段缺省即可；
 * 融合节点多一个「右侧的局部修改图入口」`patch`，故边必须能记住**它插在哪一口上**——
 * 否则同一对节点之间的两条边（一条进 `patch`、一条进 `output`）无法区分。
 */
export const DEFAULT_SOURCE_PORT = 'output'
export const DEFAULT_TARGET_PORT = 'input'

export interface Edge {
  id: string
  projectId: string
  source: string
  target: string
  /**
   * 源端点 id；缺省 = `output`。
   *
   * 用**可选**而不是必填：老库里的边没有这两个字段，读回时缺省值就是它们
   * 唯一可能的语义（历史上只有一个输出口），不需要写迁移。
   */
  sourcePort?: string
  /** 目标端点 id；缺省 = `input` */
  targetPort?: string
}

export function sourcePortOf(edge: Edge): string {
  return edge.sourcePort ?? DEFAULT_SOURCE_PORT
}

export function targetPortOf(edge: Edge): string {
  return edge.targetPort ?? DEFAULT_TARGET_PORT
}

/**
 * 边的去重键：同一条**端到端**（节点 + 端口）只允许一条边。
 *
 * 带上端口是必须的：融合节点的 `patch` 与 `output` 都在右侧，
 * 只按 (source,target) 去重会把「上游分别连到这两口」判成重复。
 */
export function edgeKey(source: string, target: string, sourcePort?: string, targetPort?: string): string {
  return `${source}:${sourcePort ?? DEFAULT_SOURCE_PORT}->${target}:${targetPort ?? DEFAULT_TARGET_PORT}`
}

export function hasEdge(
  edges: readonly Edge[],
  source: string,
  target: string,
  sourcePort?: string,
  targetPort?: string,
): boolean {
  const key = edgeKey(source, target, sourcePort, targetPort)
  return edges.some((e) => edgeKey(e.source, e.target, e.sourcePort, e.targetPort) === key)
}
