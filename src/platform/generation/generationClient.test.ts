import { describe, expect, it } from 'vitest'
import type { Channel, ChannelCredentialGroup } from '../../domain/project/channel'
import { BUILTIN_CATALOG } from '../../domain/project/protocol'
import type {
  ChannelAdapter,
  GeneratedAsset,
  ImageRunRequest,
  SpeechRunRequest,
  TextRunRequest,
  VideoRunRequest,
} from '../channels/types'
import { ChannelError } from '../channels/types'
import { createMemoryPlatform } from '../memory'
import {
  createGenerationClient,
  type GenerationAttemptEvent,
} from './generationClient'

function group(
  id: string,
  ref: string,
  priority: number,
  modelIds: string[],
): ChannelCredentialGroup {
  return {
    id,
    name: id,
    credentialRef: ref,
    tokenTail: '1234',
    hasToken: true,
    priority,
    models: modelIds.map((modelId) => ({
      id: modelId,
      category: 'image',
      inputTypes: ['text'],
    })),
    modelCache: [],
    createdAt: priority,
  }
}

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: 'ch_gateway',
    name: '网关测试渠道',
    icon: null,
    protocol: 'openai-compatible',
    baseUrl: 'https://example.com',
    credentialRef: 'cred_legacy',
    tokenTail: '1234',
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

function asset(mime = 'image/png'): GeneratedAsset {
  return { hash: 'hash_1', mime, bytes: new Uint8Array([1, 2, 3]) }
}

function stubAdapter(args: {
  onText?: (request: TextRunRequest) => void
  onImage?: (request: ImageRunRequest) => void
  onVideo?: (request: VideoRunRequest) => void
  onSpeech?: (request: SpeechRunRequest) => void
  videoError?: unknown
} = {}): ChannelAdapter {
  return {
    protocol: 'stub',
    async verify() {
      return { ok: true, models: [] }
    },
    async listModels() {
      return []
    },
    async generateImage(request) {
      args.onImage?.(request)
      return [asset()]
    },
    async generateVideo(request) {
      args.onVideo?.(request)
      if (args.videoError) throw args.videoError
      return [asset('video/mp4')]
    },
    async completeText(request) {
      args.onText?.(request)
      return { text: 'ok' }
    },
    async generateSpeech(request) {
      args.onSpeech?.(request)
      return asset('audio/wav')
    },
  }
}

