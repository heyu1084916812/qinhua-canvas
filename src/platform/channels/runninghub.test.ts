import { describe, it, expect } from 'vitest'
import { fingerprintBytes } from '../../domain/shared/hash'
import { createMemoryPlatform } from '../../platform/memory'
import type { NetworkRequest, NetworkResponse } from '../../platform/ports'
import {
  createRunningHubAdapter,
  runningHubCapability,
  RUNNINGHUB_ENDPOINT_SPECS,
  RUNNINGHUB_MODELS,
} from './runninghub'
import { ChannelError, type ImageRunRequest, type VideoRunRequest } from './types'
import type { ResolvedChannelConfig } from './registry'
import { presetIdForUpstream } from '../../domain/project/modelPresets'
import { ECOMMERCE_UPSCALE_OPTIONS } from '../../domain/ecommerce/upscale'

/** 真实 PNG 头（`imageSizeFromHeader` 要能读出来，产物才有像素） */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00,
])
const VIDEO_BYTES = new TextEncoder().encode('mock-video-bytes')

function json(status: number, obj: unknown): NetworkResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    async text() {
      return JSON.stringify(obj)
    },
    async json<T>() {
      return obj as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

/** 产物下载那一跳：只有它回二进制 */
function bytes(status: number, data: Uint8Array, mime = 'image/png'): NetworkResponse {
  return {
    status,
    headers: { 'content-type': mime },
    async text() {
      return ''
    },
    async json<T>() {
      return {} as T
    },
    async arrayBuffer() {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    },
  }
}

const config: ResolvedChannelConfig = {
  id: 'c1',
  protocol: 'runninghub-api',
  baseUrl: 'https://www.runninghub.cn',
  credentialRef: null,
  modelCache: [],
  apiKey: 'rh-key',
}

const signal = new AbortController().signal

describe('RunningHub 电商 AI 超清目录', () => {
  it('五项 profile 都映射到真实 image-upscale 端点', () => {
    for (const option of ECOMMERCE_UPSCALE_OPTIONS) {
      const model = RUNNINGHUB_MODELS.find((item) => item.id === option.model)
      expect(model, option.model).toBeDefined()
      const endpoint = model?.textEndpoint
      expect(endpoint, option.model).toBeTruthy()
      const spec = RUNNINGHUB_ENDPOINT_SPECS.find((item) => item.id === endpoint)
      expect(spec, option.model).toMatchObject({
        task: 'image-upscale',
        media: { key: 'imageUrl', type: 'IMAGE', required: true },
        scale: { key: 'scale', options: ['2x', '4x', '6x'] },
      })
    }
  })
})

describe('RunningHub 高质量图像编辑目录', () => {
  it('四个专业图生图模型都映射真实 image-to-image 端点，并声明图片输入', () => {
    for (const [modelId, endpointId, mediaKey] of [
      ['全能图片PRO Ultra（图像编辑）', 'rhart-image-n-pro-official/edit-ultra', 'imageUrls'],
      ['千问 2.0 Pro 图像编辑', 'alibaba/qwen-image-2.0-pro/image-edit', 'imageUrls'],
      ['万相 2.7 图像编辑 Pro', 'alibaba/wan-2.7/image-edit-pro', 'imageUrls'],
      ['Luma Uni-1 Max 图像编辑', 'luma/uni-1-max/image-edit', 'imageUrl'],
    ] as const) {
      const model = RUNNINGHUB_MODELS.find((item) => item.id === modelId)
      expect(model, modelId).toMatchObject({ kind: 'image', textEndpoint: endpointId })
      const spec = RUNNINGHUB_ENDPOINT_SPECS.find((item) => item.id === endpointId)
      expect(spec, endpointId).toMatchObject({
        task: 'image-to-image',
        media: { key: mediaKey, type: 'IMAGE', required: true },
      })
      expect(runningHubCapability(model!).inputTypes).toContain('image')
    }
  })
})

describe('RunningHub 视频超清目录与请求', () => {
  it('视频超清 / 视频编辑模型都映射到真实端点，并声明视频输入', () => {
    for (const [modelId, endpointId, task, mediaKey] of [
      ['Topaz 视频超清', 'topazlabs/video-upscale', 'video-upscale', 'videoUrl'],
      ['RH 视频超分', 'rhart-video/video-upscaler', 'video-upscale', 'videoUrl'],
      ['全能视频X 视频编辑', 'rhart-video-g-official/edit-video', 'video-edit', 'videoUrl'],
      ['Kling O3 Pro 视频编辑', 'kling-video-o3-pro/video-edit', 'video-edit', 'videoUrl'],
      ['Kling O3 Std 视频编辑', 'kling-video-o3-std/video-edit', 'video-edit', 'videoUrl'],
      ['Kling O1 Std 视频编辑', 'kling-video-o1-std/edit-video', 'video-edit', 'videoUrl'],
      ['全能视频 Omni Flash 视频编辑', 'gemini-omni-flash/video-edit', 'video-edit', 'videoUrl'],
      ['HappyHorse 1.0 视频编辑', 'alibaba/happyhorse-1.0/video-edit', 'video-edit', 'videoUrl'],
      [
        '全能视频R Gen4 Aleph 视频编辑',
        'rhart-video-r/gen4-aleph-official/video-to-video',
        'video-edit',
        'videoUrl',
      ],
      ['万相2.7 视频续写', 'alibaba/wan-2.7/video-extend', 'video-extend', 'videoUrl'],
      ['全能视频X 视频续写', 'rhart-video-g-official/video-extend', 'video-extend', 'videoUrl'],
      [
        '全能视频V3.1 Pro 视频扩展',
        'rhart-video-v3.1-pro-official/video-extend',
        'video-extend',
        'video',
      ],
      [
        '全能视频V3.1 Fast 视频扩展',
        'rhart-video-v3.1-fast-official/video-extend',
        'video-extend',
        'video',
      ],
    ] as const) {
      const model = RUNNINGHUB_MODELS.find((item) => item.id === modelId)
      expect(model, modelId).toMatchObject({ kind: 'video', textEndpoint: endpointId })
      const spec = RUNNINGHUB_ENDPOINT_SPECS.find((item) => item.id === endpointId)
      expect(spec, endpointId).toMatchObject({
        task,
        media: { key: mediaKey, type: 'VIDEO', required: true },
      })
      expect(runningHubCapability(model!).inputTypes).toContain('video')
    }
  })

  it('★★ 视频先上传为 videoUrl，再按目录发送 targetResolution / targetFps，产物保持视频 MIME', async () => {
    let uploadedName = ''
    let submitBody: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: {
        assets: [{ id: 'video-source', bytes: VIDEO_BYTES, mime: 'video/mp4' }],
      },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/media/upload/binary')) {
          const form = req.body as FormData
          const file = form.get('file')
          uploadedName = file instanceof File ? file.name : String(file ?? '')
          return json(200, {
            code: 0,
            data: { download_url: 'https://files.runninghub.cn/source.mp4' },
          })
        }
        if (req.url.endsWith('/openapi/v2/topazlabs/video-upscale')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 'video-upscale-task' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/result.mp4' }],
          })
        }
        if (req.url.endsWith('/result.mp4')) return bytes(200, VIDEO_BYTES, 'video/mp4')
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const outputs = await adapter.generateVideo(
      {
        kind: 'video',
        channelId: 'c1',
        model: 'Topaz 视频超清',
        prompt: '',
        inputs: [
          {
            kind: 'asset',
            nodeId: 'video-node',
            assetHash: 'video-source',
            mime: 'video/mp4',
          },
        ],
        params: { resolution: '4k', fps: '60' },
      },
      signal,
    )

    expect(uploadedName).toBe('video.mp4')
    expect(submitBody).toMatchObject({
      videoUrl: 'https://files.runninghub.cn/source.mp4',
      targetResolution: '4k',
      targetFps: '60',
    })
    expect(submitBody).not.toHaveProperty('prompt')
    expect(outputs[0]?.mime).toBe('video/mp4')
  })

  it('★★ 视频编辑把文字指令、输入视频和分辨率送到真实 edit-video 端点', async () => {
    let submitBody: Record<string, unknown> | null = null
    let uploadedName = ''
    const platform = createMemoryPlatform({
      rows: {
        assets: [{ id: 'edit-video-source', bytes: VIDEO_BYTES, mime: 'video/mp4' }],
      },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/media/upload/binary')) {
          const form = req.body as FormData
          const file = form.get('file')
          uploadedName = file instanceof File ? file.name : String(file ?? '')
          return json(200, {
            code: 0,
            data: { download_url: 'https://files.runninghub.cn/edit-source.mp4' },
          })
        }
        if (req.url.endsWith('/openapi/v2/rhart-video-g-official/edit-video')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 'video-edit-task' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/edit-result.mp4' }],
          })
        }
        if (req.url.endsWith('/edit-result.mp4')) {
          return bytes(200, VIDEO_BYTES, 'video/mp4')
        }
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const outputs = await adapter.generateVideo(
      {
        kind: 'video',
        channelId: 'c1',
        model: '全能视频X 视频编辑',
        prompt: '把白天改成雨夜，保持人物动作不变',
        inputs: [
          {
            kind: 'asset',
            nodeId: 'video-node',
            assetHash: 'edit-video-source',
            mime: 'video/mp4',
          },
        ],
        params: { resolution: '720p' },
      },
      signal,
    )

    expect(uploadedName).toBe('video.mp4')
    expect(submitBody).toMatchObject({
      videoUrl: 'https://files.runninghub.cn/edit-source.mp4',
      prompt: '把白天改成雨夜，保持人物动作不变',
      resolution: '720p',
    })
    expect(outputs[0]?.mime).toBe('video/mp4')
  })

  it('★★ Kling O3 Pro 视频编辑不发送清晰度，按官方默认保持原声', async () => {
    let submitBody: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: {
        assets: [{ id: 'kling-edit-source', bytes: VIDEO_BYTES, mime: 'video/mp4' }],
      },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/media/upload/binary')) {
          return json(200, {
            code: 0,
            data: { download_url: 'https://files.runninghub.cn/kling-edit-source.mp4' },
          })
        }
        if (req.url.endsWith('/openapi/v2/kling-video-o3-pro/video-edit')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 'kling-video-edit-task' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/kling-edit-result.mp4' }],
          })
        }
        if (req.url.endsWith('/kling-edit-result.mp4')) {
          return bytes(200, VIDEO_BYTES, 'video/mp4')
        }
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const outputs = await adapter.generateVideo(
      {
        kind: 'video',
        channelId: 'c1',
        model: 'Kling O3 Pro 视频编辑',
        prompt: '保留人物动作，把服装替换为图里的款式',
        inputs: [
          {
            kind: 'asset',
            nodeId: 'video-node',
            assetHash: 'kling-edit-source',
            mime: 'video/mp4',
          },
        ],
        params: {},
      },
      signal,
    )

    expect(submitBody).toMatchObject({
      videoUrl: 'https://files.runninghub.cn/kling-edit-source.mp4',
      prompt: '保留人物动作，把服装替换为图里的款式',
      keepOriginalSound: true,
    })
    expect(submitBody).not.toHaveProperty('resolution')
    expect(outputs[0]?.mime).toBe('video/mp4')
  })

  it('★★ Gemini Omni Flash 同时声明图片与视频时，仍以必填视频为输入槽并发送真实清晰度', async () => {
    let submitBody: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: {
        assets: [{ id: 'omni-edit-source', bytes: VIDEO_BYTES, mime: 'video/mp4' }],
      },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/media/upload/binary')) {
          return json(200, {
            code: 0,
            data: { download_url: 'https://files.runninghub.cn/omni-edit-source.mp4' },
          })
        }
        if (req.url.endsWith('/openapi/v2/gemini-omni-flash/video-edit')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 'omni-video-edit-task' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/omni-edit-result.mp4' }],
          })
        }
        if (req.url.endsWith('/omni-edit-result.mp4')) {
          return bytes(200, VIDEO_BYTES, 'video/mp4')
        }
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const outputs = await adapter.generateVideo(
      {
        kind: 'video',
        channelId: 'c1',
        model: '全能视频 Omni Flash 视频编辑',
        prompt: '把画面改成雨夜，保持人物动作不变',
        inputs: [
          {
            kind: 'asset',
            nodeId: 'video-node',
            assetHash: 'omni-edit-source',
            mime: 'video/mp4',
          },
        ],
        params: { resolution: '4k' },
      },
      signal,
    )

    expect(submitBody).toMatchObject({
      videoUrl: 'https://files.runninghub.cn/omni-edit-source.mp4',
      prompt: '把画面改成雨夜，保持人物动作不变',
      resolution: '4k',
    })
    expect(submitBody).not.toHaveProperty('imageUrls')
    expect(outputs[0]?.mime).toBe('video/mp4')
  })

  it('★★ 视频续写把输入视频、清晰度与新增时长送到真实 video-extend 端点', async () => {
    let submitBody: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: {
        assets: [{ id: 'extend-video-source', bytes: VIDEO_BYTES, mime: 'video/mp4' }],
      },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/media/upload/binary')) {
          return json(200, {
            code: 0,
            data: { download_url: 'https://files.runninghub.cn/extend-source.mp4' },
          })
        }
        if (req.url.endsWith('/openapi/v2/alibaba/wan-2.7/video-extend')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 'video-extend-task' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/extend-result.mp4' }],
          })
        }
        if (req.url.endsWith('/extend-result.mp4')) {
          return bytes(200, VIDEO_BYTES, 'video/mp4')
        }
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const outputs = await adapter.generateVideo(
      {
        kind: 'video',
        channelId: 'c1',
        model: '万相2.7 视频续写',
        prompt: '人物继续向前走，镜头缓慢跟随',
        inputs: [
          {
            kind: 'asset',
            nodeId: 'video-node',
            assetHash: 'extend-video-source',
            mime: 'video/mp4',
          },
        ],
        params: { resolution: '1080P', duration: 8 },
      },
      signal,
    )

    expect(submitBody).toMatchObject({
      videoUrl: 'https://files.runninghub.cn/extend-source.mp4',
      prompt: '人物继续向前走，镜头缓慢跟随',
      resolution: '1080P',
      duration: '8',
    })
    expect(outputs[0]?.mime).toBe('video/mp4')
  })

  it('★★ 新增续写端点只发送各自声明的参数，不夹带另一档', async () => {
    const cases = [
      {
        model: '全能视频X 视频续写',
        endpoint: '/openapi/v2/rhart-video-g-official/video-extend',
        mediaKey: 'videoUrl',
        params: { duration: 10 },
        expected: { duration: '10' },
        absent: 'resolution',
      },
      {
        model: '全能视频V3.1 Pro 视频扩展',
        endpoint: '/openapi/v2/rhart-video-v3.1-pro-official/video-extend',
        mediaKey: 'video',
        params: { resolution: '1080p' },
        expected: { resolution: '1080p' },
        absent: 'duration',
      },
    ] as const

    for (const item of cases) {
      let submitBody: Record<string, unknown> | null = null
      const platform = createMemoryPlatform({
        rows: {
          assets: [{ id: 'extend-source', bytes: VIDEO_BYTES, mime: 'video/mp4' }],
        },
        handler: async (req: NetworkRequest) => {
          if (req.url.endsWith('/openapi/v2/media/upload/binary')) {
            return json(200, {
              code: 0,
              data: { download_url: 'https://files.runninghub.cn/new-extend-source.mp4' },
            })
          }
          if (req.url.endsWith(item.endpoint)) {
            submitBody = req.body as Record<string, unknown>
            return json(200, { code: 0, taskId: 'new-extend-task' })
          }
          if (req.url.endsWith('/openapi/v2/query')) {
            return json(200, {
              status: 'SUCCESS',
              results: [{ url: 'https://files.runninghub.cn/new-extend-result.mp4' }],
            })
          }
          if (req.url.endsWith('/new-extend-result.mp4')) {
            return bytes(200, VIDEO_BYTES, 'video/mp4')
          }
          return json(200, {})
        },
      })
      const adapter = createRunningHubAdapter(config, platform, FAST)
      const outputs = await adapter.generateVideo(
        {
          kind: 'video',
          channelId: 'c1',
          model: item.model,
          prompt: '人物继续向前走，镜头缓慢跟随',
          inputs: [
            {
              kind: 'asset',
              nodeId: 'video-node',
              assetHash: 'extend-source',
              mime: 'video/mp4',
            },
          ],
          params: item.params,
        },
        signal,
      )
      expect(submitBody, item.model).toMatchObject({
        [item.mediaKey]: 'https://files.runninghub.cn/new-extend-source.mp4',
        prompt: '人物继续向前走，镜头缓慢跟随',
        ...item.expected,
      })
      expect(submitBody).not.toHaveProperty(item.absent)
      expect(outputs[0]?.mime).toBe('video/mp4')
    }
  })
})

