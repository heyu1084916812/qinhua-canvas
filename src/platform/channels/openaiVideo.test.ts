import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { NetworkRequest, NetworkResponse } from '../../platform/ports'
import {
  agnesVideoDimensions,
  agnesVideoFrameCount,
  collectVideoUrls,
  createOpenAiVideoAdapter,
  videoTaskStatus,
} from './openaiVideo'

/**
 * OpenAI 兼容族的视频分支。
 *
 * 这一组断言的**形态全部来自 2026-10-01 对 Agnes 的真实观测**（提交回
 * `task_id` + `video_id`、轮询按 `task_id`、完成态顶层 `url`）——
 * 不是照着文档猜的。最要紧的一条是「轮询键」：用 `video_id` 查会稳定
 * 返回 `task_not_exist`，把这条钉死，免得以后有人「顺手」改回去。
 */

const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])

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
      return MP4_BYTES.buffer.slice(
        MP4_BYTES.byteOffset,
        MP4_BYTES.byteOffset + MP4_BYTES.byteLength,
      ) as ArrayBuffer
    },
  }
}

const config = {
  id: 'c1',
  protocol: 'agnes',
  baseUrl: 'https://apihub.agnes-ai.com',
  credentialRef: null,
  modelCache: [],
  apiKey: 'sk-test',
  protocolDefinition: {
    id: 'agnes',
    name: 'Agnes',
    short: 'AGNES',
    family: 'openai-compatible' as const,
    kind: 'station' as const,
    status: 'ready' as const,
    capabilities: ['chat' as const, 'image' as const, 'video' as const],
    versionPath: '/v1',
  },
}

const videoRequest = {
  kind: 'video' as const,
  channelId: 'c1',
  model: 'agnes-video-v2.0',
  prompt: 'a red circle slowly rotating',
  inputs: [],
  params: { ratio: '16:9', size: '480p', durationSec: 1, refMode: 'first-last-frame' },
}

describe('视频参数映射（Agnes 形态）', () => {
  it('比例 + 尺寸档 → 像素，两边都吸附到 8 的倍数', () => {
    expect(agnesVideoDimensions('16:9', '720p')).toEqual({ width: 1152, height: 648 })
    // 480p 缩到 0.625：648 × 0.625 = 405 → 吸附到 408
    expect(agnesVideoDimensions('16:9', '480p')).toEqual({ width: 720, height: 408 })
    // 648 × 1.5 = 972 → 吸附到 976；1152 × 1.5 = 1728（本来就是 8 的倍数）
    expect(agnesVideoDimensions('9:16', '1080p')).toEqual({ width: 976, height: 1728 })
  })

  it('★ 未知比例回落 3:2 而不是 1:1（用户选了 16:9 却拿方图更难查）', () => {
    expect(agnesVideoDimensions('7:3', '720p')).toEqual({ width: 1152, height: 768 })
    expect(agnesVideoDimensions(undefined, undefined)).toEqual({ width: 1152, height: 768 })
  })

  it('时长 → num_frames，满足 num_frames ≡ 1 (mod 8)', () => {
    for (const sec of [1, 2, 3, 5, 8, 15, 18]) {
      expect(agnesVideoFrameCount(sec) % 8).toBe(1)
    }
    expect(agnesVideoFrameCount(1)).toBe(25)
    expect(agnesVideoFrameCount(5)).toBe(121)
  })

  it('时长越界被夹取，非法值回落 5 秒', () => {
    expect(agnesVideoFrameCount(99)).toBe(agnesVideoFrameCount(18))
    expect(agnesVideoFrameCount(0)).toBe(agnesVideoFrameCount(1))
    expect(agnesVideoFrameCount('nonsense')).toBe(agnesVideoFrameCount(5))
  })
})

