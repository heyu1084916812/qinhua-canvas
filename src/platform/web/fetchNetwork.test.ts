import { describe, expect, it } from 'vitest'
import { requestInit } from './fetchNetwork'
import { createFetchNetwork } from './fetchNetwork'

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

/**
 * 对账 #518：中转站不给 `Access-Control-Allow-Origin` 时的跨域回落。
 *
 * 壳里的 webview 与浏览器是同一份 `fetch` 实现、同样受 CORS 限制 —— 服务端明明 200，
 * 页面侧却只拿到一个"网络错误"。于是「验证协议」报「连不上这个地址（域名解析失败或
 * 连接被拒绝）」，把用户往"地址填错了"的方向带；而别的客户端（cc switch / workbuddy）
 * 不走浏览器，同一个地址用得好好的。
 */
describe('createFetchNetwork · 跨域回落（对账 #518）', () => {
  const abort = () => new AbortController().signal

  it('★★ 页面请求被跨域拦下时，改用壳的原生 HTTP 再打一次并成功', async () => {
    const seen: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = []
    const network = createFetchNetwork({
      request: async (req) => {
        seen.push(req)
        return { status: 200, headers: { 'content-type': 'application/json' }, text: '{"data":[]}' }
      },
    })
    /**
     * 造"浏览器这一层过不去"：把 window.fetch 换成直接抛 TypeError，
     * 这正是 CORS 被拦时 fetch 的行为（网络层会把它归成 `network/dns`）。
     */
    const original = globalThis.fetch
    globalThis.fetch = (() => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    try {
      const res = await network.request(
        {
          url: 'http://154.19.242.25:7863/v1/models',
          headers: { Authorization: 'Bearer 431959*Sh' },
        },
        abort(),
      )
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ data: [] })
      /* 回落要把原样的地址、鉴权头带过去，否则等于换了一个请求 */
      expect(seen).toHaveLength(1)
      expect(seen[0]!.url).toBe('http://154.19.242.25:7863/v1/models')
      expect(seen[0]!.headers?.authorization).toBe('Bearer 431959*Sh')
    } finally {
      globalThis.fetch = original
    }
  })

  it('★★ HTTP 状态码失败**不**回落（服务端真回答了，换条路也是同一个答复）', async () => {
    let shellCalls = 0
    const network = createFetchNetwork({
      request: async () => {
        shellCalls += 1
        return { status: 401, headers: {}, text: 'nope' }
      },
    })
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
    try {
      await expect(network.request({ url: 'http://x/y' }, abort())).rejects.toMatchObject({
        kind: 'http',
        status: 401,
      })
      expect(shellCalls).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })

  it('★ 没有壳能力时（浏览器）行为照旧：失败即如实抛出，不假装成功', async () => {
    const network = createFetchNetwork()
    const original = globalThis.fetch
    globalThis.fetch = (() => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    try {
      await expect(network.request({ url: 'http://x/y' }, abort())).rejects.toMatchObject({
        kind: 'network',
      })
    } finally {
      globalThis.fetch = original
    }
  })

  it('★ 壳那条路也失败时，如实抛出壳的错误（不退回原错误、不静默）', async () => {
    const network = createFetchNetwork({
      request: async () => {
        throw { kind: 'http', status: 502, body: 'bad gateway' }
      },
    })
    const original = globalThis.fetch
    globalThis.fetch = (() => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    try {
      await expect(network.request({ url: 'http://x/y' }, abort())).rejects.toMatchObject({
        kind: 'http',
        status: 502,
      })
    } finally {
      globalThis.fetch = original
    }
  })
})