const imageRequest = (model: string, inputs: ImageRunRequest['inputs'] = []): ImageRunRequest => ({
  kind: 'image',
  channelId: 'c1',
  model,
  prompt: '一只橘猫',
  inputs,
  params: { ratio: '1:1', resolution: '2k' },
})

/** 一轮就出结果（不真等 5 秒：轮询节奏与等待都注入掉） */
const FAST = { sleep: async () => {}, pollIntervalMs: 0 }

describe('RunningHub 适配器 / 标准模型（金额路）', () => {
  it('★ 提交 → 轮询 → 下载产物（官方 v2 端点形状）', async () => {
    const calls: { method: string; url: string; body: unknown }[] = []
    let polls = 0
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push({ method: req.method ?? 'GET', url: req.url, body: req.body })
        if (req.url.endsWith('/openapi/v2/query')) {
          polls += 1
          /** 第一轮还在跑：验证它真的会继续轮询，而不是拿 RUNNING 当结果 */
          if (polls === 1) return json(200, { status: 'RUNNING' })
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/a.png', outputType: 'png' }],
          })
        }
        if (req.url.endsWith('/openapi/v2/rhart-image-g-2/text-to-image')) {
          return json(200, { code: 0, taskId: 't1' })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })

    const adapter = createRunningHubAdapter(config, platform, FAST)
    const assets = await adapter.generateImage(
      imageRequest('GPT Image 2'),
      signal,
    )

    expect(polls).toBe(2)
    expect(assets).toHaveLength(1)
    /** hash 是 `await fingerprintBytes` 算出来的：算错/漏 await 这里立刻红 */
    expect(assets[0]!.hash).toBe(await fingerprintBytes(PNG_BYTES))
    expect(assets[0]!.mime).toBe('image/png')
    const submit = calls.find((c) => c.url.endsWith('/rhart-image-g-2/text-to-image'))!
    expect(submit.method).toBe('POST')
    expect(submit.body).toMatchObject({
      prompt: '一只橘猫',
      aspectRatio: '1:1',
      resolution: '2k',
    })
  })

  it('★★ Topaz 图像超清走真实端点：imageUrl + scale，不发送无关 prompt', async () => {
    let submitBody: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: {
        assets: [{ id: 'topaz-image', bytes: PNG_BYTES, mime: 'image/png' }],
      },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/topaz.png' }],
          })
        }
        if (req.url.endsWith('/openapi/v2/topazlabs/image-upscale-standard-v2')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 'topaz-task' })
        }
        if (req.url.endsWith('/topaz.png')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const outputs = await adapter.generateImage(
      {
        ...imageRequest('Topaz 图像超清 Standard', [
          {
            kind: 'asset',
            nodeId: 'topaz-node',
            assetHash: 'topaz-image',
            mime: 'image/png',
          },
        ]),
        params: { count: 1, scale: '4x' },
      },
      signal,
    )

    expect(outputs[0]?.mime).toBe('image/png')
    expect(submitBody).toMatchObject({ scale: '4x' })
    expect(submitBody).not.toHaveProperty('prompt')
    const image = (submitBody as unknown as { imageUrl: string }).imageUrl
    expect(image.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('任务终态 FAILED → 带上服务端原话（含 812 的充值 / 币路指引）', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'FAILED',
            errorCode: '812',
            errorMessage: '企业版余额不足',
          })
        }
        return json(200, { code: 0, taskId: 't1' })
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const err = await adapter
      .generateImage(imageRequest('GPT Image 2'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err!.appError).toMatchObject({ kind: 'http' })
    const body = 'body' in err!.appError ? String(err!.appError.body) : ''
    expect(body).toContain('企业版余额不足')
    expect(body).toContain('充值')
    expect(body).toContain('app:')
  })

  it('服务端的参数校验错误（1007）翻成人话：问题在参数上，不是网络也不是 Key', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, { status: 'SUCCESS', results: [{ url: 'https://files.runninghub.cn/a.png' }] })
        }
        return json(200, {
          errorCode: '1007',
          errorMessage: "field 'prompt' length 3 is less than the minimum length 5",
        })
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const err = await adapter
      .generateImage(imageRequest('GPT Image 2'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err).toBeInstanceOf(ChannelError)
    const body = 'body' in err!.appError ? String(err!.appError.body) : ''
    expect(body).toContain('参数没通过服务端校验')
    /** 服务端原话照留：它才是唯一说得出"差在哪儿"的那句 */
    expect(body).toContain('minimum length 5')
  })

  it('不认识模型 → channel/missingModel；没填 Key → channel/missingKey', async () => {
    const platform = createMemoryPlatform({ handler: async () => json(200, {}) })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await expect(adapter.generateImage(imageRequest('这个模型不存在'), signal)).rejects.toThrow(
      ChannelError,
    )

    const noKey = createRunningHubAdapter({ ...config, apiKey: null }, platform, FAST)
    const err = await noKey
      .generateImage(imageRequest('GPT Image 2'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err!.appError).toEqual({ kind: 'channel', detail: 'missingKey' })
  })

  it('参考图 < 5MB 内联成 data URI（不走上传）', async () => {
    let submitBody: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/a.png' }],
          })
        }
        if (req.url.endsWith('/media/upload/binary')) {
          throw new Error('小图不该走上传')
        }
        if (req.url.includes('/rhart-image-g-3/image-to-image')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 't1' })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await adapter.generateImage(
      imageRequest('全能图片X-3（图生图）', [
        { kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' },
      ]),
      signal,
    )
    /**
     * ⚠️ `rhart-image-g-3/image-to-image` 的 `imageUrls` 在官方目录里**没有 `multiple`**
     * ⇒ 收的是**单值**。适配器早先写死"永远发数组"，正是这一批按目录修掉的。
     */
    const image = (submitBody as unknown as { imageUrls: string }).imageUrls
    expect(typeof image).toBe('string')
    expect(image.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('★★ 数字人口播把图片与音频分别上传，并写进 imageUrl / audioUrl', async () => {
    let submitBody: Record<string, unknown> | null = null
    const uploads: string[] = []
    const videoBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])
    const platform = createMemoryPlatform({
      rows: {
        assets: [
          { id: 'avatar-image', bytes: PNG_BYTES, mime: 'image/png' },
          { id: 'avatar-audio', bytes: new Uint8Array([82, 73, 70, 70]), mime: 'audio/wav' },
        ],
      },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/avatar.mp4' }],
          })
        }
        if (req.url.endsWith('/media/upload/binary')) {
          const file = (req.body as FormData).get('file') as File
          uploads.push(file.name)
          return json(200, {
            code: 0,
            data: { download_url: `https://files.runninghub.cn/${file.name}` },
          })
        }
        if (
          req.url.endsWith(
            '/openapi/v2/kling-v2-ai-avatar-standard/image-audio-to-video',
          )
        ) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 'avatar-task' })
        }
        if (req.url.endsWith('/avatar.mp4')) {
          return bytes(200, videoBytes, 'video/mp4')
        }
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const request: VideoRunRequest = {
      kind: 'video',
      channelId: 'c1',
      model: 'Kling V2 数字人口播 Std',
      prompt: '保持人物与画面一致，口型自然同步',
      inputs: [
        {
          kind: 'asset',
          nodeId: 'img-node',
          assetHash: 'avatar-image',
          mime: 'image/png',
        },
        {
          kind: 'asset',
          nodeId: 'audio-node',
          assetHash: 'avatar-audio',
          mime: 'audio/wav',
        },
      ],
      params: {},
    }
    const assets = await adapter.generateVideo(request, signal)

    expect(uploads).toEqual(['ref.png', 'audio.wav'])
    expect(submitBody).toMatchObject({
      prompt: '保持人物与画面一致，口型自然同步',
      imageUrl: 'https://files.runninghub.cn/ref.png',
      audioUrl: 'https://files.runninghub.cn/audio.wav',
    })
    expect(assets[0]?.mime).toBe('video/mp4')
  })
})