describe('公共 GenerationClient', () => {
  it('按分组优先顺序选择支持该模型且有 Key 的分组，并只做一次模型映射', async () => {
    const seen: TextRunRequest[] = []
    let seenConfig: { apiKey: string | null; credentialRef: string | null } | null = null
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async (ref) =>
        ({ cred_high: 'high', cred_low: 'low' })[ref] ?? null,
      createAdapter: (config) => {
        seenConfig = {
          apiKey: config.apiKey,
          credentialRef: config.credentialRef,
        }
        return stubAdapter({ onText: (request) => seen.push(request) })
      },
    })
    const ch = channel({
      modelMap: { 'Front Image': 'upstream-image' },
      credentialGroups: [
        group('high', 'cred_high', 20, ['other-model']),
        group('low', 'cred_low', 10, ['Front Image']),
      ],
    })

    const result = await client.completeText(
      {
        channel: ch,
        model: 'Front Image',
        request: { kind: 'text', prompt: 'hi', inputs: [], params: {} },
      },
      new AbortController().signal,
    )

    expect(result.text).toBe('ok')
    expect(seenConfig).toMatchObject({
      apiKey: 'low',
      credentialRef: 'cred_low',
    })
    expect(seen[0]).toMatchObject({
      channelId: ch.id,
      model: 'upstream-image',
    })
  })

  it('调用方给出分组降级顺序时，严格按该顺序选择，不自行重试', async () => {
    const seen: VideoRunRequest[] = []
    const keys: string[] = []
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async (ref) =>
        ({ cred_a: 'a', cred_b: 'b' })[ref] ?? null,
      createAdapter: (config) => {
        keys.push(config.apiKey ?? '')
        return stubAdapter({ onVideo: (request) => seen.push(request) })
      },
    })
    const ch = channel({
      credentialGroups: [
        group('a', 'cred_a', 30, ['video-model']),
        group('b', 'cred_b', 10, ['video-model']),
      ],
    })

    await client.generateVideo(
      {
        channel: ch,
        model: 'video-model',
        request: { kind: 'video', prompt: 'run', inputs: [], params: {} },
        hints: { credentialGroupIds: ['b', 'a'] },
      },
      new AbortController().signal,
    )

    expect(seen).toHaveLength(1)
    expect(keys).toEqual(['b'])
  })

  it('显式分组都不支持模型时，不拿渠道旧 Key 继续请求', async () => {
    let adapterCalls = 0
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async () => 'legacy-key',
      createAdapter: () => {
        adapterCalls += 1
        return stubAdapter()
      },
    })
    const ch = channel({
      credentialGroups: [group('image-only', 'cred_group', 1, ['gemini-nano-banana-2.1'])],
    })

    await expect(
      client.completeText(
        {
          channel: ch,
          model: 'Deepseek 4.1 Flash',
          request: { kind: 'text', prompt: 'optimize', inputs: [], params: {} },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      appError: { kind: 'channel', detail: 'missingModel' },
    })
    expect(adapterCalls).toBe(0)
  })

  it('65535 的非对话调用把分组 Key 放进备用槽', async () => {
    let seenConfig: { apiKey: string | null; altApiKey?: string | null } | null = null
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async (ref) =>
        ({ cred_group: 'group-key', cred_alt: 'legacy-alt' })[ref] ?? null,
      createAdapter: (config) => {
        seenConfig = { apiKey: config.apiKey, altApiKey: config.altApiKey }
        return stubAdapter()
      },
    })
    const ch = channel({
      protocol: '65535',
      credentialGroups: [group('group', 'cred_group', 1, ['video-model'])],
      altCredentialRef: 'cred_alt',
    })

    await client.generateVideo(
      {
        channel: ch,
        model: 'video-model',
        request: { kind: 'video', prompt: 'run', inputs: [], params: {} },
      },
      new AbortController().signal,
    )

    expect(seenConfig).toMatchObject({
      apiKey: null,
      altApiKey: 'group-key',
    })
  })

  it('modelIsUpstream 为 true 时不再做第二次映射', async () => {
    const seen: ImageRunRequest[] = []
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async () => 'key',
      createAdapter: () => stubAdapter({ onImage: (request) => seen.push(request) }),
    })
    const ch = channel({
      modelMap: { 'Front Model': 'mapped-model' },
      credentialGroups: [group('g', 'cred_g', 1, ['sent-model'])],
    })

    await client.generateImage(
      {
        channel: ch,
        model: 'sent-model',
        request: { kind: 'image', prompt: 'draw', inputs: [], params: {} },
        hints: { modelIsUpstream: true },
      },
      new AbortController().signal,
    )

    expect(seen[0]?.model).toBe('sent-model')
  })

  it('显式分组已被选路确认时，不拿上游模型 ID 反判分组模型目录', async () => {
    const keys: string[] = []
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async () => 'group-key',
      createAdapter: (config) => {
        keys.push(config.apiKey ?? '')
        return stubAdapter()
      },
    })
    const ch = channel({
      modelMap: { 'Front Model': 'upstream-model' },
      credentialGroups: [group('picked', 'cred_picked', 1, ['Front Model'])],
    })

    await client.generateImage(
      {
        channel: ch,
        model: 'upstream-model',
        request: { kind: 'image', prompt: 'draw', inputs: [], params: {} },
        hints: {
          modelIsUpstream: true,
          credentialGroupId: 'picked',
        },
      },
      new AbortController().signal,
    )

    expect(keys).toEqual(['group-key'])
  })

  it('超时类失败只调用一次并保留真实错误，不自动重发', async () => {
    const timeout = new ChannelError({ kind: 'network', detail: 'timeout' })
    let calls = 0
    const events: GenerationAttemptEvent[] = []
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async () => 'key',
      createAdapter: () =>
        stubAdapter({
          videoError: timeout,
          onVideo: () => {
            calls += 1
          },
        }),
      onAttempt: (event) => events.push(event),
    })

    await expect(
      client.generateVideo(
        {
          channel: channel(),
          model: 'video-model',
          request: { kind: 'video', prompt: 'run', inputs: [], params: {} },
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(timeout)

    expect(calls).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      status: 'failed',
      error: { kind: 'network', detail: 'timeout' },
    })
    expect(events[0]).not.toHaveProperty('outputCount')
  })

  it('缺 Key 时在创建适配器和发请求前停止', async () => {
    let adapterCalls = 0
    const client = createGenerationClient({
      platform: createMemoryPlatform(),
      catalog: () => BUILTIN_CATALOG,
      loadToken: async () => null,
      createAdapter: () => {
        adapterCalls += 1
        return stubAdapter()
      },
    })

    await expect(
      client.generateImage(
        {
          channel: channel({ credentialRef: null, hasToken: false }),
          model: 'image-model',
          request: { kind: 'image', prompt: 'draw', inputs: [], params: {} },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      appError: { kind: 'channel', detail: 'missingKey' },
    })
    expect(adapterCalls).toBe(0)
  })
})
