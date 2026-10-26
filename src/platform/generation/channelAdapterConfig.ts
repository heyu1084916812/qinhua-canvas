import type { Channel } from '../../domain/project/channel'
import { protocolById, type ProtocolCatalog } from '../../domain/project/protocol'
import type { ChannelAdapter } from '../channels/types'
import {
  createChannelAdapter,
  type ResolvedChannelConfig,
} from '../channels/registry'
import type { PlatformKit } from '../ports'

/**
 * 渠道行 + 协议目录 + 明文令牌 -> 执行期适配器配置。
 *
 * 渠道只存协议 id；适配器真正需要的是目录里的 family / capabilities / versionPath。
 * 这个组装入口必须只有一份，否则设置页能验证、执行页却可能因为漏掉协议定义
 * 而直接抛“不支持的协议”。
 */
export function resolvedChannelConfig(
  channel: Channel,
  catalog: ProtocolCatalog,
  apiKey: string | null,
  altApiKey: string | null = null,
): ResolvedChannelConfig {
  return {
    id: channel.id,
    protocol: channel.protocol,
    protocolDefinition: protocolById(channel.protocol, catalog),
    baseUrl: channel.baseUrl,
    credentialRef: channel.credentialRef,
    modelCache: channel.modelCache,
    apiKey,
    altApiKey,
  }
}

/** 组装配置并创建适配器；单次调用只经过这一个入口。 */
export function adapterForChannel(
  channel: Channel,
  catalog: ProtocolCatalog,
  apiKey: string | null,
  platform: PlatformKit,
  altApiKey: string | null = null,
): ChannelAdapter {
  return createChannelAdapter(
    resolvedChannelConfig(channel, catalog, apiKey, altApiKey),
    platform,
  )
}
