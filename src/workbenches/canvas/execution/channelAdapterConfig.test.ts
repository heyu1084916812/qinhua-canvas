import { describe, expect, it } from 'vitest'
import type { Channel } from '../../../domain/project/channel'
import {
  BUILTIN_CATALOG,
  buildProtocolCatalog,
  type ProtocolDefinition,
} from '../../../domain/project/protocol'
import { createMemoryPlatform } from '../../../platform/memory'
import { createChannelAdapter } from '../../../platform/channels/registry'
import { adapterForChannel, resolvedChannelConfig } from './channelAdapterConfig'

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: 'ch_1',
    name: 'Comfy-gpt',
    protocol: 'comfly',
    baseUrl: 'https://ai.comfly.org',
    credentialRef: 'cred_1',
    tokenTail: '5qGh',
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
  } as Channel
}

/**
 * 回归：用户 2026-09-30 报「新建节点点生成没反应」。
 *
 * 真根因是执行期组装适配器配置时**漏掉了 `protocolDefinition`**，于是内置站点协议
 * （`comfly` / `gemini` / …）解析不出 family ⇒ `createChannelAdapter` 抛
 * `ChannelError: [channel] channel` ⇒ 既不发请求也没有任何提示。
 *
 * 设置页那条路（`channelStore.toSafeConfig`）一直都查了目录，所以
 * 「验证地址 / 拉取模型」全绿、用户以为自己配好了 —— 这类「一边缺字段、一边正常」
 * 的缺口在类型上看不出来（`protocolDefinition` 是可选的），只能靠断言钉住。
 */
describe('执行期渠道适配器配置', () => {
  it('★★ 内置站点协议（comfly）要查出协议定义 —— 少了它适配器直接抛错', () => {
    const cfg = resolvedChannelConfig(channel(), BUILTIN_CATALOG, 'sk-test')
    expect(cfg.protocolDefinition?.id).toBe('comfly')
    expect(cfg.protocolDefinition?.family).toBe('openai-compatible')
    // 「造得出适配器」才是这条链路真的能跑的定义（用户报的正是卡在这一步）
    expect(() => createChannelAdapter(cfg, createMemoryPlatform())).not.toThrow()
  })

  it('★ 反向断言：没有协议定义时就是用户看到的那个失败形态', () => {
    const cfg = resolvedChannelConfig(channel(), BUILTIN_CATALOG, 'sk-test')
    expect(() =>
      createChannelAdapter({ ...cfg, protocolDefinition: undefined }, createMemoryPlatform()),
    ).toThrow(/channel/)
  })

  it('老协议 id（mock / openai-images / openai-chat）仍然认', () => {
    for (const [protocol, family] of [
      ['openai-images', 'openai-compatible'],
      ['openai-chat', 'openai-compatible'],
    ] as const) {
      const cfg = resolvedChannelConfig(channel({ protocol }), BUILTIN_CATALOG, 'k')
      expect(cfg.protocolDefinition?.family, protocol).toBe(family)
      expect(() => createChannelAdapter(cfg, createMemoryPlatform()), protocol).not.toThrow()
    }
    expect(adapterForChannel(channel({ protocol: 'mock' }), BUILTIN_CATALOG, null, createMemoryPlatform()).protocol).toBe(
      'mock',
    )
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

  it('★ 未知协议照样如实报错（不静默退回原名或换链路）', () => {
    const cfg = resolvedChannelConfig(channel({ protocol: 'no-such-protocol' }), BUILTIN_CATALOG, 'k')
    expect(cfg.protocolDefinition).toBeUndefined()
    expect(() => createChannelAdapter(cfg, createMemoryPlatform())).toThrow(/channel/)
  })
})
