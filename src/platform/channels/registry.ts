import type { SafeChannelConfig } from '../ports'
import { ChannelError, type ChannelAdapter, type ChannelDeps } from './types'
import { createMockChannel } from './mock'
import { createOpenAiChatAdapter } from './openaiChat'
import { createOpenAiImagesAdapter } from './openaiImages'
import { createOpenAiVideoAdapter } from './openaiVideo'
import { createAsyncTaskAdapter } from './asyncTask'
import { createCliGatewayAdapter } from './cliGateway'

/** 调用前由凭据层注入明文令牌的渠道配置（业务代码与 UI 全程不接触明文） */
export interface ResolvedChannelConfig extends SafeChannelConfig {
  apiKey: string | null
}

export type ChannelAdapterFactory = (config: ResolvedChannelConfig, deps: ChannelDeps) => ChannelAdapter

/**
 * 应急 / 测试用的按协议 id 注册表（向后兼容导出）。
 *
 * 「一站一协议」之后常规分发走 `config.protocolDefinition.family`，
 * 这张表只在「没有协议定义、只能按老 id 认」或测试里替换某条协议时兜底。
 * 注册进这里会优先于 family 分发。
 */
const factories = new Map<string, ChannelAdapterFactory>()

export function registerChannelAdapter(protocol: string, factory: ChannelAdapterFactory): void {
  factories.set(protocol, factory)
}

export function getChannelAdapterFactory(protocol: string): ChannelAdapterFactory | undefined {
  return factories.get(protocol)
}

/**
 * OpenAI 兼容族的组合适配器：一份协议同时声明对话与生图时，能力按声明裁剪。
 *
 * 对话 / 生图 / 生视频的请求形态、超时、内容解析完全不同，各自有独立实现与单测；
 * 这里只做能力分派，未声明某项能力就抛 unsupported，不悄悄发站不支持的请求。
 */
function createOpenAiCompatibleAdapter(
  config: ResolvedChannelConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  const capabilities = config.protocolDefinition?.capabilities ?? ['chat', 'image']
  const chat = capabilities.includes('chat') ? createOpenAiChatAdapter(config, deps) : null
  const images = capabilities.includes('image') ? createOpenAiImagesAdapter(config, deps) : null
  /**
   * 视频单独一条：形态是「提交 → 轮询 → 下载」，与同步的生图不是一条链路
   * （见 `openaiVideo.ts` 文件头的依据）。此前这里无条件抛 unsupported，
   * 于是声明了 `video` 的站也没有任何通路。
   */
  const video = capabilities.includes('video') ? createOpenAiVideoAdapter(config, deps) : null
  // verify / listModels 打的是同一个 /models，两条实现等价；优先用声明了的那条
  const verifier = chat ?? images ?? video
  if (!verifier) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })

  return {
    protocol: config.protocol,
    verify: (cfg, signal) => verifier.verify(cfg, signal),
    listModels: (cfg, signal) => verifier.listModels(cfg, signal),
    generateImage(request, signal) {
      if (!images) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
      return images.generateImage(request, signal)
    },
    generateVideo(request, signal) {
      if (!video) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
      return video.generateVideo(request, signal)
    },
    completeText(request, signal) {
      if (!chat) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
      return chat.completeText(request, signal)
    },
  }
}

/** 老渠道没有 protocolDefinition 时按老 id 认家族；新渠道一律走定义 */
const LEGACY_FAMILY: Record<string, 'mock' | 'openai-compatible'> = {
  mock: 'mock',
  'openai-images': 'openai-compatible',
  'openai-chat': 'openai-compatible',
}

export function createChannelAdapter(
  config: ResolvedChannelConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  // 显式注册（测试替身 / 未来专用协议）优先
  const explicit = factories.get(config.protocol)
  if (explicit) return explicit(config, deps)

  const family = config.protocolDefinition?.family ?? LEGACY_FAMILY[config.protocol]
  switch (family) {
    case 'mock':
      return createMockChannel()
    case 'openai-compatible':
      return createOpenAiCompatibleAdapter(config, deps)
    /**
     * 异步任务族：提交只回 `task_id`，产物要轮询 `GET {base}/tasks/{id}` 才拿得到。
     * 与同步族是两条不同的链路，故单独一个适配器（依据见 asyncTask.ts 文件头）。
     */
    case 'async-task':
      return createAsyncTaskAdapter(config, deps)
    /**
     * CLI 网关族：浏览器跑不了本机命令，只能访问用户自己跑的网关。
     * 网关对外是 OpenAI 兼容形态，故按能力分派到既有两个适配器（见 cliGateway.ts）。
     */
    case 'cli-gateway':
      return createCliGatewayAdapter(config, deps)
    default:
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
  }
}
