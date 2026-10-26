import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import { rememberCanvasCover } from '../../state/project/cover'
import {
  ensureFreshDisplayThumb,
  rememberFreshAsset,
} from '../../platform/freshAssets'
import type { PlatformKit } from '../../platform/ports'

export interface ImportedEcommerceAsset {
  hash: string
  mime: string
  name?: string
  width?: number
  height?: number
}

export function isEcommerceImageFile(file: Blob): boolean {
  return !file.type || file.type.startsWith('image/')
}

/**
 * 电商上传只落公共素材库，不创建画布节点。
 *
 * 返回的 hash 同时作为上传槽的稳定 id；旧草稿里的 `node_*` 仍由只读兼容路径解析。
 */
export async function importEcommerceAsset(args: {
  platform: PlatformKit
  projectId: string
  file: Blob & { name?: string }
}): Promise<ImportedEcommerceAsset | null> {
  if (!isEcommerceImageFile(args.file) || args.file.size === 0) return null
  const bytes = new Uint8Array(await args.file.arrayBuffer())
  if (bytes.length === 0) return null
  const hash = await fingerprintBytes(bytes)
  const mime = args.file.type || 'image/png'
  const size = imageSizeFromHeader(bytes)
  const at = Date.now()
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  rememberFreshAsset(hash, blob)
  void ensureFreshDisplayThumb(hash, size)
  await args.platform.storage.put(
    'assets',
    {
      id: hash,
      hash,
      mime,
      bytes,
      ...(size ?? {}),
      createdAt: at,
      projectId: args.projectId,
    } as never,
  )
  void rememberCanvasCover(args.platform.storage, args.projectId, hash, at)
  return {
    hash,
    mime,
    ...(args.file.name ? { name: args.file.name } : {}),
    ...(size ? { width: size.width, height: size.height } : {}),
  }
}
