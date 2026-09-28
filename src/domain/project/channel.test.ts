import { describe, it, expect } from 'vitest'
import {
  createChannel,
  maskTokenTail,
  OFFLINE_PROTOCOLS,
  PROBE_PROTOCOLS,
  protocolShort,
  requiresBaseUrl,
  SUPPORTED_PROTOCOLS,
  tokenTailOf,
} from './channel'
import { BUILTIN_CATALOG } from './protocol'

describe('createChannel', () => {
  it('默认未启用、无模型缓存、无凭据引用', () => {
    const ch = createChannel({ name: '默认', protocol: 'mock', baseUrl: '' })
    expect(ch.enabled).toBe(false)
    expect(ch.modelCache).toEqual([])
    expect(ch.credentialRef).toBeNull()
    expect(ch.id.startsWith('ch_')).toBe(true)
  })

  it('新建渠道不预选任何模型（§7.4 默认全部未勾选）', () => {
    const ch = createChannel({ name: 'A', protocol: 'mock', baseUrl: '' })
    expect(ch.models).toEqual([])
    expect(ch.lastTestAt).toBeNull()
    expect(ch.lastTestLatency).toBeNull()
    expect(ch.tokenTail).toBeNull()
  })

  it('排序位可由入参指定，缺省 0', () => {
    expect(createChannel({ name: 'A', protocol: 'mock', baseUrl: '' }).order).toBe(0)
    expect(createChannel({ name: 'A', protocol: 'mock', baseUrl: '', order: 7 }).order).toBe(7)
  })

  it('trim 名称与地址', () => {
    const ch = createChannel({ name: '  A  ', protocol: 'mock', baseUrl: '  https://x ' })
    expect(ch.name).toBe('A')
    expect(ch.baseUrl).toBe('https://x')
  })

  it('空名称回退为「新建渠道」', () => {
    const ch = createChannel({ name: '   ', protocol: 'mock', baseUrl: '' })
    expect(ch.name).toBe('新建渠道')
  })
})

describe('protocolShort', () => {
  it('已知协议给短标签，未知协议回落原串', () => {
    expect(protocolShort('openai-images')).toBe('OAI')
    expect(protocolShort('mock')).toBe('MOCK')
    expect(protocolShort('anthropic')).toBe('anthropic')
  })

  it('每个受支持协议都有非空短标签（新增协议时别漏）', () => {
    for (const p of SUPPORTED_PROTOCOLS) expect(p.short.length).toBeGreaterThan(0)
  })
})

describe('PROBE_PROTOCOLS（「验证协议」候选表）', () => {
  it('剔除离线协议：mock 恒成功，入选会让探测在任何地址上都命中它', () => {
    expect(PROBE_PROTOCOLS.some((p) => p.value === 'mock')).toBe(false)
    expect(OFFLINE_PROTOCOLS).toContain('mock')
  })

  it('只含通用模板（probe: true）：站点协议是手选入口，不进探测序列', () => {
    // 探测要回答的只是「这个地址是不是 OpenAI 兼容 HTTP」；把十几个站点协议放进候选表
    // 会让探测连打十几个请求，而且同一个 200 被多条协议同时命中（M6-16 的根因）。
    expect(PROBE_PROTOCOLS.map((p) => p.value)).toEqual(BUILTIN_CATALOG.probe.map((p) => p.id))
    for (const p of PROBE_PROTOCOLS) {
      const def = BUILTIN_CATALOG.all.find((d) => d.id === p.value)!
      // 站点身份交给 stationProtocolForUrl 按 host 反查，候选表里只留 public 模板。
      expect(def.kind).toBe('public')
      expect(def.probe).toBe(true)
    }
  })

  it('保持下拉表原顺序（探测顺序 = 用户心里的协议优先级）', () => {
    const idx = PROBE_PROTOCOLS.map((p) => SUPPORTED_PROTOCOLS.findIndex((s) => s.value === p.value))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
  })

  it('至少留一个可探测协议，否则「验证协议」按钮永远是空转', () => {
    expect(PROBE_PROTOCOLS.length).toBeGreaterThan(0)
  })
})

describe('requiresBaseUrl（地址为空时能不能验）', () => {
  it('离线协议不需要地址（不发请求）', () => {
    expect(requiresBaseUrl('mock')).toBe(false)
  })

  it('真实协议必须填地址——空地址会退化成相对当前页的路径，被 SPA 的 200 兜底页骗过', () => {
    expect(requiresBaseUrl('openai-images')).toBe(true)
    expect(requiresBaseUrl('anthropic')).toBe(true)
  })

  it('与候选表口径一致：能探测的协议都需要地址', () => {
    for (const p of PROBE_PROTOCOLS) expect(requiresBaseUrl(p.value)).toBe(true)
  })
})

describe('tokenTailOf / maskTokenTail', () => {
  it('够长的令牌取尾 4 位', () => {
    expect(tokenTailOf('sk-1234567890abcdef3f2a')).toBe('3f2a')
  })

  it('太短的令牌不给尾号——4 位就占了小半个密钥', () => {
    expect(tokenTailOf('sk-1234567')).toBeNull()
    expect(tokenTailOf('')).toBeNull()
    expect(tokenTailOf('   ')).toBeNull()
  })

  it('尾号去空白后再判长度', () => {
    expect(tokenTailOf('  sk-1234567890abcd  ')).toBe('abcd')
  })

  it('无尾号不渲染半个遮罩', () => {
    expect(maskTokenTail(null)).toBe('')
    expect(maskTokenTail('3f2a')).toBe('••••••••3f2a')
  })
})
