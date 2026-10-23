import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../memory'
import type { NetworkRequest, NetworkResponse } from '../ports'
import { createChannelAdapter } from './registry'
import {
  createS65535TaskAdapter,
  s65535ResultUrlsOf,
  s65535TaskIdOf,
} from './s65535'
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
  protocol: '65535-task',
  baseUrl: 'https://task-api-1.65535.space',
  credentialRef: null,
  modelCache: [],
  apiKey: 'sk-test',
  protocolDefinition: {
    id: '65535-task',
    name: '65535 · 生图任务',
    short: '65535T',
    family: 'async-task' as const,
    kind: 'station' as const,
    status: 'ready' as const,
    capabilities: ['image' as const],
    versionPath: '/v1',
  },
}

const imageRequest = {
  kind: 'image' as const,
  channelId: 'c1',
  model: 'gpt-image-2',
  prompt: '一只橘猫',
  inputs: [],
  params: { count: 1, ratio: '16:9', resolution: '2K' },
}

describe('65535 原生异步任务适配器', () => {
  it('registry 把 65535-task 分派到原生任务适配器（不是 APIMart 兼容层）', async () => {
    const calls: string[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(`${req.method} ${req.url}`)
        if (req.method === 'POST') return json(202, { id: 'img_route' })
        if (req.url.includes('/tasks/')) {
          return json(200, {
            id: 'img_route',
            status: 'done',
            result_urls: ['https://cdn.example/route.png'],
          })
        }
        return json(200, {})
      },
    })
    const adapter = createChannelAdapter(
      {
        ...config,
        protocolDefinition: {
          ...config.protocolDefinition,
          capabilities: ['image'],
        },
      } as never,
      platform,
    )
    await adapter.generateImage(imageRequest, new AbortController().signal)
    expect(calls[0]).toBe('POST https://task-api-1.65535.space/v1/tasks')
    expect(calls).not.toContain(
      'POST https://task-api-1.65535.space/v1/images/generations',
    )
  })

  it('提交到 /v1/tasks → 轮询 → 下载 result_urls', async () => {
    const calls: string[] = []
    let bodies: Record<string, unknown>[] = []
    let polls = 0
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(`${req.method} ${req.url}`)
        if (req.method === 'POST') {
          bodies = [req.body as Record<string, unknown>]
          return json(202, { id: 'img_1', status: 'pending' })
        }
        if (req.url.includes('/tasks/')) {
          polls += 1
          return polls === 1
            ? json(200, { id: 'img_1', status: 'running', progress: 20 })
            : json(200, {
                id: 'img_1',
                status: 'done',
                result_urls: ['https://cdn.example/a.png'],
              })
        }
        return json(200, {})
      },
    })

    const adapter = createS65535TaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    const assets = await adapter.generateImage(imageRequest, new AbortController().signal)

    expect(calls[0]).toBe('POST https://task-api-1.65535.space/v1/tasks')
    expect(calls[1]).toBe('GET https://task-api-1.65535.space/v1/tasks/img_1')
    expect(bodies[0]).toMatchObject({
      kind: 'image',
      model: 'gpt-image-2',
      input: {
        prompt: '一只橘猫',
        n: 1,
        size: '16:9',
        resolution: '2k',
      },
    })
    expect(assets).toHaveLength(1)
    expect(assets[0]!.mime).toBe('image/png')
    expect(assets[0]!.width).toBe(2)
  })

  it('支持 result.data[].b64_json（不依赖 CDN URL）', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') return json(202, { id: 'img_b64' })
        return json(200, {
          id: 'img_b64',
          status: 'done',
          result: {
            data: [
              {
                b64_json: btoa(String.fromCharCode(...PNG_BYTES)),
              },
            ],
          },
        })
      },
    })
    const adapter = createS65535TaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    const assets = await adapter.generateImage(imageRequest, new AbortController().signal)
    expect(assets).toHaveLength(1)
    expect(assets[0]!.width).toBe(2)
  })

  it('任务失败时带服务端原因抛出，不返回空数组', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') return json(202, { id: 'img_bad' })
        return json(200, {
          id: 'img_bad',
          status: 'failed',
          error_message: 'INSUFFICIENT_BALANCE',
        })
      },
    })
    const adapter = createS65535TaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    await expect(
      adapter.generateImage(imageRequest, new AbortController().signal),
    ).rejects.toThrow(ChannelError)
  })

  it('参考图随原生 input 以 data URI 发出（无图床时）', async () => {
    let posted: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'ref_1', bytes: PNG_BYTES, mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          posted = req.body as Record<string, unknown>
          return json(202, { id: 'img_ref' })
        }
        if (req.url.includes('/tasks/')) {
          return json(200, {
            id: 'img_ref',
            status: 'done',
            result_urls: ['https://cdn.example/ref.png'],
          })
        }
        return json(200, {})
      },
    })
    const adapter = createS65535TaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    await adapter.generateImage(
      {
        ...imageRequest,
        inputs: [{ kind: 'asset', nodeId: 'n1', assetHash: 'ref_1', mime: 'image/png' }],
      },
      new AbortController().signal,
    )
    const input = posted!.input as Record<string, unknown>
    expect(String(input.image)).toMatch(/^data:image\/(png|webp);base64,/)
  })

  it('解析函数兼容 id / task_id 与多类产物字段', () => {
    expect(s65535TaskIdOf({ id: 'a' })).toBe('a')
    expect(s65535TaskIdOf({ task_id: 'b' })).toBe('b')
    expect(s65535TaskIdOf({ data: { task_id: 'c' } })).toBe('c')
    expect(
      s65535ResultUrlsOf({
        result_urls: ['a'],
        result: { data: [{ url: ['b', 'a'] }], videos: [{ url: ['c'] }] },
      }),
    ).toEqual(['a', 'b', 'c'])
  })
})