describe('任务响应解析', () => {
  it('完成态顶层 url 能被取出（实测形态）', () => {
    expect(
      collectVideoUrls({ id: 'task_1', status: 'completed', url: 'https://x/v.mp4' }),
    ).toEqual(['https://x/v.mp4'])
  })

  it('★ video_id 不是地址，不能被当成产物（它是长 base64 串，不是 http）', () => {
    expect(
      collectVideoUrls({ status: 'queued', video_id: 'video_bGl0ZWxsbTpjdXN0b20' }),
    ).toEqual([])
  })

  it('嵌套与数组形态都能取到，且去重', () => {
    expect(
      collectVideoUrls({
        data: { videos: ['https://x/a.mp4', 'https://x/a.mp4'] },
        content: { url: 'https://x/b.mp4' },
      }),
    ).toEqual(['https://x/a.mp4', 'https://x/b.mp4'])
  })

  it('状态取值优先 data.status，并统一大写', () => {
    expect(videoTaskStatus({ status: 'queued' })).toBe('QUEUED')
    expect(videoTaskStatus({ data: { status: 'completed' } })).toBe('COMPLETED')
    expect(videoTaskStatus(null)).toBe('')
  })
})

describe('视频适配器：提交 → 轮询 → 下载', () => {
  it('★★ 用 task_id 轮询（不是 video_id），完成态顶层 url 取产物', async () => {
    const calls: string[] = []
    let polls = 0
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(`${req.method} ${req.url}`)
        if (req.method === 'POST') {
          return json(200, {
            id: 'task_1',
            task_id: 'task_1',
            video_id: 'video_abc',
            status: 'queued',
            progress: 0,
          })
        }
        if (req.url.includes('/videos/task_1')) {
          polls += 1
          if (polls === 1) return json(200, { id: 'task_1', status: 'queued', progress: 0 })
          return json(200, { id: 'task_1', status: 'completed', progress: 100, url: 'https://x/v.mp4' })
        }
        if (req.url === 'https://x/v.mp4') return json(200, {})
        return json(404, { error: 'unexpected' })
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, {
      pollIntervalMs: 1,
      sleep: async () => {},
      now: () => 0,
    })

    const assets = await adapter.generateVideo(videoRequest, new AbortController().signal)

    expect(assets).toHaveLength(1)
    expect(assets[0]!.mime).toBe('video/mp4')
    expect(assets[0]!.bytes).toEqual(MP4_BYTES)
    // 请求像素要如实记下来（§6.18 日志「请求像素」）
    expect(assets[0]!.requestedWidth).toBe(720)
    expect(assets[0]!.requestedHeight).toBe(408)
    // 轮询键必须是 task_id
    expect(calls.some((c) => c.includes('/videos/task_1'))).toBe(true)
    // 任务路由通则不该再去撞另一套部署的 /agnesapi（每轮白撞一次 400）
    expect(calls.some((c) => c.includes('/agnesapi'))).toBe(false)
    expect(polls).toBe(2)
  })

  it('★ 提交体用像素而不是比例字面量（该站按像素收）', async () => {
    let sent: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          sent = req.body as Record<string, unknown>
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url.includes('/videos/t')) {
          return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        }
        return json(200, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await adapter.generateVideo(videoRequest, new AbortController().signal)

    expect(sent).toMatchObject({
      model: 'agnes-video-v2.0',
      width: 720,
      height: 408,
      frame_rate: 24,
    })
    expect(sent!.num_frames).toBe(25)
    expect(sent!.ratio).toBeUndefined()
  })

  it('★ 失败态把服务端原话带出来（只报「失败」等于没说）', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') return json(200, { task_id: 't', video_id: 'v' })
        if (req.url.includes('/videos/t')) {
          return json(200, { status: 'failed', error: { message: '内容安全策略拦截' } })
        }
        return json(200, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await expect(
      adapter.generateVideo(videoRequest, new AbortController().signal),
    ).rejects.toMatchObject({ appError: { kind: 'http', status: 502, body: '内容安全策略拦截' } })
  })

  it('★ 提交响应没有 task_id → 明确报解析失败，不空转到超时', async () => {
    const platform = createMemoryPlatform({
      handler: async () => json(200, { status: 'queued' }),
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await expect(
      adapter.generateVideo(videoRequest, new AbortController().signal),
    ).rejects.toMatchObject({ appError: { kind: 'parse', raw: '提交响应里没有 task_id' } })
  })
})
