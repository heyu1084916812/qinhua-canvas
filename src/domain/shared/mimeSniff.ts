/**
 * 从**字节魔数**认媒体类型（纯函数，零 IO）。
 *
 * 为什么需要它：本机 CLI 的产物是我们按扩展名"点"出来的文件
 * （`{out}` 换成 `xxx.png`），但**写什么格式是那个 CLI 决定的** ——
 * 它可能忽略后缀写了 JPEG，也可能永远只吐 MP4。跟着扩展名走会出现
 * "存成 image/png 的其实是个 JPEG"，界面上就是一张裂图，而日志里看不出原因。
 *
 * 所以口径是：**先认字节，认不出才回落扩展名**（回落交给调用方，这里只回 `null`）。
 *
 * 只覆盖产物真会出现的几种：PNG / JPEG / GIF / WebP / MP4 / WebM。
 * 认不出来不是错误 —— 有些格式的魔数不在前几个字节，硬猜比 `null` 更糟。
 */

function ascii(b: Uint8Array, at: number, text: string): boolean {
  if (b.length < at + text.length) return false
  for (let i = 0; i < text.length; i += 1) {
    if (b[at + i] !== text.charCodeAt(i)) return false
  }
  return true
}

export function sniffMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null
  // PNG：89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG：FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  // GIF：GIF87a / GIF89a
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif'
  // WebP：RIFF....WEBP
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp'
  // MP4 / MOV 系：偏移 4 起是 ftyp（`isom` / `mp42` / `qt  ` 等）
  if (ascii(bytes, 4, 'ftyp')) return 'video/mp4'
  // WebM / Matroska：EBML 头 1A 45 DF A3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm'
  }
  return null
}
