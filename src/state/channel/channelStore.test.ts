import { describe, it, expect } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { NetworkRequest, NetworkResponse } from '../../platform/ports'
import { createChannelStore } from './channelStore'

/** 可编程网络响应：探测用例要能分别构造「这台机器支持该协议 / 不支持」两种现实 */
function jsonResponse(status: number, body: unknown): NetworkResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    status,
    headers: {},
    async text() {
      return text
    },
    async json<T = unknown>() {
      return JSON.parse(text) as T
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer as ArrayBuffer
    },
  }
}

describe('channelStore', () => {
  it('create / saveToken / verify 只测通不通，不顺手刷模型缓存', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)

    await store.load()
    expect(store.getState().channels).toHaveLength(0)

    const ch = await store.create({ name: 'Mock', protocol: 'mock', baseUrl: '' })
    expect(store.getState().channels).toHaveLength(1)

    await store.saveToken(ch.id, 'sk')
    expect(await store.hasToken(ch.id)).toBe(true)

    await store.verify(ch.id)
    const updated = store.getState().channels.find((c) => c.id === ch.id)!
    // §7.3：验证只回答「地址通不通」。地址通不通与「这台机器上有些什么模型」是两件事，
    // 把后者塞进前者，会让用户按一次验证就收到一份他没要的缓存。
    expect(updated.modelCache).toEqual([])
    expect(updated.lastTestAt).toBeGreaterThan(0)
    expect(store.getState().verify.status).toBe('ok')
  })

  it('enabledChannels 只返回启用的', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const a = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.create({ name: 'B', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(a.id, true)
    expect(store.enabledChannels().map((c) => c.id)).toEqual([a.id])
  })

  it('remove 后列表更新', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const a = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    expect(store.getState().channels).toHaveLength(1)
    await store.remove(a.id)
    expect(store.getState().channels).toHaveLength(0)
  })

  it('verify 不写 modelCache、也不替用户勾选 models（§7.3 只管通不通 / §7.4 默认未勾选）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const ch = await store.create({ name: 'Mock', protocol: 'mock', baseUrl: '' })
    await store.verify(ch.id)
    const updated = store.getState().channels.find((c) => c.id === ch.id)!
    expect(updated.modelCache).toEqual([])
    expect(updated.models).toEqual([])
  })

  it('refreshModels 才写 modelCache，并把数量带给状态行', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const ch = await store.create({ name: 'Mock', protocol: 'mock', baseUrl: '' })
    await store.refreshModels(ch.id)
    const updated = store.getState().channels.find((c) => c.id === ch.id)!
    expect(updated.modelCache.length).toBeGreaterThan(0)
    expect(store.getState().models).toMatchObject({ status: 'ok' })
    // 拉取 ≠ 勾选：缓存回来了，`models` 依旧空着等用户挑。
    expect(updated.models).toEqual([])
  })

  it('detectProtocol：命中候选协议并写回 protocol（探测即替用户填对下拉那一格）', async () => {
    const p = createMemoryPlatform({
      handler: async (req: NetworkRequest) =>
        req.url.endsWith('/v1/models')
          ? jsonResponse(200, { data: [{ id: 'gpt-image-2' }] })
          : jsonResponse(404, ''),
    })
    const store = createChannelStore(p)
    const ch = await store.create({ name: '中继', protocol: 'mock', baseUrl: 'https://relay.test' })

    const hit = await store.detectProtocol(ch.id)

    expect(hit).toBe('openai-images')
    const updated = store.getState().channels.find((c) => c.id === ch.id)!
    expect(updated.protocol).toBe('openai-images')
    // 与「验证地址」共用同一份「上次往返」记录。
    expect(updated.lastTestAt).toBeGreaterThan(0)
    expect(store.getState().detect).toMatchObject({ status: 'ok', protocol: 'openai-images' })
  })

  it('detectProtocol：候选表不含离线协议——探测不会「自己选中自己」', async () => {
    // 请求全部失败（404）。若候选表里混进了恒成功的离线协议，这里会命中它并谎报成功。
    const p = createMemoryPlatform({ handler: async () => jsonResponse(404, '') })
    const store = createChannelStore(p)
    const ch = await store.create({ name: '中继', protocol: 'mock', baseUrl: 'https://relay.test' })

    const hit = await store.detectProtocol(ch.id)

    expect(hit).toBeNull()
    expect(store.getState().channels.find((c) => c.id === ch.id)!.protocol).toBe('mock')
    const detect = store.getState().detect
    expect(detect.status).toBe('error')
    expect(detect.protocol).toBeNull()
    expect(detect.message).toBeTruthy()
  })

  it('detectProtocol 不写模型缓存（探测协议 ≠ 拉模型）', async () => {
    const p = createMemoryPlatform({
      handler: async (req: NetworkRequest) =>
        req.url.endsWith('/v1/models')
          ? jsonResponse(200, { data: [{ id: 'gpt-image-2' }] })
          : jsonResponse(404, ''),
    })
    const store = createChannelStore(p)
    const ch = await store.create({ name: '中继', protocol: 'mock', baseUrl: 'https://relay.test' })
    await store.detectProtocol(ch.id)
    expect(store.getState().channels.find((c) => c.id === ch.id)!.modelCache).toEqual([])
  })

  it('verify：真实协议 + 空地址 → 直接报「请先填写地址」，一个请求都不发', async () => {
    const sent: string[] = []
    const p = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        sent.push(req.url)
        return jsonResponse(200, '')
      },
    })
    const store = createChannelStore(p)
    const ch = await store.create({ name: '空地址', protocol: 'openai-images', baseUrl: '' })

    await store.verify(ch.id)

    expect(store.getState().verify.status).toBe('error')
    expect(store.getState().verify.message).toContain('地址')
    // 关键在「不发」：空地址会让 URL 退化成相对当前页的路径，被 SPA 的 200 兜底页判成「通了」。
    expect(sent).toEqual([])
  })

  it('detectProtocol：地址为空 → 报「请先填写地址再验证协议」，一个请求都不发', async () => {
    const sent: string[] = []
    const p = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        sent.push(req.url)
        return jsonResponse(200, '')
      },
    })
    const store = createChannelStore(p)
    const ch = await store.create({ name: '空地址', protocol: 'openai-images', baseUrl: '' })

    const hit = await store.detectProtocol(ch.id)

    expect(hit).toBeNull()
    expect(store.getState().detect.status).toBe('error')
    expect(store.getState().detect.message).toContain('地址')
    expect(sent).toEqual([])
  })

  it('verify 记录 lastTestAt / lastTestLatency，并把延迟带给状态行', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const ch = await store.create({ name: 'Mock', protocol: 'mock', baseUrl: '' })
    await store.verify(ch.id)
    const updated = store.getState().channels.find((c) => c.id === ch.id)!
    expect(updated.lastTestAt).toBeGreaterThan(0)
    expect(updated.lastTestLatency).toBeGreaterThanOrEqual(0)
    expect(store.getState().verify.latency).toBeGreaterThanOrEqual(0)
  })

  it('saveToken 记尾号；removeToken 清尾号且渠道仍在', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.saveToken(ch.id, 'sk-1234567890abcdef3f2a')
    expect(store.getState().channels.find((c) => c.id === ch.id)!.tokenTail).toBe('3f2a')
    expect(await store.hasToken(ch.id)).toBe(true)

    await store.removeToken(ch.id)
    expect(store.getState().channels.find((c) => c.id === ch.id)!.tokenTail).toBeNull()
    expect(await store.hasToken(ch.id)).toBe(false)
    expect(store.getState().channels).toHaveLength(1)
  })

  it('太短的令牌不给尾号（不显示半个遮罩）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.saveToken(ch.id, 'sk-short')
    expect(store.getState().channels.find((c) => c.id === ch.id)!.tokenTail).toBeNull()
    expect(await store.hasToken(ch.id)).toBe(true)
  })

  it('setModels 落库并更新列表；reorder 重编号', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const a = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    const b = await store.create({ name: 'B', protocol: 'mock', baseUrl: '' })
    const pick = [{ id: 'mock-image-1', category: 'image' as const, inputTypes: ['text' as const] }]
    await store.setModels(a.id, pick)
    expect(store.getState().channels.find((c) => c.id === a.id)!.models).toEqual(pick)

    await store.reorder([b.id, a.id])
    expect(store.getState().channels.map((c) => c.name)).toEqual(['B', 'A'])
  })
})
