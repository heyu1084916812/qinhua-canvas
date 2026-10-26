import type { RunTaskState } from '../shared/execution/runEngine'
import type { GeneratedAsset } from '../../platform/channels/types'

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
 * 漫剧工作台依赖的画布能力。
 *
 * 这是能力清单，不是画布 Store 的第二份实现：真实对象由 app 组合根创建，
 * 并把调用转发给唯一 canvasStore / CanvasExecutionApi。storyboard workbench
 * 只认这个端口，不直接 import 画布私有层。
 */
export interface StoryboardCanvasPort {
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
  putAsset(asset: GeneratedAsset): void
  runNode(
    nodeId: string,
    opts?: { alt?: boolean; inPlace?: boolean },
  ): Promise<void>
  nodeStateOf(nodeId: string): RunTaskState | undefined
  readonly isRunning: boolean
}
