import type { SafeChannelConfig } from '../ports'
import { ChannelError, type ChannelAdapter, type ChannelDeps } from './types'
import { createMockChannel } from './mock'
import { createOpenAiChatAdapter } from './openaiChat'
import { createOpenAiImagesAdapter } from './openaiImages'

/** 调用前由凭据层注入明文令牌的渠道配置（业务代码与 UI 全程不接触明文） */
export interface ResolvedChannelConfig extends SafeChannelConfig {
  apiKey: string | null
}

export type ChannelAdapterFactory = (config: ResolvedChannelConfig, deps: ChannelDeps) => ChannelAdapter

const factories = new Map<string, ChannelAdapterFactory>()
factories.set('mock', () => createMockChannel())
factories.set('openai-images', (config, deps) => createOpenAiImagesAdapter(config, deps))
// 聊天协议（M6-16）：提示词节点的「优化 / 翻译 / 反推」需要文本模型，
// 而生图协议没有 /v1/chat/completions，故此前的真实渠道一律退化成「暂无可用文本模型」。
factories.set('openai-chat', (config, deps) => createOpenAiChatAdapter(config, deps))
// openai-video 的适配器在 M2 后续组实现，暂用生图适配器顶上「验证地址 / 拉取模型」
//（真实生成时按协议抛 unsupported）。避免设置页选到未注册协议直接报错。

export function registerChannelAdapter(protocol: string, factory: ChannelAdapterFactory): void {
  factories.set(protocol, factory)
}

export function getChannelAdapterFactory(protocol: string): ChannelAdapterFactory | undefined {
  return factories.get(protocol)
}

export function createChannelAdapter(
  config: ResolvedChannelConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  const factory = factories.get(config.protocol)
  if (!factory) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
  return factory(config, deps)
}
