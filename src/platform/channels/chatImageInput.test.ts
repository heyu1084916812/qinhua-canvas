import { describe, expect, it, vi } from 'vitest'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_PX,
  MODEL_IMAGE_MIME,
  chatImageNeedsPrepare,
  chatImageTargetSize,
  prepareChatImage,
  prepareModelImageInput,
} from './chatImageInput'

describe('chatImageInput', () => {
  it('小图不处理，大图或超限图才准备压缩副本', () => {
    expect(chatImageNeedsPrepare(200_000, { width: 1200, height: 800 })).toBe(false)
    expect(chatImageNeedsPrepare(CHAT_IMAGE_MAX_BYTES + 1, { width: 1200, height: 800 })).toBe(true)
    expect(chatImageNeedsPrepare(200_000, { width: 4096, height: 2160 })).toBe(true)
  })

  it('最长边封到 2048，比例不变', () => {
    expect(chatImageTargetSize({ width: 4096, height: 2160 })).toEqual({
      width: CHAT_IMAGE_MAX_PX,
      height: 1080,
    })
    expect(chatImageTargetSize({ width: 1600, height: 900 })).toEqual({
      width: 1600,
      height: 900,
    })
  })

  it('环境不支持图像重编码时保留原字节，不阻断对话', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const out = await prepareChatImage({ bytes, mime: 'image/png' })
    expect(out.bytes).toBe(bytes)
    expect(out.mime).toBe('image/png')
  })

  it('生成链路与对话链路使用同一个预处理入口', () => {
    expect(prepareModelImageInput).toBe(prepareChatImage)
  })

  it('超过请求体预算时生成更小的 WebP 副本，原字节不被改写', async () => {
    const original = new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1)
    const encoded = new Blob([new Uint8Array([7, 8, 9])], { type: MODEL_IMAGE_MIME })
    const bitmap = { width: 2048, height: 1152, close: vi.fn() }
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { drawImage: vi.fn() }
      }
      async convertToBlob() {
        return encoded
      }
    }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    try {
      const out = await prepareModelImageInput({ bytes: original, mime: 'image/png' })
      expect(out).not.toBe(original)
      expect(out.mime).toBe(MODEL_IMAGE_MIME)
      expect(Array.from(out.bytes)).toEqual([7, 8, 9])
      expect(original.byteLength).toBe(CHAT_IMAGE_MAX_BYTES + 1)
      expect(bitmap.close).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
