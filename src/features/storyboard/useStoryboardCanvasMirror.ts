import { useEffect, useRef } from 'react'
import {
  attachShotImages,
  attachShotVideos,
  setAssetBaseHash,
  setAssetTurnaroundHash,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import type { StoryboardCanvasNode } from './canvasPort'

function assetHashOf(
  nodes: ReadonlyMap<string, StoryboardCanvasNode>,
  nodeId: string | undefined,
): string | undefined {
  if (!nodeId) return undefined
  const data = nodes.get(nodeId)?.data as { assetHash?: unknown } | undefined
  return typeof data?.assetHash === 'string' ? data.assetHash : undefined
}

/**
 * 只把画布上真正变化的产物 hash 投影回漫剧文档；无变化时返回原对象。
 */
export function mirrorStoryboardCanvasDocument(
  doc: StoryboardDoc,
  nodes: readonly StoryboardCanvasNode[],
): StoryboardDoc {
  const byId = new Map<string, StoryboardCanvasNode>()
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node)
  }
  let next = doc

  const imageUpdates: { shotId: string; hash: string }[] = []
  const videoUpdates: { shotId: string; hash: string }[] = []
  for (const shot of doc.shots) {
    const imageHash = assetHashOf(byId, shot.nodeId)
    if (imageHash && imageHash !== shot.imageHash) {
      imageUpdates.push({ shotId: shot.id, hash: imageHash })
    }
    const videoHash = assetHashOf(byId, shot.videoNodeId)
    if (videoHash && videoHash !== shot.videoHash) {
      videoUpdates.push({ shotId: shot.id, hash: videoHash })
    }
  }
  if (imageUpdates.length > 0) next = attachShotImages(next, imageUpdates, 0)
  if (videoUpdates.length > 0) next = attachShotVideos(next, videoUpdates, 0)

  for (const kind of ['char', 'scene'] as const) {
    const list = kind === 'char' ? next.characters : next.scenes
    for (const asset of list) {
      const baseHash = assetHashOf(byId, asset.nodeId)
      if (baseHash && baseHash !== asset.baseHash) {
        next = setAssetBaseHash(next, kind, asset.id, baseHash, 0)
      }
      if (kind !== 'char' || !asset.turnaroundNodeId) continue
      const turnaroundHash = assetHashOf(byId, asset.turnaroundNodeId)
      if (turnaroundHash && turnaroundHash !== asset.turnaroundHash) {
        next = setAssetTurnaroundHash(next, 'char', asset.id, turnaroundHash, 0)
      }
    }
  }

  return next
}

/**
 * 漫剧文档唯一挂载一次的画布投影副作用。
 */
export function useStoryboardCanvasMirror({
  doc,
  nodes,
  replaceDoc,
}: {
  doc: StoryboardDoc | null
  nodes: readonly StoryboardCanvasNode[]
  replaceDoc: (next: StoryboardDoc) => unknown
}): void {
  const replaceDocRef = useRef(replaceDoc)
  replaceDocRef.current = replaceDoc

  useEffect(() => {
    if (!doc) return
    const next = mirrorStoryboardCanvasDocument(doc, nodes)
    if (next !== doc) replaceDocRef.current(next)
  }, [doc, nodes])
}
