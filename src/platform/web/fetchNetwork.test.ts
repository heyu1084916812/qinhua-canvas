import { describe, expect, it } from 'vitest'
import { requestInit } from './fetchNetwork'

/**
 * 头部合并（2026-10-01 修的真 bug）。
 *
 * 渠道层普遍会写 `Content-Type: application/json`，网络层默认也补一个
 * `content-type`。两处**大小写不同**，旧实现直接对象展开 ⇒ 两个键同时存在；
 * `fetch` 会把同名头按逗号拼起来，发出去变成
 * `application/json, application/json`，服务端判定「不是 JSON」回 400。
 * mock 渠道不走网络层，所以冒烟一直没发现。
 */
describe('requestInit · 头部合并', () => {
  it('★★ 调用方写 Content-Type 时不会与默认项重复（大小写不同也要合并）', () => {
    const { headers, body } = requestInit({
      url: 'https://x/y',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
      body: { a: 1 },
    })
    const ctKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'content-type')
    expect(ctKeys).toHaveLength(1)
    expect(headers['content-type']).toBe('application/json')
    // 其余头照常保留（键名统一小写，值不动）
    expect(headers.authorization).toBe('Bearer k')
    expect(body).toBe('{"a":1}')
  })

  it('对象体自动补 JSON 头；无 body 的 GET 不补', () => {
    expect(requestInit({ url: 'x', body: {} }).headers['content-type']).toBe('application/json')
    expect(requestInit({ url: 'x' }).headers['content-type']).toBeUndefined()
  })

  it('FormData 等原始体一律不设 Content-Type（boundary 只能由浏览器补）', () => {
    const form = new FormData()
    form.append('a', 'b')
    const { headers } = requestInit({
      url: 'x',
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: form,
    })
    expect(Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')).toBe(false)
  })
})
