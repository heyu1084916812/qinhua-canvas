import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { NetworkRequest, NetworkResponse } from '../../platform/ports'
import { createAsyncTaskAdapter, isTerminalStatus, resultUrlsOf } from './asyncTask'
import { ChannelError } from './types'

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  // IHDR: width=2 height=1
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
  protocol: 'apimart',
  baseUrl: 'https://api.apimart.ai',
  credentialRef: null,
  modelCache: [],
  apiKey: 'sk-test',
  protocolDefinition: {
    id: 'apimart',
    name: 'APIMART',
    short: 'APIM',
    family: 'async-task' as const,
    kind: 'station' as const,
    status: 'ready' as const,
    capabilities: ['image' as const, 'video' as const],
    versionPath: '/v1',
  },
}

const imageRequest = {
  kind: 'image' as const,
  channelId: 'c1',
  model: 'gpt-image-2',
  prompt: '一只橘猫',
  inputs: [],
  params: { count: 1, ratio: '16:9', resolution: '2k' },
}

describe('异步任务族适配器', () => {
  it('提交 → 轮询到 completed → 下载产物（APIMART 官方形态）', async () => {
    const calls: string[] = []
    let polls = 0
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(`${req.method} ${req.url}`)
        if (req.method === 'POST') {
          return json(200, { code: 200, data: { status: 'submitted', task_id: 'task_1' } })
        }
        if (req.url.includes('/tasks/')) {
          polls += 1
          // 第一轮还在处理中，第二轮才完成：验证真的会继续轮询
          if (polls === 1) return json(200, { id: 'task_1', status: 'processing', progress: 20 })
          return json(200, {
            id: 'task_1',
            status: 'completed',
            progress: 100,
            result: { images: [{ url: ['https://upload.apimart.ai/f/a.png'] }] },
          })
        }
        return json(200, {})
      },
    })

    const adapter = createAsyncTaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    const assets = await adapter.generateImage(imageRequest, new AbortController().signal)

    expect(calls[0]).toBe('POST https://api.apimart.ai/v1/images/generations')
    expect(calls[1]).toBe('GET https://api.apimart.ai/v1/tasks/task_1')
    expect(assets).toHaveLength(1)
    expect(assets[0]!.mime).toBe('image/png')
    expect(assets[0]!.width).toBe(2)
  })

  it('任务失败：带服务端原因抛出，不是静默返回空数组', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') return json(200, { data: { task_id: 'task_2' } })
        return json(200, { id: 'task_2', status: 'failed', error: { message: '模型未开通' } })
      },
    })
    const adapter = createAsyncTaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    await expect(
      adapter.generateImage(imageRequest, new AbortController().signal),
    ).rejects.toThrow(ChannelError)
  })

  it('提交响应没有 task_id → 如实报解析失败（没有 id 就无从轮询）', async () => {
    const platform = createMemoryPlatform({
      handler: async () => json(200, { code: 200, data: [] }),
    })
    const adapter = createAsyncTaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    await expect(
      adapter.generateImage(imageRequest, new AbortController().signal),
    ).rejects.toThrow(ChannelError)
  })

  it('轮询超时：处理中一直不落终态，超时报 timeout 而不是无限等待', async () => {
    let now = 0
    const platform = createMemoryPlatform({
      handler: async () => json(200, { id: 'task_3', status: 'processing' }),
    })
    const adapter = createAsyncTaskAdapter(config as never, platform, {
      pollIntervalMs: 1_000,
      pollTimeoutMs: 2_000,
      sleep: async () => {
        now += 1_000
      },
      now: () => now,
    })
    await expect(
      adapter.generateImage(imageRequest, new AbortController().signal),
    ).rejects.toThrow(ChannelError)
  })

  it('verify 仍走 /models：异步站在连通性上与 OpenAI 兼容同形', async () => {
    const platform = createMemoryPlatform({
      handler: async () => json(200, { data: [{ id: 'gpt-image-2' }] }),
    })
    const adapter = createAsyncTaskAdapter(config as never, platform)
    const res = await adapter.verify(config as never, new AbortController().signal)
    expect(res.ok).toBe(true)
  })

  it('视频走 /videos/generations 且产物 mime 是 video/mp4', async () => {
    const urls: string[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        urls.push(`${req.method} ${req.url}`)
        if (req.method === 'POST') return json(200, { data: { task_id: 'tv' } })
        if (req.url.includes('/tasks/')) {
          return json(200, {
            status: 'completed',
            result: { videos: [{ url: ['https://x/a.mp4'] }] },
          })
        }
        return json(200, {})
      },
    })
    const adapter = createAsyncTaskAdapter(config as never, platform, {
      pollIntervalMs: 0,
      sleep: async () => {},
    })
    const assets = await adapter.generateVideo(
      { ...imageRequest, kind: 'video' },
      new AbortController().signal,
    )
    expect(urls[0]).toBe('POST https://api.apimart.ai/v1/videos/generations')
    expect(assets[0]!.mime).toBe('video/mp4')
  })

  it('终态判定与产物地址抽取是纯函数（pending / processing 继续等）', () => {
    expect(isTerminalStatus('pending')).toBe(false)
    expect(isTerminalStatus('processing')).toBe(false)
    expect(isTerminalStatus('submitted')).toBe(false)
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('cancelled')).toBe(true)
    expect(
      resultUrlsOf({
        status: 'completed',
        result: { images: [{ url: ['a', 'b'] }], videos: [{ url: ['c'] }] },
      }),
    ).toEqual(['a', 'b', 'c'])
    expect(resultUrlsOf({ status: 'completed' })).toEqual([])
  })
})
