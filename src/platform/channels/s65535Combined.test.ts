import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../memory'
import type { NetworkRequest, NetworkResponse } from '../ports'
import { createChannelAdapter } from './registry'
import { createS65535CombinedAdapter } from './s65535Combined'
import { ChannelError } from './types'

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00,
])

function json(status: number, obj: unknown): NetworkResponse {
  return {
    status,
    headers: {},
    async text() {
      return JSON.stringify(obj)
    },
    async json<T>() {
      return obj as T
    },
    async arrayBuffer() {
      return PNG_BYTES.buffer.slice(
        PNG_BYTES.byteOffset,
        PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
      ) as ArrayBuffer
    },
  }
}

const config = {
  id: 'c1',
  protocol: '65535',
  baseUrl: 'https://api2.65535.space',
  credentialRef: null,
  modelCache: [],
  apiKey: 'chat-key',
  altApiKey: 'image-key',
  protocolDefinition: {
    id: '65535',
    name: '65535 · 对话 + 生图',
    short: '65535',
    family: 'openai-compatible' as const,
    kind: 'station' as const,
    status: 'ready' as const,
    capabilities: ['chat' as const, 'image' as const],
    versionPath: '/v1',
    endpointBaseUrls: { image: 'https://task-api-1.65535.space' },
  },
}

describe('65535 合并渠道适配器', () => {
  it('对话走 api2 + 主 Key，生图走 task-api-1 + 备用 Key', async () => {
    const calls: { url: string; auth: string }[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push({
          url: `${req.method} ${req.url}`,
          auth: String(req.headers?.Authorization ?? ''),
        })
        if (req.url.endsWith('/chat/completions')) {
          return json(200, {
            choices: [{ message: { content: '好的' }, finish_reason: 'stop' }],
          })
        }
        if (req.method === 'POST' && req.url.endsWith('/tasks')) {
          return json(202, { id: 'img_1', status: 'pending' })
        }
        if (req.url.includes('/tasks/')) {
          return json(200, {
            id: 'img_1',
            status: 'done',
            result_urls: ['https://cdn.example/a.png'],
          })
        }
        return json(200, {})
      },
    })

    const adapter = createS65535CombinedAdapter(config as never, platform)
    const text = await adapter.completeText(
      {
        kind: 'text',
        channelId: 'c1',
        model: 'gpt-5.5',
        prompt: '你好',
        inputs: [],
        params: {},
      },
      new AbortController().signal,
    )
    expect(text.text).toBe('好的')

    const assets = await adapter.generateImage(
      {
        kind: 'image',
        channelId: 'c1',
        model: 'gpt-image-2',
        prompt: '一只橘猫',
        inputs: [],
        params: { count: 1, ratio: '16:9', resolution: '2K' },
      },
      new AbortController().signal,
    )

    expect(calls[0]).toEqual({
      url: 'POST https://api2.65535.space/v1/chat/completions',
      auth: 'Bearer chat-key',
    })
    expect(calls[1]).toEqual({
      url: 'POST https://task-api-1.65535.space/v1/tasks',
      auth: 'Bearer image-key',
    })
    expect(assets).toHaveLength(1)
  })

  it('大陆对话地址自动配成大陆任务地址', async () => {
    const calls: string[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(`${req.method} ${req.url}`)
        if (req.method === 'POST') return json(202, { id: 'img_cn' })
        if (req.url.includes('/tasks/')) {
          return json(200, {
            id: 'img_cn',
            status: 'done',
            result_urls: ['https://cdn.example/cn.png'],
          })
        }
        return json(200, {})
      },
    })
    const adapter = createS65535CombinedAdapter(
      { ...config, baseUrl: 'https://api2-cn.65535.space' } as never,
      platform,
    )
    await adapter.generateImage(
      {
        kind: 'image',
        channelId: 'c1',
        model: 'gpt-image-2',
        prompt: '测试',
        inputs: [],
        params: {},
      },
      new AbortController().signal,
    )
    expect(calls[0]).toBe('POST https://task-api-1-cn.65535.space/v1/tasks')
  })

  it('只填对话 Key 时生图明确报“缺生图 Key”，不偷偷换能力', async () => {
    const adapter = createS65535CombinedAdapter(
      { ...config, altApiKey: null } as never,
      createMemoryPlatform(),
    )
    await expect(
      adapter.generateImage(
        {
          kind: 'image',
          channelId: 'c1',
          model: 'gpt-image-2',
          prompt: '测试',
          inputs: [],
          params: {},
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(ChannelError)
  })

  it('verify / listModels 合并两条能力目录', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.startsWith('https://api2')) {
          return json(200, { data: [{ id: 'gpt-5.5' }] })
        }
        return json(200, { data: [{ id: 'gpt-image-2' }] })
      },
    })
    const adapter = createChannelAdapter(config as never, platform)
    const result = await adapter.verify(config as never, new AbortController().signal)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.models.map((model) => model.id).sort()).toEqual([
      'gpt-5.5',
      'gpt-image-2',
    ])
    const models = await adapter.listModels(
      config as never,
      new AbortController().signal,
    )
    expect(models.map((model) => model.id).sort()).toEqual(['gpt-5.5', 'gpt-image-2'])
  })
})
