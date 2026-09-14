import { describe, it, expect } from 'vitest'
import { buildZipStore, crc32, type ZipEntry } from './zip'

/** CRC32 的已知向量（RFC 1952 附录） */
describe('crc32', () => {
  it('空输入为 0', () => {
    expect(crc32(new Uint8Array([]))).toBe(0)
  })

  it('"123456789" → 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

/** 测试用 ZIP 解析器：只读 store 包（本地头 + 中央目录 + EOCD），够断言即可 */
interface ParsedEntry {
  name: string
  bytes: Uint8Array
  crc: number
  flag: number
  method: number
}
function parseZip(buf: Uint8Array): { entries: ParsedEntry[]; eocdCount: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const decoder = new TextDecoder()

  // 1) 中央目录：从 EOCD 反推偏移（EOCD 无注释时就在末尾 22 字节）
  const eocdAt = buf.length - 22
  expect(dv.getUint32(eocdAt, true)).toBe(0x06054b50)
  const eocdCount = dv.getUint16(eocdAt + 10, true)

  // 2) 顺序读本地头
  const entries: ParsedEntry[] = []
  let p = 0
  while (p + 30 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const flag = dv.getUint16(p + 6, true)
    const method = dv.getUint16(p + 8, true)
    const crc = dv.getUint32(p + 14, true)
    const size = dv.getUint32(p + 18, true)
    const nameLen = dv.getUint16(p + 26, true)
    const extraLen = dv.getUint16(p + 28, true)
    const name = decoder.decode(buf.subarray(p + 30, p + 30 + nameLen))
    const dataAt = p + 30 + nameLen + extraLen
    entries.push({ name, flag, method, crc, bytes: buf.subarray(dataAt, dataAt + size) })
    p = dataAt + size
  }
  return { entries, eocdCount }
}

const entry = (path: string, text: string): ZipEntry => ({
  path,
  bytes: new TextEncoder().encode(text),
})

describe('buildZipStore', () => {
  it('空包：只有 EOCD，条目数 0', () => {
    const buf = buildZipStore([])
    const { entries, eocdCount } = parseZip(buf)
    expect(entries).toHaveLength(0)
    expect(eocdCount).toBe(0)
  })

  it('以 PK\\x03\\x04 开头、末尾是 EOCD 签名', () => {
    const buf = buildZipStore([entry('a.png', 'A')])
    expect([...buf.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect([...buf.subarray(buf.length - 22, buf.length - 18)]).toEqual([0x50, 0x4b, 0x05, 0x06])
  })

  it('多条目：顺序、字节与 CRC 一致，EOCD 计数正确', () => {
    const entries = [entry('第 1 话/001.png', 'one'), entry('第 1 话/002-003.png', 'two-two')]
    const buf = buildZipStore(entries)
    const parsed = parseZip(buf)
    expect(parsed.eocdCount).toBe(2)
    expect(parsed.entries.map((e) => e.name)).toEqual(['第 1 话/001.png', '第 1 话/002-003.png'])
    for (let i = 0; i < entries.length; i++) {
      expect(new TextDecoder().decode(parsed.entries[i]!.bytes)).toBe(
        new TextDecoder().decode(entries[i]!.bytes),
      )
      expect(parsed.entries[i]!.crc).toBe(crc32(entries[i]!.bytes))
    }
  })

  it('中文路径置 UTF-8 flag 位（0x0800）且方法为 store', () => {
    const buf = buildZipStore([entry('漫画剧/第 1 话/001.png', 'x')])
    const { entries } = parseZip(buf)
    expect(entries[0]!.flag & 0x0800).toBe(0x0800)
    expect(entries[0]!.method).toBe(0)
  })

  it('二进制载荷（含 0x00 与高位字节）原样保留', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x7f, 0x00])
    const buf = buildZipStore([{ path: 'a.png', bytes }])
    const { entries } = parseZip(buf)
    expect([...entries[0]!.bytes]).toEqual([...bytes])
  })
})
