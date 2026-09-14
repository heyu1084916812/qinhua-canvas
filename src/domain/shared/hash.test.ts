import { describe, it, expect } from 'vitest'
import { sha1Hex, sha1Bytes, fingerprintHex, fingerprintBytes } from './hash'

describe('sha1', () => {
  it('匹配已知向量', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('长输入跨 512 位分组', () => {
    const input = 'a'.repeat(1000)
    expect(sha1Hex(input)).toHaveLength(40)
    expect(sha1Hex(input)).not.toBe(sha1Hex('a'.repeat(999)))
  })

  it('字节与字符串结果一致', () => {
    const bytes = new TextEncoder().encode('轻画 qinghua')
    expect(sha1Bytes(bytes)).toBe(sha1Hex('轻画 qinghua'))
  })

  it('fingerprint 截断到 16 个 hex 字符', () => {
    expect(fingerprintHex('node-1')).toHaveLength(16)
  })

  it('相同输入稳定，不同输入不同', () => {
    expect(fingerprintHex('x')).toBe(fingerprintHex('x'))
    expect(fingerprintHex('x')).not.toBe(fingerprintHex('y'))
  })
})

describe('fingerprintBytes（异步内容指纹）', () => {
  /**
   * 这条是**迁移安全网**：无论当前环境有没有 `crypto.subtle`，
   * 异步路径与纯 JS 路径必须给出同一个 id。hash 是 assets 表的主键，
   * 两条路径算出不同值 = 同一张图存出两行 = 内容寻址失效。
   */
  it('与纯 JS 同步实现同值（sha1 截 16 hex）', async () => {
    const cases = [
      new Uint8Array(0),
      new TextEncoder().encode('abc'),
      new TextEncoder().encode('轻画 qinghua'),
      Uint8Array.from({ length: 5000 }, (_, i) => i % 251),
    ]
    for (const bytes of cases) {
      expect(await fingerprintBytes(bytes)).toBe(sha1Bytes(bytes).slice(0, 16))
    }
  })

  it('固定向量：sha1("abc") 前 16 位', async () => {
    expect(await fingerprintBytes(new TextEncoder().encode('abc'))).toBe('a9993e364706816a')
  })

  it('视图只是底层 buffer 的一段时，只哈希这一段（不把相邻字节算进去）', async () => {
    const whole = Uint8Array.from({ length: 100 }, (_, i) => (i < 20 ? 7 : 3))
    const head = whole.subarray(0, 20)
    expect(await fingerprintBytes(head)).toBe(sha1Bytes(head).slice(0, 16))
    expect(await fingerprintBytes(head)).not.toBe(await fingerprintBytes(whole))
  })
})
