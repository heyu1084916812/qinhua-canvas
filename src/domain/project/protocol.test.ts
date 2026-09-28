import { describe, it, expect } from 'vitest'
import {
  BUILTIN_PROTOCOLS,
  buildProtocolCatalog,
  protocolCapabilities,
  protocolIsReady,
  protocolLabel,
  protocolRequiresBaseUrl,
  protocolShort,
  protocolSupports,
  resolveProtocolBaseUrl,
  stationProtocolForUrl,
  validateCustomProtocol,
  type CustomProtocolInput,
} from './protocol'

describe('内置协议目录', () => {
  it('每条协议都有非空 id / name / short，且 id 唯一', () => {
    const ids = new Set<string>()
    for (const p of BUILTIN_PROTOCOLS) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.short).toBeTruthy()
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
    }
  })

  it('老三条 id 原样保留：老渠道升级后不会变成未知协议', () => {
    for (const id of ['mock', 'openai-images', 'openai-chat']) {
      expect(BUILTIN_PROTOCOLS.some((p) => p.id === id)).toBe(true)
    }
  })

  it('pending 协议一律没有能力（不给半成品留假能力）', () => {
    for (const p of BUILTIN_PROTOCOLS.filter((x) => x.status === 'pending')) {
      expect(p.capabilities).toEqual([])
      expect(protocolIsReady(p.id)).toBe(false)
    }
  })

  it('ready 协议可由 registry 找到适配器族（family 非空）', () => {
    for (const p of BUILTIN_PROTOCOLS.filter((x) => x.status === 'ready')) {
      expect(p.family).toBeTruthy()
    }
  })
})

describe('buildProtocolCatalog', () => {
  it('内置在前，自建在后；id 冲突时以内置为准', () => {
    const catalog = buildProtocolCatalog([
      { id: 'mine', name: '自建', short: 'M', family: 'openai-compatible', kind: 'custom', status: 'ready', capabilities: ['chat'] },
      { id: 'yuli', name: '冒名', short: 'X', family: 'openai-compatible', kind: 'custom', status: 'ready', capabilities: ['chat'] },
    ])
    expect(catalog.all.slice(0, BUILTIN_PROTOCOLS.length).map((p) => p.id)).toEqual(
      BUILTIN_PROTOCOLS.map((p) => p.id),
    )
    // 自建 'mine' 在；冒名 'yuli' 被内置覆盖，只出现一次
    const yuli = catalog.all.filter((p) => p.id === 'yuli')
    expect(yuli).toHaveLength(1)
    expect(yuli[0]!.name).toBe('玉玉')
    expect(catalog.all.some((p) => p.id === 'mine')).toBe(true)
  })

  it('ready 只含 status === ready 的项；probe 只含 probe === true 的项', () => {
    const catalog = buildProtocolCatalog()
    expect(catalog.ready.every((p) => p.status === 'ready')).toBe(true)
    expect(catalog.probe.map((p) => p.id)).toEqual(['openai-compatible'])
  })
})

describe('能力查询', () => {
  it('未知协议给空能力集，不猜', () => {
    expect(protocolCapabilities('does-not-exist')).toEqual([])
    expect(protocolSupports('does-not-exist', 'chat')).toBe(false)
  })

  it('通用模板同时声明对话与生图（一站一渠道的口径）', () => {
    expect(protocolSupports('openai-compatible', 'chat')).toBe(true)
    expect(protocolSupports('openai-compatible', 'image')).toBe(true)
  })

  it('short / label：未知协议回落原串，不吞信息', () => {
    expect(protocolShort('openai-images')).toBe('OAI')
    expect(protocolLabel('anthropic')).toBe('anthropic')
  })

  it('requiresBaseUrl：mock 不用地址，其余都要（空地址会被 SPA 兜底页骗过）', () => {
    expect(protocolRequiresBaseUrl('mock')).toBe(false)
    expect(protocolRequiresBaseUrl('openai-compatible')).toBe(true)
    expect(protocolRequiresBaseUrl('unknown')).toBe(true)
  })

  it('目录可传给查询函数：自建协议也能查到', () => {
    const catalog = buildProtocolCatalog([
      { id: 'mine', name: '我的', short: 'M', family: 'openai-compatible', kind: 'custom', status: 'ready', capabilities: ['image'] },
    ])
    expect(protocolLabel('mine', catalog)).toBe('我的')
    expect(protocolSupports('mine', 'image', catalog)).toBe(true)
  })
})

