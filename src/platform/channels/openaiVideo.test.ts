import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { NetworkRequest, NetworkResponse } from '../../platform/ports'
import {
  agnesVideoSeconds,
  agnesVideoSizeTier,
  agnesVideoDimensions,
  agnesVideoFrameCount,
  collectVideoUrls,
  createOpenAiVideoAdapter,
  videoTaskStatus,
} from './openaiVideo'
import { bytesToBase64 } from './base64'

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
  /**
   * `refMode: null` = 用户没选参考模式（面板默认显示「首尾帧」但不写进节点，
   * `nodeSpecs/params.ts` 会把未设置发成 `null`）⇒ 走纯文字起片。
   */
  params: { ratio: '16:9', size: '480p', durationSec: 1, refMode: null },
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

  it('★ 官方 seconds 是字符串且夹到 4–12（面板给的是 3–15）', () => {
    expect(agnesVideoSeconds(3)).toBe(4)
    expect(agnesVideoSeconds(15)).toBe(12)
    expect(agnesVideoSeconds(8)).toBe(8)
    expect(agnesVideoSeconds(undefined)).toBe(5)
  })

  it('★ 官方 size 是档位不是像素；480p / auto 都落到 720P', () => {
    expect(agnesVideoSizeTier('1080p')).toBe('1080P')
    expect(agnesVideoSizeTier('720p')).toBe('720P')
    expect(agnesVideoSizeTier('480p')).toBe('720P')
    expect(agnesVideoSizeTier('auto')).toBe('720P')
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
    /**
     * ★★ Agnes 的原生形态：`/agnesapi` 返回的是 `internal_status`，**没有 `status`**。
     * 只读 `status` 的话这里会得到空串 ⇒ 轮询把有效载荷当无效、改去试别的路由、
     * 空转到放弃 —— 用户看到的就是「跑了几十秒然后失败、0 个产物」（2026-10-03）。
     */
    expect(videoTaskStatus({ internal_status: 'inference', internal_progress: 30 })).toBe('INFERENCE')
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
    // 官方推荐的 /agnesapi 先被试一次（本站 404），真正出数据的是 task_id 路由
    expect(calls.some((c) => c.includes('/agnesapi'))).toBe(true)
    expect(calls.some((c) => c.includes('/videos/task_1'))).toBe(true)
    expect(polls).toBe(2)
  })

  /**
   * 2026-10-03 用真令牌打 `apihub.agnes-ai.com` 实测（对账清单 #112）：
   *
   * - 给 `agnes-video-v2.0` 发官方档位那套（`size:"720P"` + `aspect_ratio:"16:9"`）：
   *   **HTTP 200，但回填的 size 是默认 `1088x832`** —— 用户选的尺寸与比例被静默丢掉；
   * - 发像素那套（`1280x720` + `num_frames`）：回填 `1280x704`（吸附到 32 的倍数），
   *   时长也按帧数算。
   *
   * 所以 2.0 必须**先发像素形态**。这条断言就是那次的结论，谁把顺序调回去它就红。
   */
  it('★★ Agnes Video 2.0 先发像素形态（它收下档位参数却无视它们）', async () => {
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
        /** 产物下载：这一条是「成功但产物取不到必须报错」之后补的 —— 取不到会直接抛。 */
        if (req.url.includes('v.mp4')) return json(200, {})
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await adapter.generateVideo(videoRequest, new AbortController().signal)

    expect(sent).toMatchObject({
      model: 'agnes-video-v2.0',
      // 480p 在 16:9 下是 720×408（两边都吸附到 8 的倍数）
      width: 720,
      height: 408,
      frame_rate: 24,
    })
    /** 时长 4 秒（低于 2.0 下限 1 秒被夹到 4）→ 帧数按 `≡1 (mod 8)` 吸附 */
    expect(sent!.num_frames).toBe(97)
    // 档位那套字段不许先发：发了就等于把用户选的尺寸与比例丢掉
    expect(sent!.size).toBeUndefined()
    expect(sent!.aspect_ratio).toBeUndefined()
  })

  it('★★ Agnes Video 2.5 仍先发官方档位形态（size / aspect_ratio）', async () => {
    const bodies: Record<string, unknown>[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          bodies.push(req.body as Record<string, unknown>)
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        if (req.url.includes('v.mp4')) return json(200, {})
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await adapter.generateVideo(
      { ...videoRequest, model: 'agnes-video-2.5', params: { ...videoRequest.params, size: '720P' } },
      new AbortController().signal,
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      model: 'agnes-video-2.5',
      /**
       * `mode` 是**服务端枚举，而且 2.5 与 2.0 不是同一套**：
       * Agnes Video 2.5 官方文档给的是 `text` / `keyframe` / `reference`
       * （`wiki.agnes-ai.com/en/docs/agnes-video-25`，2026-10-03 实读）；
       * 2.0 那一套是 `ti2vid` / `keyframes` / `multi_reference`（真令牌 400 原文）。
       *
       * 这条断言曾经钉的是 `ti2vid` —— 那是照着 **2.0** 的报错写进 **2.5** 的用例里，
       * 于是「2.5 纯文字起片发 ti2vid、被 400 拒」这个 bug 被单测一起锁死了。
       */
      mode: 'text',
      seconds: '4',
      size: '720P',
      aspect_ratio: '16:9',
    })
    expect(bodies[0]!.width).toBeUndefined()
    expect(bodies[0]!.num_frames).toBeUndefined()
  })

  it('★ 先发的那套被 400 拒时，换另一套（老部署只认像素那套）', async () => {
    const bodies: Record<string, unknown>[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          const body = req.body as Record<string, unknown>
          bodies.push(body)
          // 像素形态被拒；档位形态才通过（与 2.0 的第一顺位相反）
          return body.width ? json(400, { error: 'bad params' }) : json(200, { task_id: 't', video_id: 'v' })
        }
        if (req.url === 'https://x/v.mp4') return json(200, {})
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    const assets = await adapter.generateVideo(videoRequest, new AbortController().signal)

    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({ width: 720, height: 408, frame_rate: 24 })
    expect(bodies[1]).toMatchObject({ mode: 'ti2vid', size: '720P', aspect_ratio: '16:9' })
    expect(assets).toHaveLength(1)
  })

  /**
   * **2026-10-03 实测推翻旧口径**（对账清单 #115）：
   *
   * 原先这里钉的是「带本地参考图一律拦住」（依据是 2.5 文档要求公网 URL）。
   * 真令牌实测：2.0 的 `mode:'keyframes'` **收下 `image:[data:image/png;base64,…]`**
   * 并正常排队（HTTP 200）；参数要求是**数组至少 2 项**
   * （错误原文：`mode=keyframes requires image as a list of at least 2 items`）。
   */
  it('★★ 首尾帧：本地素材读成 Data URI，按 2.0 口径发 `image` 数组（≥2 项）', async () => {
    const bodies: Record<string, unknown>[] = []
    const platform = createMemoryPlatform({
      rows: {
        assets: [
          { id: 'a1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
          { id: 'a2', bytes: new Uint8Array([4, 5, 6]), mime: 'image/png' },
        ],
      },
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          bodies.push(req.body as Record<string, unknown>)
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url === 'https://x/v.mp4') return json(200, {})
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await adapter.generateVideo(
      {
        ...videoRequest,
        params: { ...videoRequest.params, refMode: 'first-last-frame' },
        inputs: [
          { kind: 'asset', nodeId: 'n1', assetHash: 'a1', mime: 'image/png' },
          { kind: 'asset', nodeId: 'n2', assetHash: 'a2', mime: 'image/png' },
        ],
      },
      new AbortController().signal,
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ mode: 'keyframes', width: 720, height: 408, frame_rate: 24 })
    const images = bodies[0]!.image as string[]
    expect(images).toHaveLength(2)
    expect(images[0]).toBe(`data:image/png;base64,${bytesToBase64(new Uint8Array([1, 2, 3]))}`)
    expect(images[1]).toBe(`data:image/png;base64,${bytesToBase64(new Uint8Array([4, 5, 6]))}`)
    /** 首尾帧只发**单数**那个键（实测过的那一个）；复数键是给全能参考用的，这里不该冒出来 */
    expect(bodies[0]!.images).toBeUndefined()
  })

  /**
   * ★★ **全能参考：两个键名同值同时发**（用户 2026-10-03：
   * 「我的 agnes video 2.0 好像生视频不是按照我的全能参考来的」）。
   *
   * 原先只发 `image`（单数）—— 那是**首尾帧**实测出来的键，被顺手套用到这里，
   * 而这条路径**从没和真上游对过**（这条用例当初只断言「发了 image」，
   * 等于把猜测钉成了回归基线）。官方文档给 reference 模式写的是 `images`（复数）。
   * 上游若只认复数，单数就被静默忽略 ⇒ 参考图等于没发。
   */
  it('★★ 全能参考：`images`（文档）与 `image`（实测那套）同值同时发', async () => {
    let sent: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'a1', bytes: new Uint8Array([9]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          sent = req.body as Record<string, unknown>
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url === 'https://x/v.mp4') return json(200, {})
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await adapter.generateVideo(
      {
        ...videoRequest,
        params: { ...videoRequest.params, refMode: 'all-purpose' },
        inputs: [{ kind: 'asset', nodeId: 'n1', assetHash: 'a1', mime: 'image/png' }],
      },
      new AbortController().signal,
    )
    expect(sent).toMatchObject({ mode: 'multi_reference' })
    const expected = [`data:image/png;base64,${bytesToBase64(new Uint8Array([9]))}`]
    expect(sent!.images).toEqual(expected)
    expect(sent!.image).toEqual(expected)
  })

  it('★ 选了参考模式却一张素材都没连 → 明确报错（不发一个必失败的请求）', async () => {
    const platform = createMemoryPlatform({ handler: async () => json(200, {}) })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await expect(
      adapter.generateVideo(
        { ...videoRequest, params: { ...videoRequest.params, refMode: 'first-last-frame' } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ appError: { kind: 'http', status: 400 } })
  })

  /**
   * 素材传输（图床）是**可选加速项**（用户 2026-10-03 要求单独一个设置页）：
   * 配了就先上传、用公网直链；没配或传挂了，回落内联 Base64 ——
   * 两条路都必须能把参考图发出去，图床不能成为参考功能的单点。
   */
  it('★★ 配了图床：参考图先用图床直链（不再把 base64 塞进请求体）', async () => {
    let sent: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'a1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          sent = req.body as Record<string, unknown>
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url === 'https://x/v.mp4') return json(200, {})
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(
      config,
      {
        network: platform.network,
        assets: platform.assets,
        hosting: { upload: async () => ({ url: 'https://host.example/a1.png' }) },
      },
      { sleep: async () => {}, now: () => 0 },
    )
    await adapter.generateVideo(
      {
        ...videoRequest,
        params: { ...videoRequest.params, refMode: 'all-purpose' },
        inputs: [{ kind: 'asset', nodeId: 'n1', assetHash: 'a1', mime: 'image/png' }],
      },
      new AbortController().signal,
    )
    expect(sent!.image).toEqual(['https://host.example/a1.png'])
  })

  it('★ 图床传挂了 → 回落内联 Base64（参考功能不被图床拖死）', async () => {
    let sent: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'a1', bytes: new Uint8Array([7]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') {
          sent = req.body as Record<string, unknown>
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url === 'https://x/v.mp4') return json(200, {})
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(
      config,
      {
        network: platform.network,
        assets: platform.assets,
        hosting: {
          upload: async () => {
            throw new Error('图床挂了')
          },
        },
      },
      { sleep: async () => {}, now: () => 0 },
    )
    await adapter.generateVideo(
      {
        ...videoRequest,
        params: { ...videoRequest.params, refMode: 'all-purpose' },
        inputs: [{ kind: 'asset', nodeId: 'n1', assetHash: 'a1', mime: 'image/png' }],
      },
      new AbortController().signal,
    )
    expect(sent!.image).toEqual([`data:image/png;base64,${bytesToBase64(new Uint8Array([7]))}`])
  })

  it('★ 失败态把服务端原话带出来（只报「失败」等于没说）', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.method === 'POST') return json(200, { task_id: 't', video_id: 'v' })
        if (req.url.includes('/videos/t')) {
          return json(200, { status: 'failed', error: { message: '内容安全策略拦截' } })
        }
        return json(404, {})
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

describe('视频轮询 · 限流不该把任务判死（用户 2026-10-03 实测）', () => {
  it('★★ 中途吃到 429「查询过于频繁」，仍应继续轮询直到 completed', async () => {
    let polls = 0
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest): Promise<NetworkResponse> => {
        const url = req.url
        if (req.method === 'POST') {
          return json(200, { id: 'task_1', video_id: 'video_1', status: 'queued' })
        }
        if (url.includes('/agnesapi')) {
          polls += 1
          /** 第 1 次轮询就限流（真实抓包里的形状）；第 2 次才 completed + url */
          if (polls === 1) return json(429, { error: { code: 429, message: '查询过于频繁，请稍后重试' } })
          return json(200, { status: 'completed', internal_status: 'completed', internal_progress: 100, url: 'https://x/v.mp4' })
        }
        if (url.includes('v.mp4')) return json(200, {})
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, {
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 0,
      pollTimeoutMs: 60_000,
    })
    const assets = await adapter.generateVideo(videoRequest, new AbortController().signal)
    expect(assets.length).toBe(1)
    expect(polls).toBeGreaterThanOrEqual(2)
  })
})

