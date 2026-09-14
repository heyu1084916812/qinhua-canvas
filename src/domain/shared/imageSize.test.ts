import { describe, it, expect } from 'vitest'
import { imageSizeFromHeader } from './imageSize'

/** 拼字节：[头若干字节] + 中间补 0 + [尾部若干字节] */
function bytes(head: number[], total: number, tail: number[] = []): Uint8Array {
  const b = new Uint8Array(Math.max(total, head.length + tail.length))
  b.set(head, 0)
  if (tail.length) b.set(tail, b.length - tail.length)
  return b
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 造一份 PNG 头：签名 + IHDR 长度/四字符码 + 宽高（大端 32 位） */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set(PNG_SIG, 0)
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8) // len=13 + "IHDR"
  b[16] = (width >>> 24) & 0xff
  b[17] = (width >>> 16) & 0xff
  b[18] = (width >>> 8) & 0xff
  b[19] = width & 0xff
  b[20] = (height >>> 24) & 0xff
  b[21] = (height >>> 16) & 0xff
  b[22] = (height >>> 8) & 0xff
  b[23] = height & 0xff
  return b
}

/** 造一份 JPEG：SOI + 一个 APP0 + SOF0（里面带高宽） */
function jpeg(width: number, height: number): Uint8Array {
  return bytes(
    [
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
      0x01, 0x00, 0x00, // APP0 (len=16)
      0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, len=17, 精度 8
      (height >> 8) & 0xff, height & 0xff,
      (width >> 8) & 0xff, width & 0xff,
    ],
    32,
  )
}

function gif(width: number, height: number): Uint8Array {
  return bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 0xff, width >> 8, height & 0xff, height >> 8], 16)
}

function webpVp8(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([0x52, 0x49, 0x46, 0x46], 0) // "RIFF"
  b.set([0x57, 0x45, 0x42, 0x50], 8) // "WEBP"
  b.set([0x56, 0x50, 0x38, 0x20], 12) // "VP8 "
  b[26] = width & 0xff
  b[27] = width >> 8
  b[28] = height & 0xff
  b[29] = height >> 8
  return b
}

function webpVp8l(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([0x52, 0x49, 0x46, 0x46], 0)
  b.set([0x57, 0x45, 0x42, 0x50], 8)
  b.set([0x56, 0x50, 0x38, 0x4c], 12) // "VP8L"
  b[20] = 0x2f // 签名
  const bits = (width - 1) | ((height - 1) << 14)
  b[21] = bits & 0xff
  b[22] = (bits >>> 8) & 0xff
  b[23] = (bits >>> 16) & 0xff
  b[24] = (bits >>> 24) & 0xff
  return b
}

describe('imageSizeFromHeader / 主流格式', () => {
  it('PNG：IHDR 里的宽高（大端 32 位）', () => {
    expect(imageSizeFromHeader(png(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  it('JPEG：跳过 APP0，在 SOF0 里取高宽（注意是「高在前」）', () => {
    expect(imageSizeFromHeader(jpeg(800, 600))).toEqual({ width: 800, height: 600 })
  })

  it('GIF：逻辑屏宽高（小端 16 位）', () => {
    expect(imageSizeFromHeader(gif(320, 240))).toEqual({ width: 320, height: 240 })
  })

  it('WebP 有损（VP8）', () => {
    expect(imageSizeFromHeader(webpVp8(1024, 768))).toEqual({ width: 1024, height: 768 })
  })

  it('WebP 无损（VP8L，14 位宽高位流）', () => {
    expect(imageSizeFromHeader(webpVp8l(640, 480))).toEqual({ width: 640, height: 480 })
  })
})

describe('imageSizeFromHeader / 读不出来就返回 null（不猜）', () => {
  it('非图像字节（纯文本）', () => {
    expect(imageSizeFromHeader(new TextEncoder().encode('hello world, not an image'))).toBeNull()
  })

  it('空 / 过短', () => {
    expect(imageSizeFromHeader(new Uint8Array(0))).toBeNull()
    expect(imageSizeFromHeader(new Uint8Array(4))).toBeNull()
  })

  it('签名对但被截断（PNG 只有签名没有 IHDR）', () => {
    expect(imageSizeFromHeader(bytes(PNG_SIG, 12))).toBeNull()
  })

  it('尺寸为 0 的头不算有效（避免把「没读到」当成 0×0）', () => {
    expect(imageSizeFromHeader(png(0, 0))).toBeNull()
  })

  it('WebP 但块类型不认识（如 VP8X 之外的动画块）', () => {
    const b = new Uint8Array(32)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    b.set([0x41, 0x4e, 0x49, 0x4d], 12) // "ANIM"
    expect(imageSizeFromHeader(b)).toBeNull()
  })
})
