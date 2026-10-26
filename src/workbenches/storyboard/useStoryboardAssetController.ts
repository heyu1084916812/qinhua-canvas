import type { Dispatch, SetStateAction } from 'react'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type { StoryboardDoc } from '../../domain/storyboard/storyboard'
import {
  assetBasePrompt,
  assetTurnaroundPrompt,
  setAssetNode,
  setAssetTurnaroundNode,
} from '../../domain/storyboard/storyboard'
import { asAppError, describeError } from '../../shared/result'

export interface StoryboardAssetControllerArgs {
  doc: StoryboardDoc
  currentDoc: () => StoryboardDoc | null
  liveNodeIds: ReadonlySet<string>
  canvas: StoryboardCanvasPort
  apply: (doc: StoryboardDoc) => void
  setLay: Dispatch<
    SetStateAction<{
      kind: 'idle' | 'running' | 'done' | 'error'
      text: string
    }>
  >
}

export function createStoryboardAssetController(
  args: StoryboardAssetControllerArgs,
) {
  const {
    doc,
    currentDoc,
    liveNodeIds,
    canvas,
    apply,
    setLay,
  } = args
  const humanError = (error: unknown) => {
    const appError = asAppError(error)
    return appError
      ? describeError(appError)
      : error instanceof Error
        ? error.message
        : String(error)
  }

  /**
   * 「出定妆图 / 基准图」（对账 #419）：这一条资产没有节点就先建一个（提示词按资产拼），
   * 再**原地跑一次**（`inPlace`，产物写回它自己的节点，不铺第二个）。
   *
   * 节点被用户在画布上删过（悬空）时同样算"没有节点"：这里会重新建一个 ——
   * 与镜头上「铺到画布」那条判据同源（缓存不是真相）。
   */
  const makeAssetBase = async (kind: 'char' | 'scene', assetId: string) => {
    const asset = kind === 'char' ? doc.characters.find((c) => c.id === assetId) : doc.scenes.find((s) => s.id === assetId)
    if (!asset) return
    const alive = asset.nodeId && liveNodeIds.has(asset.nodeId) ? asset.nodeId : null
    try {
      let nodeId = alive
      if (!nodeId) {
        const data = await canvas.resolveGenerationData({
          mode: 'image',
          prompt: assetBasePrompt(asset, kind),
        })
        const base = canvas.getSnapshot().nodes.length
        canvas.beginPlan('storyboard:asset-base', kind === 'char' ? '定妆图 ×1' : '基准图 ×1')
        try {
          nodeId = canvas.createGenerationNode({
            at: { x: 40, y: 40 + base * 200 },
            data,
          })
        } finally {
          canvas.endPlan()
        }
        if (!nodeId) return
        const current = currentDoc()
        if (current) apply(setAssetNode(current, kind, assetId, nodeId, 0))
      }
      await canvas.runNode(nodeId, { inPlace: true })
    } catch (e) {
      setLay({ kind: 'error', text: humanError(e) })
    }
  }

  /**
   * 「多视角 turnaround」：角色专用。先建一个独立的生成节点，再原地跑。
   *
   * 如果定妆图节点还活着，就把它连成参考图 —— 多视角要的是**同一个角色**，
   * 只靠文字描述很容易生成成另一个人。节点与边放在同一个 plan 里，一次撤销全退。
   */
  const makeAssetTurnaround = async (assetId: string) => {
    const asset = doc.characters.find((c) => c.id === assetId)
    if (!asset) return
    const alive =
      asset.turnaroundNodeId && liveNodeIds.has(asset.turnaroundNodeId)
        ? asset.turnaroundNodeId
        : null
    try {
      let nodeId = alive
      if (!nodeId) {
        const data = await canvas.resolveGenerationData({
          mode: 'image',
          prompt: assetTurnaroundPrompt(asset),
        })
        const base = canvas.getSnapshot().nodes.length
        canvas.beginPlan('storyboard:asset-turnaround', '多视角 ×1')
        try {
          nodeId = canvas.createGenerationNode({
            at: { x: 40, y: 40 + base * 200 },
            data,
          })
          if (!nodeId) return
          const baseNodeId =
            asset.nodeId && liveNodeIds.has(asset.nodeId) ? asset.nodeId : null
          if (baseNodeId) {
            canvas.connectEdge(baseNodeId, nodeId)
          }
        } finally {
          canvas.endPlan()
        }
        if (!nodeId) return
        const current = currentDoc()
        if (current) apply(setAssetTurnaroundNode(current, 'char', assetId, nodeId, 0))
      }
      await canvas.runNode(nodeId, { inPlace: true })
    } catch (e) {
      setLay({ kind: 'error', text: humanError(e) })
    }
  }

  return {
    makeAssetBase,
    makeAssetTurnaround,
  }
}
