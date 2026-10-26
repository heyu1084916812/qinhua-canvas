export interface StoryboardCanvasNode {
  id: string
  x: number
  y: number
  data: object
}

export interface StoryboardCanvasEdge {
  id: string
  source: string
  target: string
}

export interface StoryboardCanvasGraph {
  nodes: readonly StoryboardCanvasNode[]
  edges: readonly StoryboardCanvasEdge[]
}

export interface StoryboardCanvasNodeInput {
  data: Record<string, unknown>
  at: { x: number; y: number }
}

/**
 * 漫剧工作台依赖的画布投影能力。
 *
 * 这是能力清单，不是画布 Store 的第二份实现：真实对象由 app 组合根创建，
 * 并把调用转发给唯一 canvasStore。漫剧业务执行与状态不得经过这里。
 */
export interface StoryboardProjectionPort {
  getSnapshot(): StoryboardCanvasGraph
  beginPlan(id: string, label: string): void
  endPlan(): void
  resolveGenerationData(
    extraData: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  createGenerationNode(input: StoryboardCanvasNodeInput): string | null
  updateNodeData(
    id: string,
    patch: Record<string, unknown>,
    transient?: boolean,
  ): void
  connectEdge(source: string, target: string): void
  removeEdge(id: string): void
}

/** @deprecated Use {@link StoryboardProjectionPort}; kept only for staged call sites. */
export type StoryboardCanvasPort = StoryboardProjectionPort
