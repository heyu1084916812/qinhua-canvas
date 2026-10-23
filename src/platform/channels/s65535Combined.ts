/**
 * 65535 单渠道合并适配器。
 *
 * 一条渠道里放两把 Key：
 * - 主令牌 = 对话 Key（OpenAi系 - Std / Pro），走 `api2*`；
 * - 备用令牌 = 生图 Key（image2专用分组），走 `task-api-1*` 的原生异步任务。
 *
 * 地址分开不是障碍，适配器按能力分流即可。真正的约束是两把 Key 属于不同分组，
 * 所以这里不把两把 Key 混成一个；缺哪把就只关掉对应能力，并在真正调用时
 * 给出能直接照着做的提示。
 */

import type { SafeChannelConfig } from '../ports'
import type { ModelCapability } from '../../domain/shared/capability'
import { createOpenAiChatAdapter } from './openaiChat'
import { createS65535TaskAdapter } from './s65535'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type VerifyResult,
} from './types'

export interface S65535CombinedConfig extends SafeChannelConfig {
  apiKey: string | null
  altApiKey?: string | null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function isMainland(baseUrl: string): boolean {
  const host = hostOf(baseUrl)
  return host.includes('api2-cn.65535.space') || host.includes('task-api-1-cn.65535.space')
}

/** 对话基址：默认就是渠道地址；用户贴了任务地址时自动换回对话域名。 */
function chatBaseOf(config: S65535CombinedConfig): string {
  const raw = config.baseUrl.trim()
  const host = hostOf(raw)
  if (!host.includes('task-api-1')) return raw
  return isMainland(raw)
    ? 'https://api2-cn.65535.space'
    : 'https://api2.65535.space'
}

/** 生图基址：随对话地址的大陆 / 国际选择自动配对，最后回落到协议声明。 */
function imageBaseOf(config: S65535CombinedConfig): string {
  const raw = config.baseUrl.trim()
  const host = hostOf(raw)
  if (host.includes('task-api-1')) return raw
  if (host.includes('api2.65535.space') || host.includes('api2-cn.65535.space')) {
    return isMainland(raw)
      ? 'https://task-api-1-cn.65535.space'
      : 'https://task-api-1.65535.space'
  }
  return config.protocolDefinition?.endpointBaseUrls?.image ?? raw
}

function mergeModels(...groups: ModelCapability[][]): ModelCapability[] {
  const byId = new Map<string, ModelCapability>()
  for (const group of groups) {
    for (const model of group) {
      if (!byId.has(model.id)) byId.set(model.id, model)
    }
  }
  return [...byId.values()]
}

function missingKey(kind: 'chat' | 'image'): ChannelError {
  return new ChannelError({
    kind: 'http',
    status: 400,
    body:
      kind === 'chat'
        ? '这条 65535 渠道还没填「对话 Key（OpenAi系）」，暂时不能做对话或提示词优化。'
        : '这条 65535 渠道还没填「生图 Key（image2专用分组）」，暂时不能生图。',
  })
}

export function createS65535CombinedAdapter(
  config: S65535CombinedConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  const chat = config.apiKey
    ? createOpenAiChatAdapter(
        { ...config, baseUrl: chatBaseOf(config), apiKey: config.apiKey },
        deps,
      )
    : null
  const image = config.altApiKey
    ? createS65535TaskAdapter(
        {
          ...config,
          baseUrl: imageBaseOf(config),
          apiKey: config.altApiKey,
        },
        deps,
      )
    : null

  const verify: ChannelAdapter['verify'] = async (cfg, signal): Promise<VerifyResult> => {
    const attempts: Promise<VerifyResult>[] = []
    if (chat) attempts.push(chat.verify(cfg, signal))
    if (image) attempts.push(image.verify(cfg, signal))
    if (attempts.length === 0) {
      return {
        ok: false,
        error: { kind: 'channel', detail: 'missingKey' },
        message: '请至少填写对话 Key 或生图 Key 之一',
      }
    }
    const results = await Promise.all(attempts)
    const successes = results.filter(
      (result): result is Extract<VerifyResult, { ok: true }> => result.ok,
    )
    if (successes.length > 0) {
      return { ok: true, models: mergeModels(...successes.map((item) => item.models)) }
    }
    return results[0]!
  }

  const listModels: ChannelAdapter['listModels'] = async (cfg, signal) => {
    const attempts: Promise<ModelCapability[]>[] = []
    if (chat) attempts.push(chat.listModels(cfg, signal))
    if (image) attempts.push(image.listModels(cfg, signal))
    if (attempts.length === 0) throw missingKey('chat')
    const results = await Promise.allSettled(attempts)
    const successes = results
      .filter(
        (result): result is PromiseFulfilledResult<ModelCapability[]> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
    if (successes.length > 0) return mergeModels(...successes)
    const first = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    throw first?.reason ?? new ChannelError({ kind: 'channel', detail: 'unsupported' })
  }

  return {
    protocol: config.protocol,
    verify,
    listModels,
    generateImage(request, signal) {
      if (!image) return Promise.reject(missingKey('image'))
      return image.generateImage(request, signal)
    },
    generateVideo() {
      return Promise.reject(new ChannelError({ kind: 'channel', detail: 'unsupported' }))
    },
    completeText(request, signal) {
      if (!chat) return Promise.reject(missingKey('chat'))
      return chat.completeText(request, signal)
    },
    ...(chat?.streamChat
      ? {
          streamChat(request, signal) {
            return chat.streamChat!(request, signal)
          },
        }
      : {}),
  }
}
