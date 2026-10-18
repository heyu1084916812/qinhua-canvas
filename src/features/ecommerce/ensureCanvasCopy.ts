import { noOverlapDelta } from '../canvas/duplicatePlacement'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { EcommerceResultRecord } from '../../domain/ecommerce/tasks'
import { createId } from '../../shared/id'

export interface CanvasCopyResult {
  nodeId: string
  created: boolean
}

/**
 * 电商结果进入画布时的**显式副本**。
 *
 * 内部执行节点 `result.nodeId` 只负责跑引擎；用户一旦要编辑，
 * 就在画布里生成独立节点，之后重命名、连线、重跑都不会再碰电商任务。
 */
export function ensureEcommerceCanvasCopy(args: {
  store: CanvasStore
  projectId: string
  result: EcommerceResultRecord
  title: string
}): CanvasCopyResult {
  const { store, projectId, result, title } = args
  const graph = store.getSnapshot()
  const existing = result.canvasCopyNodeId
    ? graph.nodes.find((node) => node.id === result.canvasCopyNodeId)
    : undefined
  if (existing) return { nodeId: existing.id, created: false }

  const source = graph.nodes.find((node) => node.id === result.nodeId)
  const others = graph.nodes.filter((node) => node.id !== source?.id)
  const nodeId = createId('node')
  const naturalSize =
    typeof result.width === 'number' &&
    result.width > 0 &&
    typeof result.height === 'number' &&
    result.height > 0
      ? { width: result.width, height: result.height }
      : undefined
  const size = naturalSize ? assetNodeSize(naturalSize) : undefined
  store.beginPlan('ecommerce:canvas-copy', '复制电商结果到画布')
  try {
    if (source) {
      const delta = noOverlapDelta([source], others)
      store.dispatch({
        kind: 'node.duplicate',
        ids: [source.id],
        newIds: [nodeId],
        dx: delta.dx,
        dy: delta.dy,
      })
      store.dispatch({ kind: 'node.rename', id: nodeId, title })
      /* 副本不再属于电商批次：之后所有电商历史 / 重跑都不会把它当成内部载体。 */
      store.dispatch({
        kind: 'node.updateData',
        id: nodeId,
        patch: {
          ecommerceBatch: null,
          ...(naturalSize ? { naturalSize } : {}),
        },
        ...(size ? { size } : {}),
      })
    } else {
      const size = assetNodeSize({
        width: result.width,
        height: result.height,
      })
      const right = graph.nodes.reduce((max, node) => Math.max(max, node.x + node.w), 0)
      store.dispatch({
        kind: 'node.create',
        projectId,
        type: 'generation',
        id: nodeId,
        at: { x: right + 40, y: 60 },
        size,
        title,
        data: {
          ...generationSpec.createDefaultData(),
          mode: 'image',
          count: 1,
          ...(result.assetHash ? { assetHash: result.assetHash } : {}),
          ...(result.prompt ? { prompt: result.prompt } : {}),
          ...(result.model ? { model: result.model } : {}),
          ...(result.width && result.height
            ? { naturalSize: { width: result.width, height: result.height } }
            : {}),
        },
      })
    }
    store.setSelection([nodeId])
  } finally {
    store.endPlan()
  }
  return { nodeId, created: true }
}
