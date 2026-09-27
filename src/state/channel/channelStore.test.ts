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

  it('★ setModelMapping 写入映射；传空串即删除该条（回到恒等，不存空串）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })

    await store.setModelMapping(ch.id, 'image-2', 'gpt-image-2')
    expect(store.getState().channels.find((c) => c.id === ch.id)!.modelMap).toEqual({
      'image-2': 'gpt-image-2',
    })

    await store.setModelMapping(ch.id, 'image-2', '   ')
    expect(store.getState().channels.find((c) => c.id === ch.id)!.modelMap).toEqual({})
  })

  it('★ setRouteTuning：优先度取整、权重取整且不为负（档位靠相等比较，小数会分出无数档）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })

    await store.setRouteTuning(ch.id, { priority: 7.9, weight: 3 })
    let cur = store.getState().channels.find((c) => c.id === ch.id)!
    expect(cur.priority).toBe(7)
    expect(cur.weight).toBe(3)

    await store.setRouteTuning(ch.id, { weight: -5 })
    cur = store.getState().channels.find((c) => c.id === ch.id)!
    expect(cur.weight).toBe(0)
    // 没传的字段保持不动（patch 语义，不该被默认值抹掉）
    expect(cur.priority).toBe(7)
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

  /**
   * 生成配方（新建节点默认渠道 + 模型 + 参数，2026-09-18 定稿为**按渠道记忆**）。
   *
   * 两条规则：
   * - 该渠道**没记过** → 第一个可用渠道的第一个模型
   * - 该渠道**记过** → 上一次生成用的那套（模型 + 参数）
   */
  it('★ 没记过 → 取第一个渠道的第一个模型（而不是留空）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch.id, true)
    await store.setModels(ch.id, [{ id: 'model-a', category: 'image', inputTypes: ['text'] }])

    expect(await store.defaultForNewNode({})).toEqual({
      channelId: ch.id,
      model: 'model-a',
      params: {},
      substituted: true,
    })
  })

  it('★ 记过 → 用记录的那套（含参数），并且立刻生效（不等刷新）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch.id, true)
    await store.setModels(ch.id, [{ id: 'model-a', category: 'image', inputTypes: ['text'] }])

    await store.rememberRecipe(ch.id, 'model-a', { ratio: '16:9', count: 4 })
    expect(await store.defaultForNewNode({})).toEqual({
      channelId: ch.id,
      model: 'model-a',
      params: { ratio: '16:9', count: 4 },
      substituted: false,
    })
  })

  /**
   * ★ 配方按**渠道**隔离（2026-09-18 晚收口）。
   *
   * 本项目统一走渠道，参照项目「按执行模式分桶」的那层在这里等价于渠道层：
   * 两条渠道各记各的，A 渠道选的模型不该跑到 B 渠道去。
   */
  it('★ 配方按渠道隔离：一条渠道的记录不影响另一条', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch.id, true)
    await store.setModels(ch.id, [
      { id: 'model-a', category: 'image', inputTypes: ['text'] },
      { id: 'model-b', category: 'image', inputTypes: ['text'] },
    ])
    const ch2 = await store.create({ name: 'B', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch2.id, true)
    await store.setModels(ch2.id, [{ id: 'other-a', category: 'image', inputTypes: ['text'] }])

    await store.rememberRecipe(ch.id, 'model-b', { ratio: '16:9' })

    // A 渠道用记录的那套
    expect((await store.defaultForNewNode({ channelId: ch.id }))?.model).toBe('model-b')
    // B 渠道没记录 → 落回它自己的第一个模型（不是 A 渠道的 model-b）
    expect(await store.defaultForNewNode({ channelId: ch2.id })).toEqual({
      channelId: ch2.id,
      model: 'other-a',
      params: {},
      substituted: true,
    })
  })

  /**
   * ★ 节点自身带齐渠道 + 模型 → 原样保留。
   * 这是面板兜底**不能**抢用户选择的那条边界。
   */
  it('★ 节点自身带渠道 + 模型 → 原样保留（不替换、不覆盖）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch.id, true)
    await store.setModels(ch.id, [
      { id: 'model-a', category: 'image', inputTypes: ['text'] },
      { id: 'model-b', category: 'image', inputTypes: ['text'] },
    ])

    expect(await store.defaultForNewNode({ channelId: ch.id, model: 'model-b' })).toEqual({
      channelId: ch.id,
      model: 'model-b',
      params: {},
      substituted: false,
    })
  })

  it('配方里的模型已不在该渠道 → 兜底该渠道第一个模型，参数仍沿用', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch.id, true)
    await store.setModels(ch.id, [{ id: 'still-here', category: 'image', inputTypes: ['text'] }])
    await store.rememberRecipe(ch.id, 'gone-away', { quality: 'high' })
    expect(await store.defaultForNewNode({ channelId: ch.id })).toEqual({
      channelId: ch.id,
      model: 'still-here',
      params: { quality: 'high' },
      substituted: true,
    })
  })

  it('只选了渠道、还没选模型 → 不记配方；渠道又没勾模型时确实没有默认值', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch.id, true)
    await store.rememberRecipe(ch.id, '', {})
    expect(await store.defaultForNewNode({ channelId: ch.id })).toBeNull()
  })

  it('渠道**未启用**时不参与默认（否则一点生成就报「平台未启用」）', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setModels(ch.id, [{ id: 'm', category: 'image', inputTypes: ['text'] }])
    // 刻意不 setEnabled
    expect(await store.defaultForNewNode({})).toBeNull()
  })

  /**
   * 提示词节点要的是**文本模型**（用户 2026-09-18：「提示词节点也一样」）。
   * 生成配方里存的是图片模型，对文本节点不适用，故按类别重新挑。
   */
  /**
   * 用户 2026-09-27 第 8 轮：提示词节点默认显示**固定清单的第一个对话名**
   * （`GPT-6 Astra`），不再是渠道里排第一的那个文本模型
   * （实测那个是 `advanced-voice`，与创作无关）。
   *
   * 条件是**这个渠道确实有对话模型** —— 否则不该硬塞一个固定名进去。
   */
  it('★ 传 category=chat 时默认取固定清单第一个（GPT-6 Astra），且要求渠道真有对话模型', async () => {
    const p = createMemoryPlatform()
    const store = createChannelStore(p)
    await store.load()
    const ch = await store.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await store.setEnabled(ch.id, true)
    await store.setModels(ch.id, [
      { id: 'img-1', category: 'image', inputTypes: ['text'] },
      { id: 'chat-1', category: 'chat', inputTypes: ['text'] },
    ])
    const picked = await store.defaultForNewNode({}, 'chat')
    expect(picked?.model).toBe('GPT-6 Astra')
  })
})
