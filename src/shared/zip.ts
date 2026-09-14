/**
 * 最小 ZIP 打包器（store 方式，不压缩）——零依赖、纯字节运算。
 *
 * 为什么自己写：产品文档 §10 把「不引入第三方依赖」列为红线，而「导出图片包」
 * 需要把多张 PNG 合成**一个**可下载文件——`FilePort.saveFile(name, blob)` 只有
 * 单文件出口，ZIP 是唯一自然的容器。整份实现不碰 DOM，可在单测里断言 CRC 与目录结构。
 *
 * 为什么只做 store（method 0，不压缩）：PNG 本身已压缩，再 deflate 收益极小，却要把
 * `CompressionStream` 变成异步、把一个纯函数染上平台依赖。store 版同步且纯粹，
 * 代价只是包稍大——本地单机场景完全可接受。
 *
 * 文件名一律按 UTF-8 编码并置 flag 位 11（`0x0800`）——中文目录名（如「第 1 话」）
 * 必须靠这一位才能被解压器正确识别。
 */

/** CRC32 查表（`0xEDB88320` 反射多项式），模块加载时算一次 */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC32（ZIP 用的那一种）；已知向量：`"123456789"` → `0xCBF43926` */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** 包内路径（用 `/` 分隔，可含中文）；不做去重，重名由调用方避免 */
  path: string
  bytes: Uint8Array
}

const encoder = new TextEncoder()

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff])
}

function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
/** flag 位 11：文件名与注释按 UTF-8 编码 */
const FLAG_UTF8 = 0x0800
/** 20 = 2.0，store 与 UTF-8 都够用 */
const VERSION = 20

/**
 * 把若干条目打成一个 ZIP（store，无压缩）。
 *
 * 空条目也能产出合法包（只有一份空的中央目录 + EOCD）——调用方据此可以
 * 「导出空气包」而不必特判，但业务上应在 UI 禁用无页导出。
 */
export function buildZipStore(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const crc = crc32(entry.bytes)
    const size = entry.bytes.length
    const localOffset = offset

    const header = concat([
      u32(SIG_LOCAL),
      u16(VERSION),
      u16(FLAG_UTF8),
      u16(0), // method: store
      u16(0), // 修改时间（置零：导出包不做时间语义）
      u16(0), // 修改日期
      u32(crc),
      u32(size), // 压缩后大小 = 原始大小
      u32(size),
      u16(name.length),
      u16(0), // extra 长度
    ])
    localParts.push(header, name, entry.bytes)
    offset = localOffset + header.length + name.length + size

    centralParts.push(
      concat([
        u32(SIG_CENTRAL),
        u16(VERSION), // version made by
        u16(VERSION), // version needed
        u16(FLAG_UTF8),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(size),
        u32(size),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // 起始磁盘号
        u16(0), // 内部属性
        u32(0), // 外部属性
        u32(localOffset),
      ]),
      name,
    )
  }

  const central = concat(centralParts)
  const eocd = concat([
    u32(SIG_EOCD),
    u16(0), // 本磁盘号
    u16(0), // 中央目录起始磁盘号
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0), // 注释长度
  ])

  return concat([...localParts, central, eocd])
}
