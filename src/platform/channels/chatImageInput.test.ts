import { describe, expect, it } from 'vitest'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_PX,
  chatImageNeedsPrepare,
  chatImageTargetSize,
  prepareChatImage,
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
})