describe('resolveProtocolBaseUrl', () => {
  it('裸 host 补一次版本段', () => {
    expect(resolveProtocolBaseUrl('https://api.openai.com', '/v1')).toBe('https://api.openai.com/v1')
  })

  it('地址已以版本段结尾则原样保留（不再拼出 /v1/v1）', () => {
    expect(resolveProtocolBaseUrl('https://api.openai.com/v1', '/v1')).toBe('https://api.openai.com/v1')
    expect(resolveProtocolBaseUrl('https://api.openai.com/v1/', '/v1')).toBe('https://api.openai.com/v1')
  })

  it('火山 Ark 的 /api/v3 不被当成 /v1 剥坏（老 normalizeBaseUrl 的洞）', () => {
    expect(resolveProtocolBaseUrl('https://ark.cn-beijing.volces.com/api/v3', '/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    )
    expect(resolveProtocolBaseUrl('https://ark.cn-beijing.volces.com', '/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    )
  })

  it('地址带了别的版本段 → 先剥旧再补新（同一 host 换协议时不会留下残留）', () => {
    expect(resolveProtocolBaseUrl('https://x.test/v1', '/api/v3')).toBe('https://x.test/api/v3')
  })

  it('空地址返回空串（调用方据此报「请先填写地址」）', () => {
    expect(resolveProtocolBaseUrl('   ', '/v1')).toBe('')
  })
})

describe('stationProtocolForUrl', () => {
  it('按 host 反查已知站点协议（路径 / 版本段 / 尾斜杠都不影响身份）', () => {
    expect(stationProtocolForUrl('https://yuli.host')?.id).toBe('yuli')
    expect(stationProtocolForUrl('https://yuli.host/v1')?.id).toBe('yuli')
    expect(stationProtocolForUrl('https://apihub.agnes-ai.com/v1')?.id).toBe('agnes')
  })

  it('未知站点返回 undefined（调用方回落通用模板）', () => {
    expect(stationProtocolForUrl('https://relay.unknown')).toBeUndefined()
    expect(stationProtocolForUrl('')).toBeUndefined()
  })

  it('pending 站点协议不参与反查（否则会命中一条跑不通的协议）', () => {
    expect(stationProtocolForUrl('https://www.runninghub.cn')).toBeUndefined()
  })
})

describe('validateCustomProtocol', () => {
  const base: CustomProtocolInput = {
    id: 'my-relay',
    name: '我的中转',
    short: 'MINE',
    capabilities: ['chat', 'image'],
  }

  it('合法输入归一成 openai-compatible / custom / ready 的定义', () => {
    const res = validateCustomProtocol(base)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toMatchObject({
        id: 'my-relay',
        family: 'openai-compatible',
        kind: 'custom',
        status: 'ready',
        capabilities: ['chat', 'image'],
      })
    }
  })

  it('id 归一为小写并去空白', () => {
    const res = validateCustomProtocol({ ...base, id: '  My-Relay  ' })
    expect(res.ok && res.value.id).toBe('my-relay')
  })

  it('拒绝非法 id / 空名称 / 空短标签 / 超长短标签', () => {
    expect(validateCustomProtocol({ ...base, id: '1' }).ok).toBe(false)
    expect(validateCustomProtocol({ ...base, id: 'bad id' }).ok).toBe(false)
    expect(validateCustomProtocol({ ...base, name: '  ' }).ok).toBe(false)
    expect(validateCustomProtocol({ ...base, short: '' }).ok).toBe(false)
    expect(validateCustomProtocol({ ...base, short: '123456789' }).ok).toBe(false)
  })

  it('拒绝与已有协议撞名', () => {
    const res = validateCustomProtocol({ ...base, id: 'yuli' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.field).toBe('id')
  })

  it('能力只收对话 / 生图：视频没有适配器，勾了也不放行', () => {
    const res = validateCustomProtocol({ ...base, capabilities: ['chat', 'video'] })
    expect(res.ok && res.value.capabilities).toEqual(['chat'])
    expect(validateCustomProtocol({ ...base, capabilities: ['video'] }).ok).toBe(false)
  })

  it('版本段必须以 / 开头；地址必须是 http(s)', () => {
    expect(validateCustomProtocol({ ...base, versionPath: 'v1' }).ok).toBe(false)
    expect(validateCustomProtocol({ ...base, baseUrl: 'relay.test' }).ok).toBe(false)
    expect(validateCustomProtocol({ ...base, baseUrl: 'https://relay.test', versionPath: '/v1' }).ok).toBe(true)
  })

  it('可选字段留空则不写进定义（不塞空串）', () => {
    const res = validateCustomProtocol(base)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect('baseUrl' in res.value).toBe(false)
      expect('versionPath' in res.value).toBe(false)
    }
  })
})