/**
 * **每个视频模型各自的参数**（用户 2026-10-03 图三～图十一）。
 *
 * 这一组钉的是「面板选了什么 → 请求体里长什么样」这条链子。它不是锦上添花：
 * 用户在这个项目上反复遇到的正是「面板上摆着、发出去却是另一套 / 根本不发」——
 * 参数面板与请求体必须由**同一个规格**推出来，单测就守在这条缝上。
 */
describe('视频参数 · 按模型分派（用户 2026-10-03 图三～图十一）', () => {
  /** 提交成功 → 立刻完成 + 给一个产物地址，只关心**第一次 POST 的 body** */
  function adapterCapturing(bodies: Record<string, unknown>[]) {
    const platform = createMemoryPlatform({
      /** 参考素材库：图生视频那几档必须真有图可读，否则适配器会**如实报错** */
      rows: {
        assets: [
          { id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
          { id: 'h2', bytes: new Uint8Array([4, 5, 6]), mime: 'image/png' },
        ],
      },
      handler: async (req: NetworkRequest): Promise<NetworkResponse> => {
        if (req.method === 'POST') {
          bodies.push(req.body as Record<string, unknown>)
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        if (req.url.includes('v.mp4')) return json(200, {})
        return json(404, {})
      },
    })
    return createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
  }

  /** 两张上游图：图生视频 / 全能参考 / 首尾帧这几档的必备输入 */
  const twoImages = [
    { kind: 'asset' as const, nodeId: 'n1', assetHash: 'h1', mime: 'image/png' },
    { kind: 'asset' as const, nodeId: 'n2', assetHash: 'h2', mime: 'image/png' },
  ]

  it('★★ 即梦 2.5 走「官方字段名」那套：ratio / resolution / duration / generate_audio / n', async () => {
    const bodies: Record<string, unknown>[] = []
    await adapterCapturing(bodies).generateVideo(
      {
        ...videoRequest,
        model: '即梦 2.5',
        inputs: twoImages,
        params: {
          ratio: '16:9',
          size: '1080P',
          durationSec: 30,
          videoMode: 'image-to-video',
          generateAudio: true,
          count: 2,
        },
      },
      new AbortController().signal,
    )
    expect(bodies[0]).toMatchObject({
      model: '即梦 2.5',
      mode: 'image-to-video',
      ratio: '16:9',
      resolution: '1080P',
      duration: 30,
      generate_audio: true,
      n: 2,
    })
    /** 这一档不发 Agnes 那套字段名，两套混着发才最容易 400 */
    expect(bodies[0]).not.toHaveProperty('seconds')
    expect(bodies[0]).not.toHaveProperty('size')
    expect(bodies[0]).not.toHaveProperty('aspect_ratio')
  })

  it('★ MiniMax H3 Max：只有「自适应」一档画幅 ⇒ 不发 ratio；没有音频开关 ⇒ 不发 generate_audio', async () => {
    const bodies: Record<string, unknown>[] = []
    await adapterCapturing(bodies).generateVideo(
      {
        ...videoRequest,
        model: 'Minimax H3 Max',
        inputs: twoImages,
        params: {
          ratio: 'auto',
          size: '480P',
          durationSec: 15,
          videoMode: 'image-to-video',
          generateAudio: true,
          count: 4,
        },
      },
      new AbortController().signal,
    )
    expect(bodies[0]).toMatchObject({ mode: 'image-to-video', resolution: '480P', duration: 15, n: 4 })
    /** 自适应 = 这次不指定画幅（不是把 'auto' 当宽高比发出去） */
    expect(bodies[0]).not.toHaveProperty('ratio')
    /** 模型没有这个开关就不发 —— 发一个它不认的字段只会换 400 */
    expect(bodies[0]).not.toHaveProperty('generate_audio')
  })

  it('★★ 时长按各模型的区间夹取（即梦 4–30、H3 5–15、Agnes 4–12）', async () => {
    for (const [model, want] of [
      ['即梦 2.5', 30],
      ['MiniMax H3', 15],
      ['Minimax H3 Max', 15],
    ] as const) {
      const bodies: Record<string, unknown>[] = []
      await adapterCapturing(bodies).generateVideo(
        { ...videoRequest, model, params: { ratio: '16:9', size: '1080P', durationSec: 99 } },
        new AbortController().signal,
      )
      expect(bodies[0]!.duration, model).toBe(want)
    }
  })

  it('★★ Agnes Video 2.5 的纯文字起片发 `mode: "text"`（不是 2.0 那套 ti2vid）', async () => {
    const bodies: Record<string, unknown>[] = []
    await adapterCapturing(bodies).generateVideo(
      {
        ...videoRequest,
        model: 'Agnes Video 2.5',
        params: { ratio: '16:9', size: '1080P', durationSec: 6, videoMode: 'text' },
      },
      new AbortController().signal,
    )
    expect(bodies[0]).toMatchObject({ mode: 'text', seconds: '6', size: '1080P', aspect_ratio: '16:9' })
  })

  it('★ Agnes Video 2.5 的「1K / 2K」是真档位，不被压回 720P', async () => {
    for (const size of ['1K', '2K', '1080P', '720P']) {
      const bodies: Record<string, unknown>[] = []
      await adapterCapturing(bodies).generateVideo(
        { ...videoRequest, model: 'agnes-video-2.5', params: { ratio: '16:9', size, durationSec: 5 } },
        new AbortController().signal,
      )
      expect(bodies[0]!.size, size).toBe(size)
    }
  })

  it('★★ 老节点只有 `refMode` 时仍认得出来（不静默退回文生视频）', async () => {
    const bodies: Record<string, unknown>[] = []
    const platform = createMemoryPlatform({
      rows: {
        assets: [
          { id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
          { id: 'h2', bytes: new Uint8Array([4, 5, 6]), mime: 'image/png' },
        ],
      },
      handler: async (req: NetworkRequest): Promise<NetworkResponse> => {
        if (req.method === 'POST') {
          bodies.push(req.body as Record<string, unknown>)
          return json(200, { task_id: 't', video_id: 'v', status: 'queued' })
        }
        if (req.url.includes('/videos/t')) return json(200, { status: 'completed', url: 'https://x/v.mp4' })
        if (req.url.includes('v.mp4')) return json(200, {})
        return json(404, {})
      },
    })
    const adapter = createOpenAiVideoAdapter(config, platform, { sleep: async () => {}, now: () => 0 })
    await adapter.generateVideo(
      {
        ...videoRequest,
        model: 'Agnes Video 2.0',
        inputs: [
          { kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' },
          { kind: 'asset', nodeId: 'n2', assetHash: 'h2', mime: 'image/png' },
        ],
        params: { ratio: '16:9', size: '720p', durationSec: 5, refMode: 'first-last-frame' },
      },
      new AbortController().signal,
    )
    /** 2.0 是像素方言：先发像素那套，且 `mode` 用它认的 `keyframes` */
    expect(bodies[0]).toMatchObject({ mode: 'keyframes' })
    expect(Array.isArray(bodies[0]!.image)).toBe(true)
    expect((bodies[0]!.image as string[]).length).toBe(2)
    /** 首尾帧一定要两张：只连一张时同一张兼作首尾帧，但绝不是一张 */
    expect(bodies[0]).not.toHaveProperty('seconds')
  })
})
