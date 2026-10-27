import type { VisualReviewTarget } from '../../../domain/agent/visualReview'
import type { NodeInput } from '../../../domain/shared/execution/types'
import { imageSizeFromHeader } from '../../../domain/shared/imageSize'
import type { AssetPayload } from '../../../platform/ports'

export interface VisualReviewPreparedImages {
  targets: VisualReviewTarget[]
  targetInputs: NodeInput[]
  contextInputs: NodeInput[]
  referenceAssetCount: number
  limitations: string[]
}

export interface VisualReviewGraphNode {
  id: string
  title?: string
  data?: unknown
}

/**
 * 视觉验收前的确定性素材检查。
 *
 * 视觉模型只能基于真正读回、类型正确且能识别尺寸的图片工作。节点上有一个 hash
 * 不等于素材可读，所以这里先查字节和图片头；失败项进 limitations，不伪装成
 * “已检查”。项目套件素材与目标图按 hash 去重，避免同一张 Logo 被重复计数。
 */
export async function prepareVisualReviewImages(input: {
  graph: { nodes: readonly VisualReviewGraphNode[] }
  nodeIds: readonly string[]
  contextAssets?: readonly { hash: string; mime: string }[]
  readAsset: (hash: string) => Promise<AssetPayload | null>
  maxTargets?: number
  maxReferences?: number
}): Promise<VisualReviewPreparedImages> {
  const maxTargets = Math.max(1, input.maxTargets ?? 8)
  const maxReferences = Math.max(0, input.maxReferences ?? 8)
  const targetNodeIds = [...new Set(input.nodeIds)].slice(0, maxTargets)
  const limitations: string[] = []
  if (input.nodeIds.length > targetNodeIds.length) {
    limitations.push(
      `本次只验收前 ${targetNodeIds.length} 张，另有 ${
        new Set(input.nodeIds).size - targetNodeIds.length
      } 张未提交。`,
    )
  }

  const targets: VisualReviewTarget[] = []
  const targetInputs: NodeInput[] = []
  const seenHashes = new Set<string>()
  for (const nodeId of targetNodeIds) {
    const fallbackTitle = `目标图片 ${targets.length + 1}`
    const node = input.graph.nodes.find((item) => item.id === nodeId)
    if (!node) {
      limitations.push(`「${fallbackTitle}」不存在`)
      continue
    }
    const displayTitle = node.title?.trim() || fallbackTitle
    const data = (node.data ?? {}) as {
      assetHash?: unknown
      assetMime?: unknown
      naturalSize?: { width?: unknown; height?: unknown }
    }
    const hash =
      typeof data.assetHash === 'string' ? data.assetHash.trim() : ''
    if (!hash) {
      limitations.push(`「${displayTitle}」还没有图片产物`)
      continue
    }
    const mime =
      typeof data.assetMime === 'string' && data.assetMime
        ? data.assetMime
        : 'image/png'
    if (!mime.startsWith('image/')) {
      limitations.push(`「${displayTitle}」不是图片，不能做视觉验收`)
      continue
    }
    const payload = await input.readAsset(hash).catch(() => null)
    if (!payload?.bytes.length) {
      limitations.push(`「${displayTitle}」的图片字节不可读`)
      continue
    }
    const recordedWidth = Number(data.naturalSize?.width)
    const recordedHeight = Number(data.naturalSize?.height)
    const measured =
      recordedWidth > 0 && recordedHeight > 0
        ? { width: recordedWidth, height: recordedHeight }
        : imageSizeFromHeader(payload.bytes)
    targets.push({
      nodeId,
      title: displayTitle,
      ...(measured && measured.width > 0 && measured.height > 0
        ? { width: measured.width, height: measured.height }
        : {}),
      mime: payload.mime || mime,
    })
    seenHashes.add(hash)
    targetInputs.push({
      kind: 'asset',
      nodeId,
      assetHash: hash,
      mime: payload.mime || mime,
      ...(measured && measured.width > 0 && measured.height > 0
        ? { naturalSize: measured }
        : {}),
    })
  }

  const contextInputs: NodeInput[] = []
  let referenceAssetCount = 0
  for (const asset of input.contextAssets ?? []) {
    if (referenceAssetCount >= maxReferences) break
    if (!asset.mime.startsWith('image/') || seenHashes.has(asset.hash)) continue
    const payload = await input.readAsset(asset.hash).catch(() => null)
    if (!payload?.bytes.length) {
      limitations.push('已绑定套件中的一张参考素材不可读')
      continue
    }
    const size = imageSizeFromHeader(payload.bytes)
    seenHashes.add(asset.hash)
    contextInputs.push({
      kind: 'asset',
      nodeId: `context-kit:${asset.hash}`,
      assetHash: asset.hash,
      mime: payload.mime || asset.mime,
      ...(size && size.width > 0 && size.height > 0
        ? { naturalSize: size }
        : {}),
    })
    referenceAssetCount += 1
  }

  return {
    targets,
    targetInputs,
    contextInputs,
    referenceAssetCount,
    limitations,
  }
}
