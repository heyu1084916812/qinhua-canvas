import { describe, expect, it } from 'vitest'
import type { Channel } from '../../domain/project/channel'
import {
  BUILTIN_CATALOG,
  buildProtocolCatalog,
  type ProtocolDefinition,
} from '../../domain/project/protocol'
import { createMemoryPlatform } from '../memory'
import { createChannelAdapter } from '../channels/registry'
import { adapterForChannel, resolvedChannelConfig } from './channelAdapterConfig'

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: 'ch_1',
    name: 'Comfy-gpt',
    icon: null,
    protocol: 'comfly',
    baseUrl: 'https://ai.comfly.org',
    credentialRef: 'cred_1',
    tokenTail: '5qGh',
    hasToken: true,
    altCredentialRef: null,
    altTokenTail: null,
    hasAltToken: false,
    credentialGroups: [],
    enabled: true,
    models: [],
    modelCache: [],
    modelMap: {},
    priority: 0,
    weight: 0,
    routeStrategy: 'priority',
    order: 0,
    lastTestAt: null,
    lastTestLatency: null,
    createdAt: 0,
    ...over,
  }
}

describe('执行期渠道适配器配置', () => {
  it('内置站点协议要查出协议定义，否则适配器直接抛错', () => {
    const cfg = resolvedChannelConfig(channel(), BUILTIN_CATALOG, 'sk-test')
    expect(cfg.protocolDefinition?.id).toBe('comfly')
    expect(cfg.protocolDefinition?.family).toBe('openai-compatible')
    expect(cfg.altApiKey).toBeNull()
    expect(() => createChannelAdapter(cfg, createMemoryPlatform())).not.toThrow()
  })

  it('第二把 Key 随执行配置传给 65535 合并协议', () => {
    const cfg = resolvedChannelConfig(
      channel({ protocol: '65535', baseUrl: 'https://api2.65535.space' }),
      BUILTIN_CATALOG,
      'chat-key',
      'image-key',
    )
    expect(cfg.protocolDefinition?.capabilities).toEqual(['chat', 'image'])
    expect(cfg.apiKey).toBe('chat-key')
    expect(cfg.altApiKey).toBe('image-key')
    expect(() => createChannelAdapter(cfg, createMemoryPlatform())).not.toThrow()
  })

  it('没有协议定义时如实失败，不静默退回原名或换链路', () => {
    const cfg = resolvedChannelConfig(channel(), BUILTIN_CATALOG, 'sk-test')
    expect(() =>
      createChannelAdapter({ ...cfg, protocolDefinition: undefined }, createMemoryPlatform()),
    ).toThrow(/channel/)
  })

  it('老协议 id 仍然能解析到同一个兼容族', () => {
    for (const [protocol, family] of [
      ['openai-images', 'openai-compatible'],
      ['openai-chat', 'openai-compatible'],
    ] as const) {
      const cfg = resolvedChannelConfig(channel({ protocol }), BUILTIN_CATALOG, 'k')
      expect(cfg.protocolDefinition?.family, protocol).toBe(family)
      expect(() => createChannelAdapter(cfg, createMemoryPlatform()), protocol).not.toThrow()
    }
    expect(
      adapterForChannel(
        channel({ protocol: 'mock' }),
        BUILTIN_CATALOG,
        null,
        createMemoryPlatform(),
      ).protocol,
    ).toBe('mock')
  })

  it('用户自建协议走同一个目录也能解析', () => {
    const custom = {
      id: 'my-station',
      name: '我的中转',
      short: 'MINE',
      family: 'openai-compatible',
      kind: 'station',
      status: 'ready',
      capabilities: ['image'],
      defaultBaseUrl: 'https://example.com',
      versionPath: '/v1',
    } as ProtocolDefinition
    const cfg = resolvedChannelConfig(
      channel({ protocol: 'my-station' }),
      buildProtocolCatalog([custom]),
      'k',
    )
    expect(cfg.protocolDefinition?.family).toBe('openai-compatible')
    expect(() => createChannelAdapter(cfg, createMemoryPlatform())).not.toThrow()
  })

  it('未知协议照样如实报错', () => {
    const cfg = resolvedChannelConfig(
      channel({ protocol: 'no-such-protocol' }),
      BUILTIN_CATALOG,
      'k',
    )
    expect(cfg.protocolDefinition).toBeUndefined()
    expect(() => createChannelAdapter(cfg, createMemoryPlatform())).toThrow(/channel/)
  })
})
