import type { Channel } from '../../../domain/project/channel'
import { protocolById, type ProtocolCatalog } from '../../../domain/project/protocol'
import type { ChannelAdapter } from '../../../platform/channels/types'
import {
  createChannelAdapter,
  type ResolvedChannelConfig,
} from '../../../platform/channels/registry'
import type { PlatformKit } from '../../../platform/ports'

/**
 * 渠道行 + 协议目录 + 明文令牌 → **执行期**的适配器配置（2026-09-30）。
 *
 * ## 为什么必须有这个函数（用户 2026-09-30 报「点生成没反应」的真根因）
 *
 * 「一站一协议」之后，渠道上存的是**协议 id**（`comfly` / `gemini` / …），
 * 适配器要按 `protocolDefinition.family` 决定用哪条链路。而这个定义**不在渠道行里**，
 * 要去协议目录（内置站点协议 + 用户自建）现查。
 *
 * 设置页那条路（`state/channel/channelStore.toSafeConfig`）查了，所以
 * 「验证地址 / 拉取模型」一切正常 —— 用户以为自己配好了；
 * 而画布执行这条路**没查**，于是 `createChannelAdapter` 拿到一个没有 `family` 的配置，
 * 走 `LEGACY_FAMILY` 也认不出 `comfly`（它只认 `mock` / `openai-images` / `openai-chat`
 * 三个老 id），最后落到 `default:` 抛 `ChannelError`：
 *
 * ```
 * ChannelError: [channel] channel
 *     at createChannelAdapter (platform/channels/registry.ts)
 *     at CanvasExecutionProvider (execution host)
 * ```
 *
 * 表现就是**点生成既不发请求、也不报错**（异常冒到宿主外，没有任何提示）——
 * 与项目里反复记录过的「点了没反应」同一类缺陷。
 *
 * 收成一个函数而不是在两处调用点各写一遍：适配器配置的形状只有一份，
 * 漏掉一个字段（正是这次）就会让一条链路失效，而这种漏在类型上**看不出来**
 * （`protocolDefinition` 是可选的）。
 */
export function resolvedChannelConfig(
  channel: Channel,
  catalog: ProtocolCatalog,
  apiKey: string | null,
): ResolvedChannelConfig {
  return {
    id: channel.id,
    protocol: channel.protocol,
    /**
     * ⚠️ 这一行是本次修复的核心：**必须按 id 去协议目录查**。
     * 缺了它，内置站点协议（`comfly` 等）的 family 解析不出来，
     * 适配器直接抛「不支持的协议」。
     */
    protocolDefinition: protocolById(channel.protocol, catalog),
    baseUrl: channel.baseUrl,
    credentialRef: channel.credentialRef,
    modelCache: channel.modelCache,
    apiKey,
  }
}

/** 组装配置 + 造适配器（执行期唯一入口） */
export function adapterForChannel(
  channel: Channel,
  catalog: ProtocolCatalog,
  apiKey: string | null,
  platform: PlatformKit,
): ChannelAdapter {
  return createChannelAdapter(resolvedChannelConfig(channel, catalog, apiKey), platform)
}
