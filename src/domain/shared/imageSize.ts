/**
 * 从**文件头**读图片宽高（纯函数，零 IO）。
 *
 * 背景：导入一张图要先知道真实像素（`naturalSize`）——它决定节点初始尺寸，
 * 也是日后拖动 / 复制恢复比例的依据。原先靠 `createImageBitmap(blob)`：
 * 那会把整张图**完整解码**，7MB 的图要几百毫秒，而我们要的只是头里的两个数字。
 *
 * 覆盖 PNG / JPEG / GIF / WebP 四种浏览器能显示的主流格式；读不出来（截断文件、
 * 奇怪变体、非图像）一律返回 `null`，由调用方回落到解码，绝不猜尺寸。
 */

export interface ImageSize {
  width: number
  height: number
}

/** PNG 固定签名（8 字节） */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** JPEG 的 SOF 段（帧起始）里才有尺寸；SOF4/8/12 是 DCT/无损混合，不含常规尺寸语义 */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function u16be(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1]
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
}

function u16le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8)
}

function readPng(b: Uint8Array): ImageSize | null {
  // IHDR 必须紧跟签名：长度(4) + "IHDR"(4) = 8，之后 4 字节宽、4 字节高
  if (b.length < 24) return null
  for (let i = 0; i < 8; i += 1) if (b[i] !== PNG_SIG[i]) return null
  const width = u32be(b, 16)
  const height = u32be(b, 20)
  return valid(width, height)
}

function readJpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at += 1 // 填充字节，跳过去继续找标记
      continue
    }
    const marker = b[at + 1]
    // 独立标记（无长度字段）：RSTn / EOI / TEM
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    const len = u16be(b, at + 2)
    if (len < 2) return null
    if (JPEG_SOF_MARKERS.has(marker)) {
      // 段结构：FF Cx | 长度(2) | 精度(1) | 高(2) | 宽(2)
      const height = u16be(b, at + 5)
      const width = u16be(b, at + 7)
      return valid(width, height)
    }
    if (marker === 0xda) return null // 到了扫描数据还没见到 SOF
    at += 2 + len
  }
  return null
}

function readGif(b: Uint8Array): ImageSize | null {
  // "GIF87a" / "GIF89a" 后紧跟 宽(2,LE) 高(2,LE)
  if (b.length < 10) return null
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null
  return valid(u16le(b, 6), u16le(b, 8))
}

function readWebp(b: Uint8Array): ImageSize | null {
  // RIFF....WEBP + 一个块；块头 = 四字符码(4) + 长度(4)
  if (b.length < 30) return null
  if (u32be(b, 0) !== 0x52494646 || u32be(b, 8) !== 0x57454250) return null
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15])

  if (fourcc === 'VP8X') {
    // 扩展型：24 位画布宽-1 / 高-1（小端），起点在块数据开头（偏移 24）
    const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1
    const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1
    return valid(width, height)
  }
  if (fourcc === 'VP8 ') {
    // 有损：块数据前 6 字节是帧头，之后 14 位宽 / 14 位高（各带 2 位缩放）
    if (b.length < 30) return null
    const width = u16le(b, 26) & 0x3fff
    const height = u16le(b, 28) & 0x3fff
    return valid(width, height)
  }
  if (fourcc === 'VP8L') {
    // 无损：1 字节签名后是 14 位宽-1、14 位高-1（位流，小端读 32 位）
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  return null
}

function valid(width: number, height: number): ImageSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * 读文件头里的宽高；读不出来返回 `null`（调用方应回落到解码，而不是猜）。
 */
export function imageSizeFromHeader(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 16) return null
  return readPng(bytes) ?? readJpeg(bytes) ?? readGif(bytes) ?? readWebp(bytes)
}
