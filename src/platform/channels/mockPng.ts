import { crc32 } from '../../shared/zip'

/**
 * 单色 PNG 编码器（**真可解码**，尺寸由调用方指定）。
 *
 * 为什么需要：mock 渠道此前一律吐 8×8 的图。产物尺寸一旦与实际请求无关，
 * 「节点是否按产物真实比例呈现」在离线环境里就**根本无法断言**——
 * 8×8 是 1:1，任何比例错误都会退化成同一个数字。这与早先「假字节 + 真 mime」
 * 是同一类教训：**假数据的保真度决定了断言的上限**。
 *
 * 实现刻意保持最小：只出 8bit truecolor、不压缩（deflate 的 stored 块），
 * 于是既不需要 zlib 依赖、也不必处理压缩级别；代价是字节略大，对 mock 无所谓。
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function be32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]!) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** zlib 头 + 若干 stored 块 + adler32（RFC 1950 / 1951） */
function zlibStored(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01]
  const MAX = 0xffff
  for (let i = 0; i < raw.length; i += MAX) {
    const chunk = raw.subarray(i, Math.min(i + MAX, raw.length))
    const last = i + MAX >= raw.length
    out.push(last ? 0x01 : 0x00, chunk.length & 0xff, (chunk.length >>> 8) & 0xff)
    out.push(~chunk.length & 0xff, (~chunk.length >>> 8) & 0xff)
    for (const byte of chunk) out.push(byte)
  }
  const sum = adler32(raw)
  out.push(...be32(sum))
  return new Uint8Array(out)
}

function chunk(type: string, data: number[]): number[] {
  const head = [...type].map((c) => c.charCodeAt(0))
  const body = [...head, ...data]
  return [...be32(data.length), ...body, ...be32(crc32(new Uint8Array(body)))]
}

/**
 * 生成一张纯色 PNG。
 *
 * 逐行以 filter=0 编码（每行前置一个 0 字节），这是 PNG 解码器必支持的路径。
 */
export function solidPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Uint8Array {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const raw = new Uint8Array(h * (1 + w * 3))
  let p = 0
  for (let y = 0; y < h; y += 1) {
    raw[p++] = 0 // filter: None
    for (let x = 0; x < w; x += 1) {
      raw[p++] = rgb[0]
      raw[p++] = rgb[1]
      raw[p++] = rgb[2]
    }
  }
  const ihdr = [
    ...be32(w),
    ...be32(h),
    8, // bit depth
    2, // color type: truecolor
    0, // compression: deflate
    0, // filter method
    0, // interlace: none
  ]
  return new Uint8Array([
    ...SIGNATURE,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', [...zlibStored(raw)]),
    ...chunk('IEND', []),
  ])
}
