import { imageSizeFromHeader, type ImageSize } from '../../domain/shared/imageSize'

/**
 * 多模态对话的输入上限。
 *
 * 20MB 原图直接转 Base64 会再膨胀约 33%，还没到模型就先超过网关请求体上限。
 * 这里只压缩“发给模型看”的那一份；素材库仍保留原图，生图请求也从原图读取。
 */
export const CHAT_IMAGE_MAX_PX = 2048
export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const CHAT_IMAGE_MIME = 'image/webp'

export interface ChatImageInput {
  bytes: Uint8Array
  mime: string
}

export function chatImageNeedsPrepare(
  byteLength: number,
  size: ImageSize | null,
): boolean {
  if (byteLength > CHAT_IMAGE_MAX_BYTES) return true
  return !!size && Math.max(size.width, size.height) > CHAT_IMAGE_MAX_PX
}

export function chatImageTargetSize(size: ImageSize): ImageSize {
  const longest = Math.max(size.width, size.height)
  if (longest <= CHAT_IMAGE_MAX_PX) return size
  const scale = CHAT_IMAGE_MAX_PX / longest
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/**
 * 读到一张图 → 给对话模型一份更小、更轻的可读副本。
 *
 * 环境不支持重编码或解码失败时**原样返回**：这是输入优化，不是业务校验；
 * 不能因为浏览器少了 OffscreenCanvas 就让一条本来能跑的对话失败。
 */
export async function prepareChatImage(input: ChatImageInput): Promise<ChatImageInput> {
  const size = imageSizeFromHeader(input.bytes.subarray(0, 65536))
  if (!chatImageNeedsPrepare(input.bytes.byteLength, size)) return input
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return input
  }

  try {
    const source = new Blob([input.bytes as unknown as BlobPart], {
      type: input.mime || 'application/octet-stream',
    })
    const target = size ? chatImageTargetSize(size) : null
    const bitmap = await createImageBitmap(
      source,
      target
        ? {
            resizeWidth: target.width,
            resizeHeight: target.height,
            resizeQuality: 'high',
          }
        : undefined,
    )
    try {
      const width = target?.width ?? bitmap.width
      const height = target?.height ?? bitmap.height
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return input
      ctx.drawImage(bitmap, 0, 0, width, height)
      for (const quality of [0.88, 0.76, 0.64, 0.52]) {
        const encoded = await canvas.convertToBlob({
          type: CHAT_IMAGE_MIME,
          quality,
        })
        if (encoded.size <= CHAT_IMAGE_MAX_BYTES || quality === 0.52) {
          return {
            bytes: new Uint8Array(await encoded.arrayBuffer()),
            mime: CHAT_IMAGE_MIME,
          }
        }
      }
    } finally {
      bitmap.close()
    }
  } catch {
    return input
  }
  return input
}
