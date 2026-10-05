import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from './base64'

/**
 * 字节 ⇄ base64（对账 #221：含素材导出靠它过 JSON）。
 *
 * 判据只有一条：**每一种长度都要能原样回来** —— 分块编码（`CHUNK`）与 padding 的边界
 * 恰恰在"不是 3 的整数倍"时最容易写错，而素材字节的长度不可控。
 */
describe('bytes ⇄ base64', () => {
  it('往返一致：空 / 单字节 / 刚好整除 / 带余数 / 跨分块边界', () => {
    const sizes = [0, 1, 2, 3, 4, 5, 255, 1024, 0x8000, 0x8000 + 1, 0x8000 * 2 + 7]
    for (const size of sizes) {
      const bytes = new Uint8Array(size)
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 256
      const back = base64ToBytes(bytesToBase64(bytes))
      expect(Array.from(back)).toEqual(Array.from(bytes))
    }
  })

  it('编码结果与 btoa 的公认形态一致（能被别的工具读懂）', () => {
    expect(bytesToBase64(new Uint8Array([137, 80, 78, 71]))).toBe(btoa('\x89PNG'))
  })

  it('坏输入**抛**，不静默给空字节（导入被改坏的文件要如实报，不能写进一条"有行没图"）', () => {
    expect(() => base64ToBytes('这不是 base64')).toThrow()
  })
})