describe('RunningHub 适配器 / AI 应用（币路）', () => {
  it('★ 拉节点 → 填 prompt → ai-app/run → 轮询 → 产物', async () => {
    const calls: string[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(req.url)
        if (req.url.includes('/api/webapp/apiCallDemo')) {
          return json(200, {
            code: 0,
            data: {
              nodeInfoList: [
                { nodeId: 18, fieldName: 'prompt', fieldType: 'STRING', fieldValue: '' },
                { nodeId: 19, fieldName: 'aspectRatio', fieldType: 'STRING', fieldValue: '1:1' },
              ],
            },
          })
        }
        if (req.url.endsWith('/task/openapi/ai-app/run')) {
          return json(200, { code: 0, data: { taskId: 'app-task-1' } })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/b.png' }],
          })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const assets = await adapter.generateImage(imageRequest('app:2046794551444119554'), signal)

    expect(assets).toHaveLength(1)
    /** 应用路走的是 `/task/openapi/ai-app/run`，不是标准模型的 v2 端点 */
    expect(calls.some((u) => u.endsWith('/task/openapi/ai-app/run'))).toBe(true)
    expect(calls.some((u) => u.includes('/api/webapp/apiCallDemo'))).toBe(true)
  })

  it('应用没有可改节点 → 报上游的话，而不是假装成功', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.includes('/api/webapp/apiCallDemo')) {
          return json(200, { code: 0, data: { nodeInfoList: [] } })
        }
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const err = await adapter
      .generateImage(imageRequest('app:1'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err!.appError.kind).toBe('http')
  })
})

describe('RunningHub 适配器 / verify 与模型清单', () => {
  it('verify 打 accountStatus，成功则带出端点模型', async () => {
    const calls: string[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(req.url)
        if (req.url.endsWith('/uc/openapi/accountStatus')) {
          return json(200, { code: 0, data: { remainCoins: '473', apiType: 'SHARED' } })
        }
        return json(200, { code: 0, data: { records: [] } })
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const r = await adapter.verify(config, signal)
    expect(calls[0]!.endsWith('/uc/openapi/accountStatus')).toBe(true)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.models.length).toBeGreaterThanOrEqual(RUNNINGHUB_MODELS.length)
  })

  it('Key 不认账 → ok:false，且消息带服务端原话', async () => {
    const platform = createMemoryPlatform({
      handler: async () => json(200, { code: 401, msg: 'APIKEY 校验失败' }),
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const r = await adapter.verify(config, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('APIKEY')
  })

  it('应用列表拉不到（非 JSON）→ 仍然给出端点模型，验证不失败', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/uc/openapi/accountStatus')) return json(200, { code: 0 })
        return {
          status: 200,
          headers: {},
          async text() {
            return '<html>502 Bad Gateway</html>'
          },
          async json<T>() {
            return {} as T
          },
          async arrayBuffer() {
            return new ArrayBuffer(0)
          },
        }
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const models = await adapter.listModels(config, signal)
    expect(models.length).toBe(RUNNINGHUB_MODELS.length)
  })

  it('没有对话能力（RunningHub 就不做 chat）', async () => {
    const platform = createMemoryPlatform({ handler: async () => json(200, {}) })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await expect(
      adapter.completeText(
        { kind: 'text', channelId: 'c1', model: 'x', prompt: 'hi', inputs: [], params: {} },
        signal,
      ),
    ).rejects.toThrow(ChannelError)
  })
})
describe('RunningHub 适配器 / 模型表与端点规格（按官方目录建的请求体）', () => {
  it('★ 模型表自洽：每个模型的端点都在规格表里，规格 id 不重复', () => {
    const specIds = RUNNINGHUB_ENDPOINT_SPECS.map((s) => s.id)
    expect(new Set(specIds).size).toBe(specIds.length)
    expect(RUNNINGHUB_MODELS.length).toBeGreaterThan(10)
    for (const model of RUNNINGHUB_MODELS) {
      expect(specIds).toContain(model.textEndpoint)
      if (model.imageEndpoint) expect(specIds).toContain(model.imageEndpoint)
    }
  })

  it('★★ 有前端显示名对应的模型，id 就**是**那个显示名（挂错名 = 界面上选得到、发出去找不到渠道）', () => {
    /**
     * 口径（用户 2026-10-08 拍板，对账 #371）：画布下拉**只列前端显示名**。
     * 所以渠道要能被选到，它的模型 id 就必须是那个显示名 —— 选路认两种提供方式
     * （渠道模型列表里有这个显示名，或该渠道映射表里有这一行，见 `routeCandidatesFor`）。
     *
     * 挂名的依据是**官方 CLI 自己写的**：
     * 「香蕉Pro同款」「香蕉2同款」「Midjourney 风格」「GPT Image 2 同款」。
     * 反过来，剩下几个官方目录名在前端清单里**没有位置**（Seedream v5 / 千问 / 即梦 /
     * X-3 / PRO官方版 + 8 个视频），它们保留自己的名字：渠道里照常勾选、映射、选路，
     * 只是不会出现在画布下拉里（这是那个口径的直接代价，想要就先加进清单）。
     */
    const ids = RUNNINGHUB_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const name of ['Nano Banana Pro', 'Nano Banana 2', 'Midjourney', 'GPT Image 2']) {
      expect(ids).toContain(name)
      /** 这四个必须真能被固定清单认领 —— 认不出就说明名字挂错了 */
      expect(presetIdForUpstream(name)).toBe(name)
    }
    expect(presetIdForUpstream('Seedream v5')).toBe('Seedream v5')
  })

  it('★ 只认模型表里的显示名：裸端点 id（`endpoint:…`）不再认（用户 2026-10-08 拍板去掉这条兼容路）', async () => {
    const platform = createMemoryPlatform({
      handler: async () => {
        throw new Error('不该发请求：裸端点 id 应该被挡在本地')
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const err = await adapter
      .generateImage(imageRequest('endpoint:rhart-image-g-2/text-to-image'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err!.appError).toEqual({ kind: 'channel', detail: 'missingModel' })
  })

  it('★★ 有参考图就自动走图生档（同一个模型 id，打到两个不同端点）', async () => {
    const urls: string[] = []
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        urls.push(req.url)
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, { status: 'SUCCESS', results: [{ url: 'https://files.runninghub.cn/a.png' }] })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, { code: 0, taskId: 't1' })
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const model = 'GPT Image 2'

    await adapter.generateImage(imageRequest(model), signal)
    await adapter.generateImage(
      imageRequest(model, [{ kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' }]),
      signal,
    )

    expect(urls.some((u) => u.endsWith('/openapi/v2/rhart-image-g-2/text-to-image'))).toBe(true)
    expect(urls.some((u) => u.endsWith('/openapi/v2/rhart-image-g-2/image-to-image'))).toBe(true)
  })

  it('★★ 必填参数的官方默认值会自动补上（不补的话这个端点必然被拒）', async () => {
    let body: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array([9]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        if (req.url.includes('n-pro-official/edit')) {
          body = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 't1' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, { status: 'SUCCESS', results: [{ url: 'https://files.runninghub.cn/a.png' }] })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const request = (params: Record<string, unknown>) => ({
      kind: 'image' as const,
      channelId: 'c1',
      model: '全能图片PRO（图生图·官方稳定版）',
      prompt: '一只橘猫',
      inputs: [{ kind: 'asset' as const, nodeId: 'n1', assetHash: 'h1', mime: 'image/png' }],
      params,
    })

    /** ① 界面没给这一档 ⇒ 补官方默认值（目录里 `resolution` 必填、默认 1k） */
    await adapter.generateImage(request({}), signal)
    expect((body as unknown as { resolution?: string }).resolution).toBe('1k')
    /** `imageUrls` 在目录里带 `multiple` ⇒ 发数组 */
    expect(Array.isArray((body as unknown as { imageUrls?: string[] }).imageUrls)).toBe(true)

    /** ② 用户选过的档位优先于默认值（2k 在该端点的可选项里） */
    await adapter.generateImage(request({ resolution: '2k' }), signal)
    expect((body as unknown as { resolution?: string }).resolution).toBe('2k')
  })

  it('★★ 必填参考图缺失时当场报「参考图」，不等服务端回一句看不懂的 4xx', async () => {
    const platform = createMemoryPlatform({ handler: async () => json(200, { code: 0, taskId: 't1' }) })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const err = await adapter
      .generateImage(imageRequest('全能图片X-3（图生图）'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err!.appError).toEqual({
      kind: 'validation',
      field: '参考图',
      reason: '这个模型必须带一张参考图（把图片 / 生成节点连到它左边）',
    })
  })

  it('★★ 端点不认的档位不发（发出去只会换来一句服务端报错），此时用官方默认值兜底', async () => {
    let body: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.includes('video-v3.1-fast/text-to-video')) {
          body = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 't1' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, { status: 'SUCCESS', results: [{ url: 'https://files.runninghub.cn/v.mp4' }] })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await adapter.generateVideo(
      {
        kind: 'video',
        channelId: 'c1',
        model: '全能视频V3.1 Fast',
        prompt: '一只橘猫',
        inputs: [],
        /** 21:9 不在该端点的比例档里（它只认 16:9 / 9:16）；12 秒也不在它的时长档里（只有 8） */
        params: { ratio: '21:9', duration: 12 },
      },
      signal,
    )
    const payload = body as unknown as Record<string, unknown>
    expect('duration' in payload).toBe(false)
    /** 比例没发出去 ⇒ 由 `requiredDefaults` 补官方默认（16:9 是图生档默认，文生档是 9:16） */
    expect(payload.aspectRatio).toBe('9:16')
  })

  it('★ 视频档的参考图走**上传**（官方 media.py 对视频是 force_upload），且必填布尔值补默认', async () => {
    const urls: string[] = []
    let body: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        urls.push(req.url)
        if (req.url.endsWith('/media/upload/binary')) {
          return json(200, { code: 0, data: { download_url: 'https://files.runninghub.cn/up.png' } })
        }
        if (req.url.includes('video-v3.1-fast/image-to-video')) {
          body = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 't1' })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, { status: 'SUCCESS', results: [{ url: 'https://files.runninghub.cn/v.mp4' }] })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await adapter.generateVideo(
      {
        kind: 'video',
        channelId: 'c1',
        model: '全能视频V3.1 Fast',
        prompt: '一只橘猫在动',
        inputs: [{ kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' }],
        params: {},
      },
      signal,
    )
    expect(urls.some((u) => u.endsWith('/media/upload/binary'))).toBe(true)
    const payload = body as unknown as Record<string, unknown>
    /** 图生档收多值（目录里带 multiple） */
    expect(payload.imageUrls).toEqual(['https://files.runninghub.cn/up.png'])
    /** `resolution` 在这个端点上是必填（默认 720p） */
    expect(payload.resolution).toBe('720p')
  })
})
