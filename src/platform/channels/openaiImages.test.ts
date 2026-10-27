import { describe, it, expect, vi } from 'vitest'
import {
  createOpenAiImagesAdapter,
  customImageSize,
  normalizeBaseUrl,
  openAiImageSize,
  openAiImageQuality,
} from './openaiImages'
import { createMemoryNetwork, createMemoryPlatform } from '../../platform/memory'
import { solidPng } from './mockPng'
import type { ResolvedChannelConfig } from './registry'
import { ChannelError, type ImageRunRequest } from './types'
import { CHAT_IMAGE_MAX_BYTES, MODEL_IMAGE_MIME } from './chatImageInput'
import { IMAGE_GENERATE_TIMEOUT_MS } from './openaiCommon'

/** 测试用的 b64 编码（`btoa` 不接受 Uint8Array，逐字节转字符串） */
function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function resp(status: number, obj: unknown) {
  return {
    status,
    headers: {},
    async text() {
      return JSON.stringify(obj)
    },
    async json<T>(): Promise<T> {
      return obj as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

const cfg: ResolvedChannelConfig = {
  id: 'c',
  protocol: 'openai-images',
  baseUrl: 'https://x',
  credentialRef: null,
  modelCache: [],
  apiKey: 'k',
}

const signal = new AbortController().signal

const request = (
  inputs: ImageRunRequest['inputs'],
  count = 1,
  params: Record<string, unknown> = {},
): ImageRunRequest => ({
  kind: 'image',
  channelId: 'c',
  model: 'gpt-image-2',
  prompt: 'a cat',
  inputs,
  params: { count, ...params },
})

/** 只放行指定端点，其余回 200 空——用来断言「到底打了哪个端点」 */
function networkSeeing(url: string, calls: { url: string; body: unknown }[]) {
  return createMemoryNetwork({
    handler: async (req) => {
      calls.push({ url: req.url, body: req.body })
      if (req.url.endsWith(url)) return resp(200, { data: [{ b64_json: btoa('fakepng') }] })
      return resp(200, { data: [] })
    },
  })
}

function platformWithAssets(assets: { id: string; bytes: Uint8Array; mime: string }[]) {
  return createMemoryPlatform({ rows: { assets } })
}

describe('openaiImages adapter / 基础契约', () => {
  it('★ 模型能力表包含 2K 与 4K（面板清晰度档位的单一事实来源）', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(200, { data: [{ id: 'gpt-image-2' }] }) })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const model = r.models[0]
    expect(model?.resolutions).toContain('2k')
    expect(model?.resolutions).toContain('4k')
  })

  it('verify 成功返回模型', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(200, { data: [{ id: 'gpt-image-2' }] }) })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.models[0]?.id).toBe('gpt-image-2')
  })

  it('verify 401 → channel missingKey 错误', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(401, {}) })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('channel')
      if (r.error.kind === 'channel') expect(r.error.detail).toBe('missingKey')
    }
  })

  /**
   * ★ 403 不再一律断言成「Key 无效」，而且**服务端原话必须传上来**。
   *
   * 403 的成因远不止一种：模型没开通、额度用尽、IP 不在白名单、渠道被禁用，
   * 中转站都回 403，真正的原因写在响应体里（`{"error":{"message":"..."}}`）。
   * 此前适配器只把状态码交给 classifyError、body 直接丢掉，界面只剩「HTTP 403」——
   * 用户拿着这三个字符无从排查（2026-09-18 实测）。
   */
  it('★ verify 403 → 保留状态码与响应体，文案带出服务端原因', async () => {
    const net = createMemoryNetwork({
      handler: async () => resp(403, { error: { message: 'model gpt-image-2 is not allowed for this key' } }),
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // 不再被归成 missingKey —— 那是 401 的语义
      expect(r.error.kind).toBe('http')
      if (r.error.kind === 'http') {
        expect(r.error.status).toBe(403)
        expect(r.error.body).toContain('is not allowed')
      }
      expect(r.message).toContain('is not allowed')
    }
  })

  it('★ 生图 403 → 抛出的错误同样带着服务端原因（这是用户最常撞上 403 的地方）', async () => {
    const net = createMemoryNetwork({
      handler: async () => resp(403, { error: { message: 'insufficient quota' } }),
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    await expect(a.generateImage(request([]), signal)).rejects.toMatchObject({
      appError: { kind: 'http', status: 403 },
    })
  })

  it('verify：200 但不是模型列表（SPA 兜底页 / 登录页）→ 判失败，否则「任何地址都命中」', async () => {
    const htmlPage = {
      status: 200,
      headers: {},
      async text() {
        return '<!doctype html><html></html>'
      },
      async json<T>(): Promise<T> {
        throw new Error('not json')
      },
      async arrayBuffer() {
        return new ArrayBuffer(0)
      },
    }
    const net = createMemoryNetwork({ handler: async () => htmlPage })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('模型列表')
  })

  it('verify：空模型列表仍是成功（上游没模型 ≠ 这不是该协议的接口）', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(200, { data: [] }) })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.models).toEqual([])
  })

  it('generateImage b64_json → 解析出字节（文生图路径）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/generations', calls),
      assets: platformWithAssets([]).assets,
    })
    const assets = await a.generateImage(request([]), signal)
    expect(assets).toHaveLength(1)
    expect(new TextDecoder().decode(assets[0]!.bytes)).toBe('fakepng')
    expect(calls[0]!.url).toBe('https://x/v1/images/generations')
    // 无图像输入时请求体仍是普通 JSON（与 M6-12 前完全一致，零回归）
    expect(calls[0]!.body).toMatchObject({ model: 'gpt-image-2', prompt: 'a cat', n: 1 })
  })

  it('★★ 4K 长任务使用 5 分钟图片超时，不在 120 秒误杀', async () => {
    let timeoutMs = 0
    const net = createMemoryNetwork({
      handler: async (req) => {
        timeoutMs = req.timeoutMs ?? 0
        return resp(200, { data: [{ b64_json: btoa('fakepng') }] })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, {
      network: net,
      assets: platformWithAssets([]).assets,
    })
    await a.generateImage(request([], 1, { resolution: '4K' }), signal)
    expect(timeoutMs).toBe(IMAGE_GENERATE_TIMEOUT_MS)
    expect(timeoutMs).toBeGreaterThan(120_000)
  })

  it('★★ SoonStudio 生图请求 URL 产物并下载原始字节，不等待 4K Base64 JSON', async () => {
    const tiny = solidPng(4, 3, [0x11, 0x22, 0x33])
    const calls: { url: string; body: unknown }[] = []
    const soonCfg: ResolvedChannelConfig = { ...cfg, protocol: 'soonstudio', baseUrl: 'https://soonstudio.ai' }
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
          return resp(200, { task_id: 'task_image_123' })
        }
        if (req.url === 'https://soonstudio.ai/v1/images/tasks/task_image_123') {
          return resp(200, {
            data: {
              status: 'SUCCESS',
              data: {
                url: [
                  `data:image/png;base64,${btoa('fallback-data-uri')}`,
                  'https://cdn.example/result.png',
                ],
              },
            },
          })
        }
        if (req.url === 'https://cdn.example/result.png') {
          const bytes = new Uint8Array(tiny)
          return {
            status: 200,
            headers: { 'content-type': 'image/png' },
            async text() {
              return ''
            },
            async json<T>(): Promise<T> {
              throw new Error('not json')
            },
            async arrayBuffer() {
              return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
            },
          }
        }
        return resp(404, {})
      },
    })
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: net,
      assets: platformWithAssets([]).assets,
    })
    const assets = await a.generateImage(
      request([], 1, { ratio: '16:9', resolution: '4K', quality: 'high' }),
      signal,
    )

    expect(calls[0]!.url).toBe('https://soonstudio.ai/v1/images/generations?async=true')
    expect(calls[0]!.body).toMatchObject({
      model: 'gpt-image-2',
      response_format: 'url',
      size: '3840x2160',
    })
    expect(calls[0]!.body).not.toHaveProperty('aspect_ratio')
    expect(calls[0]!.body).not.toHaveProperty('image_size')
    expect(calls[1]!.url).toBe('https://soonstudio.ai/v1/images/tasks/task_image_123')
    expect(calls[2]!.url).toBe('https://cdn.example/result.png')
    expect(assets).toHaveLength(1)
    expect(assets[0]!.bytes).toEqual(tiny)
  })

  it.each(['cors', 'dns', 'tls', 'timeout'] as const)(
    'SoonStudio submission %s sends one POST and ends as accepted',
    async (detail) => {
    let submitPosts = 0
    const soonCfg: ResolvedChannelConfig = {
      ...cfg,
      protocol: 'soonstudio',
      baseUrl: 'https://soonstudio.ai',
    }
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.method === 'POST') {
            submitPosts += 1
            throw { kind: 'network', detail, sendPhase: 'unknown' }
          }
          return resp(404, {})
        },
      }),
      assets: platformWithAssets([]).assets,
    })

    await expect(
      a.generateImage(request([], 1, { ratio: '16:9', resolution: '4K' }), signal),
    ).rejects.toMatchObject({
      appError: { kind: 'execution', detail: 'accepted' },
    })
    expect(submitPosts).toBe(1)
    },
  )

  it('SoonStudio submission 503 sends one POST and ends as accepted', async () => {
    let submitPosts = 0
    const soonCfg: ResolvedChannelConfig = {
      ...cfg,
      protocol: 'soonstudio',
      baseUrl: 'https://soonstudio.ai',
    }
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.method === 'POST') {
            submitPosts += 1
            throw { kind: 'http', status: 503, body: 'temporarily unavailable' }
          }
          return resp(404, {})
        },
      }),
      assets: platformWithAssets([]).assets,
    })

    await expect(
      a.generateImage(request([], 1, { ratio: '16:9', resolution: '4K' }), signal),
    ).rejects.toMatchObject({
      appError: { kind: 'execution', detail: 'accepted' },
    })
    expect(submitPosts).toBe(1)
  })

  it('normal image submission 503 sends one POST and ends as accepted', async () => {
    let submitPosts = 0
    const net = createMemoryNetwork({
      handler: async (req) => {
        if (req.method === 'POST') {
          submitPosts += 1
          throw { kind: 'http', status: 503, body: 'service temporarily unavailable' }
        }
        return resp(404, {})
      },
    })
    const a = createOpenAiImagesAdapter(cfg, {
      network: net,
      assets: platformWithAssets([]).assets,
    })

    await expect(
      a.generateImage(request([], 1, { ratio: '16:9', resolution: '4K' }), signal),
    ).rejects.toMatchObject({
      appError: { kind: 'execution', detail: 'accepted' },
    })
    expect(submitPosts).toBe(1)
  })

  it.each(['cors', 'timeout'] as const)(
    '★★ SoonStudio 轮询遇到 %s 时继续查询，下一次成功仍返回图片',
    async (detail) => {
    const tiny = solidPng(4, 3, [0x11, 0x22, 0x33])
    const soonCfg: ResolvedChannelConfig = { ...cfg, protocol: 'soonstudio', baseUrl: 'https://soonstudio.ai' }
    let polls = 0
    let submitPosts = 0
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
            submitPosts += 1
            return resp(200, { task_id: 'task_retry_456' })
          }
          if (req.url === 'https://soonstudio.ai/v1/images/tasks/task_retry_456') {
            polls += 1
            if (polls === 1) throw { kind: 'network', detail, sendPhase: 'unknown' }
            return resp(200, {
              data: {
                status: 'SUCCESS',
                data: { url: [`data:image/png;base64,${btoa('fallback')}`, 'https://cdn.example/retry.png'] },
              },
            })
          }
          if (req.url === 'https://cdn.example/retry.png') {
            const bytes = new Uint8Array(tiny)
            return {
              status: 200,
              headers: { 'content-type': 'image/png' },
              async text() {
                return ''
              },
              async json<T>(): Promise<T> {
                throw new Error('not json')
              },
              async arrayBuffer() {
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
              },
            }
          }
          return resp(404, {})
        },
      }),
      assets: platformWithAssets([]).assets,
    })

    const assets = await a.generateImage(request([], 1, { ratio: '16:9', resolution: '4K' }), signal)
    expect(polls).toBe(2)
    expect(submitPosts).toBe(1)
    expect(assets).toHaveLength(1)
    expect(assets[0]!.bytes).toEqual(tiny)
    },
  )

  it('★★ SoonStudio 轮询遇到 503 时继续查询，下一次成功仍返回图片且只提交一次', async () => {
    const tiny = solidPng(4, 3, [0x11, 0x22, 0x33])
    const soonCfg: ResolvedChannelConfig = {
      ...cfg,
      protocol: 'soonstudio',
      baseUrl: 'https://soonstudio.ai',
    }
    let polls = 0
    let submitPosts = 0
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
            submitPosts += 1
            return resp(200, { task_id: 'task_poll_503' })
          }
          if (req.url === 'https://soonstudio.ai/v1/images/tasks/task_poll_503') {
            polls += 1
            if (polls === 1) {
              throw { kind: 'http', status: 503, body: 'temporarily unavailable' }
            }
            return resp(200, {
              data: {
                status: 'SUCCESS',
                data: { url: [`data:image/png;base64,${bytesToB64(tiny)}`] },
              },
            })
          }
          return resp(404, {})
        },
      }),
      assets: platformWithAssets([]).assets,
    })

    const assets = await a.generateImage(
      request([], 1, { ratio: '16:9', resolution: '4K' }),
      signal,
    )
    expect(polls).toBe(2)
    expect(submitPosts).toBe(1)
    expect(assets[0]!.bytes).toEqual(tiny)
  })

  it('SoonStudio 轮询超时结束为 accepted，且不再提交第二次 POST', async () => {
    let submitPosts = 0
    const soonCfg: ResolvedChannelConfig = {
      ...cfg,
      protocol: 'soonstudio',
      baseUrl: 'https://soonstudio.ai',
    }
    const a = createOpenAiImagesAdapter(
      soonCfg,
      {
        network: createMemoryNetwork({
          handler: async (req) => {
            if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
              submitPosts += 1
              return resp(200, { task_id: 'task_timeout' })
            }
            return resp(200, { data: { status: 'IN_PROGRESS' } })
          },
        }),
        assets: platformWithAssets([]).assets,
      },
      {
        soonStudioPollIntervalMs: 0,
        soonStudioPollTimeoutMs: 0,
        sleep: async () => {},
      },
    )

    await expect(
      a.generateImage(request([], 1, { ratio: '16:9', resolution: '4K' }), signal),
    ).rejects.toMatchObject({
      appError: { kind: 'execution', detail: 'accepted' },
    })
    expect(submitPosts).toBe(1)
  })

  it('★★ SoonStudio 结果 URL 下载卡住时，优先用同一任务里的 Base64 备用产物', async () => {
    const fallback = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const fallbackB64 = btoa(String.fromCharCode(...fallback))
    const soonCfg: ResolvedChannelConfig = { ...cfg, protocol: 'soonstudio', baseUrl: 'https://soonstudio.ai' }
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
            return resp(200, { task_id: 'task_fallback' })
          }
          if (req.url === 'https://soonstudio.ai/v1/images/tasks/task_fallback') {
            return resp(200, {
              data: {
                status: 'SUCCESS',
                data: {
                  url: [
                    'https://cdn.example/hangs.png',
                    `data:image/png;base64,${fallbackB64}`,
                  ],
                },
              },
            })
          }
          if (req.url === 'https://cdn.example/hangs.png') {
            throw { kind: 'network', detail: 'timeout' }
          }
          return resp(404, {})
        },
      }),
      assets: platformWithAssets([]).assets,
    })
    const assets = await a.generateImage(request([], 1, { resolution: '4K' }), signal)
    expect(assets).toHaveLength(1)
    expect(assets[0]!.bytes).toEqual(fallback)
  })

  it('★★ 生成成功但所有产物地址都取不到时，错误里保留真实 URL 与阶段', async () => {
    const soonCfg: ResolvedChannelConfig = { ...cfg, protocol: 'soonstudio', baseUrl: 'https://soonstudio.ai' }
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
            return resp(200, { task_id: 'task_no_fallback' })
          }
          if (req.url === 'https://soonstudio.ai/v1/images/tasks/task_no_fallback') {
            return resp(200, {
              data: { status: 'SUCCESS', data: { url: ['https://cdn.example/unreachable.png'] } },
            })
          }
          if (req.url === 'https://cdn.example/unreachable.png') {
            throw { kind: 'network', detail: 'timeout' }
          }
          return resp(404, {})
        },
      }),
      assets: platformWithAssets([]).assets,
    })
    const failure = await a.generateImage(request([], 1), signal).catch((e: unknown) => e)
    const appError = (
      failure as { appError?: { kind?: string; detail?: string; message?: string } }
    ).appError
    expect(appError).toMatchObject({ kind: 'execution', detail: 'accepted' })
    expect(appError?.message).toContain('图片已生成，但产物下载失败')
    expect(appError?.message).toContain('https://cdn.example/unreachable.png')
  })

  it('★★ SoonStudio 任务 FAILURE 时保留服务端原因且不再允许重提', async () => {
    const soonCfg: ResolvedChannelConfig = { ...cfg, protocol: 'soonstudio', baseUrl: 'https://soonstudio.ai' }
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.url === 'https://soonstudio.ai/v1/images/generations?async=true') {
            return resp(200, { task_id: 'task_failed_789' })
          }
          return resp(200, {
            data: {
              status: 'FAILURE',
              fail_reason: 'upstream account pool exhausted',
            },
          })
        },
      }),
      assets: platformWithAssets([]).assets,
    })

    const failure = await a.generateImage(request([], 1), signal).catch((e: unknown) => e)
    const appError = (
      failure as { appError?: { kind?: string; detail?: string; message?: string } }
    ).appError
    expect(appError).toMatchObject({ kind: 'execution', detail: 'accepted' })
    expect(appError?.message).toContain('upstream account pool exhausted')
  })

  it('★★ SoonStudio 图生图表单同样请求 URL 产物', async () => {
    const calls: { url: string; body: unknown }[] = []
    const platform = platformWithAssets([{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }])
    const soonCfg: ResolvedChannelConfig = { ...cfg, protocol: 'soonstudio', baseUrl: 'https://soonstudio.ai' }
    const a = createOpenAiImagesAdapter(soonCfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          calls.push({ url: req.url, body: req.body })
          if (req.url === 'https://soonstudio.ai/v1/images/edits') {
            return resp(200, { data: [{ b64_json: btoa('fakepng') }] })
          }
          return resp(404, {})
        },
      }),
      assets: platform.assets,
    })

    await a.generateImage(
      request([{ kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' }]),
      signal,
    )

    const form = calls[0]!.body as FormData
    expect(calls[0]!.url).toBe('https://soonstudio.ai/v1/images/edits')
    expect(form.get('response_format')).toBe('url')
  })
})

describe('openaiImages adapter / 图生图（M6-12）', () => {
  it('带可读取的图像输入 → 打 /v1/images/edits 且请求体是 FormData', async () => {
    const calls: { url: string; body: unknown }[] = []
    const platform = platformWithAssets([{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }])
    const a = createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/edits', calls),
      assets: platform.assets,
    })
    const assets = await a.generateImage(
      request([{ kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' }]),
      signal,
    )
    expect(assets).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://x/v1/images/edits')
    const form = calls[0]!.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe('gpt-image-2')
    expect(form.get('prompt')).toBe('a cat')
    expect(form.get('n')).toBe('1')
    expect(form.get('response_format')).toBe('b64_json')
    // 图像以重复的 image 字段上传（标准表单数组写法）
    expect(form.getAll('image')).toHaveLength(1)
  })

  it('多张参考图全部上传，且按 hash 去重', async () => {
    const calls: { url: string; body: unknown }[] = []
    const platform = platformWithAssets([
      { id: 'h1', bytes: new Uint8Array([1]), mime: 'image/png' },
      { id: 'h2', bytes: new Uint8Array([2]), mime: 'image/jpeg' },
    ])
    const a = createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/edits', calls),
      assets: platform.assets,
    })
    await a.generateImage(
      request([
        { kind: 'asset', nodeId: 'a', assetHash: 'h1', mime: 'image/png' },
        { kind: 'asset', nodeId: 'b', assetHash: 'h2', mime: 'image/jpeg' },
        { kind: 'asset', nodeId: 'c', assetHash: 'h1', mime: 'image/png' }, // 重复，应被剔除
      ]),
      signal,
    )
    const form = calls[0]!.body as FormData
    expect(form.getAll('image')).toHaveLength(2)
    const names = form.getAll('image').map((v) => (v as File).name)
    expect(names).toEqual(['h1.png', 'h2.jpg'])
  })

  it('超大参考图先压缩成 ≤2MB WebP，再把副本放进 multipart', async () => {
    const calls: { url: string; body: unknown }[] = []
    const original = new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1)
    const platform = platformWithAssets([{ id: 'h-big', bytes: original, mime: 'image/png' }])
    const bitmap = { width: 2048, height: 1152, close: vi.fn() }
    class FakeOffscreenCanvas {
      getContext() {
        return { drawImage: vi.fn() }
      }
      async convertToBlob() {
        return new Blob([new Uint8Array([9, 8, 7])], { type: MODEL_IMAGE_MIME })
      }
    }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    try {
      const a = createOpenAiImagesAdapter(cfg, {
        network: networkSeeing('/v1/images/edits', calls),
        assets: platform.assets,
      })
      await a.generateImage(
        request([{ kind: 'asset', nodeId: 'up', assetHash: 'h-big', mime: 'image/png' }]),
        signal,
      )
      const file = (calls[0]!.body as FormData).get('image') as File
      expect(file.type).toBe(MODEL_IMAGE_MIME)
      expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([9, 8, 7])
      expect(original.byteLength).toBe(CHAT_IMAGE_MAX_BYTES + 1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('素材读不到（未落库 / 已清理）→ 回落文生图，不硬失败', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/generations', calls),
      assets: platformWithAssets([]).assets,
    })
    const assets = await a.generateImage(
      request([{ kind: 'asset', nodeId: 'up', assetHash: 'missing', mime: 'image/png' }]),
      signal,
    )
    expect(assets).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://x/v1/images/generations')
  })

  it('视频输入不触发图生图（只有图像素材才上传）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/generations', calls),
      assets: platformWithAssets([]).assets,
    })
    await a.generateImage(request([{ kind: 'asset', nodeId: 'v', assetHash: 'hv', mime: 'video/mp4' }]), signal)
    expect(calls[0]!.url).toBe('https://x/v1/images/generations')
  })

  it('端点不支持 edits → 如实报错，不悄悄降级', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(404, {}) })
    const platform = platformWithAssets([{ id: 'h1', bytes: new Uint8Array([1]), mime: 'image/png' }])
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platform.assets })
    await expect(
      a.generateImage(request([{ kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' }]), signal),
    ).rejects.toThrow()
  })
})

// ────────────────────────────────────────────────────────────
// Base URL 归一：OpenAI 兼容中转对「地址含不含 /v1」没有统一约定，两种都必须能用。
// 若按原实现无条件拼 `/v1`，「地址已含 /v1」就会变成 `/v1/v1/...` —— 真机必然 404。
// ────────────────────────────────────────────────────────────
describe('openaiImages adapter / Base URL 归一', () => {
  it('normalizeBaseUrl 剥掉结尾的版本段与斜杠', () => {
    expect(normalizeBaseUrl('https://x')).toBe('https://x')
    expect(normalizeBaseUrl('https://x/')).toBe('https://x')
    expect(normalizeBaseUrl('https://x/v1')).toBe('https://x')
    expect(normalizeBaseUrl('https://x/v1/')).toBe('https://x')
    expect(normalizeBaseUrl('  https://x/openai/v1  ')).toBe('https://x/openai')
  })

  it('地址已含 /v1 时不再拼第二个 /v1', async () => {
    const calls: { url: string; body: unknown }[] = []
    const withV1: ResolvedChannelConfig = { ...cfg, baseUrl: 'https://relay.example.com/v1' }
    const a = createOpenAiImagesAdapter(withV1, {
      network: networkSeeing('/v1/images/generations', calls),
      assets: platformWithAssets([]).assets,
    })
    await a.generateImage(request([]), signal)
    expect(calls[0]!.url).toBe('https://relay.example.com/v1/images/generations')
    expect(calls[0]!.url).not.toContain('/v1/v1')
  })

  it('地址不带 /v1（文档写法）照旧可用', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/generations', calls),
      assets: platformWithAssets([]).assets,
    })
    await a.generateImage(request([]), signal)
    expect(calls[0]!.url).toBe('https://x/v1/images/generations')
  })
})

// ────────────────────────────────────────────────────────────
// 生图参数：size 必须是**像素**（`1024x1024`）而不是比例字面量 `1x1`（原实现直接
// `replace(':','x')`，真实模型一律拒绝）；质量走 `quality`；画质档位在本协议无对应参数。
// ────────────────────────────────────────────────────────────
describe('openaiImages adapter / 生图参数（size 像素化、quality 透传）', () => {
  const adapter = (calls: { url: string; body: unknown }[]) =>
    createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/generations', calls),
      assets: platformWithAssets([]).assets,
    })
  /**
   * 这一档测的是**没有能力表时**的通用 OpenAI 口径（比例 → 像素 size 那套）。
   * `gpt-image-2` 现在有官方能力表（`openai-images` 方言），所以这些用例改用
   * 一个清单里没有的模型名 —— 否则测的就不是「通用兜底」而是「官方尺寸表」了。
   */
  const legacy = (
    inputs: ImageRunRequest['inputs'],
    count = 1,
    params: Record<string, unknown> = {},
  ): ImageRunRequest => ({ ...request(inputs, count, params), model: 'legacy-image-x' })

  it('比例 → 合法像素 size；绝不发出 `1x1` 这类非法值', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = adapter(calls)
    await a.generateImage(legacy([], 1, { ratio: '1:1' }), signal)
    await a.generateImage(legacy([], 1, { ratio: '16:9' }), signal)
    await a.generateImage(legacy([], 1, { ratio: '9:16' }), signal)
    expect(calls[0]!.body).toMatchObject({ size: '1024x1024' })
    // 1K 预算 1024²，16px 吸附：16:9 → 1360x768
    expect(calls[1]!.body).toMatchObject({ size: '1360x768' })
    expect(calls[2]!.body).toMatchObject({ size: '768x1360' })
    expect((calls[0]!.body as Record<string, unknown>).size).not.toBe('1x1')
  })

  it('超 3:1 的比例 → 不发 size（文档明确拒绝长短边比超过 3:1）', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(legacy([], 1, { ratio: '22:7' }), signal)
    expect(calls[0]!.body).not.toHaveProperty('size')
  })

  it('画质档位（resolution）刻意不发 —— 本协议没有对应参数', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(legacy([], 1, { ratio: '1:1', resolution: '2k' }), signal)
    expect(calls[0]!.body).not.toHaveProperty('resolution')
    // resolution 不作为独立字段下发，但会并入 size：2K 1:1 → 2048x2048
    expect(calls[0]!.body).toMatchObject({ size: '2048x2048' })
  })

  it('质量 → quality 透传；非法档位不发', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = adapter(calls)
    await a.generateImage(legacy([], 1, { quality: 'high' }), signal)
    await a.generateImage(legacy([], 1, { quality: 'ultra' }), signal)
    expect(calls[0]!.body).toMatchObject({ quality: 'high' })
    expect(calls[1]!.body).not.toHaveProperty('quality')
  })

  it('产物宽高来自请求的 size（不再写死 512）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const assets = await adapter(calls).generateImage(legacy([], 1, { ratio: '2:3' }), signal)
    expect(assets[0]!.requestedWidth).toBe(832)
    expect(assets[0]!.requestedHeight).toBe(1248)
  })

  /**
   * **按模型自己的能力表发参数**（用户 2026-10-03：「把图片生成节点…每个模型有哪些配置
   * 单独设置，不要通用设置，去官方文档找一下」）。
   *
   * 上面几条钉的是**没有能力表时**的 OpenAI 口径（一字未改）；下面这几条钉 Agnes 自己的口径：
   * 官方文档里 Agnes 图片只有 `model / prompt / size / ratio / image / return_base64 /
   * extra_body` —— **没有 `n`、没有 `quality`**，发了就是拿 400 换。
   */
  it('★★ Agnes Image 2.5 Flash：size 走档位、带 ratio、不发 n / quality', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      { ...request([], 1), model: 'agnes-image-2.5-flash', params: { count: 1, resolution: '2k', ratio: '16:9', quality: 'high' } },
      signal,
    )
    const body = calls[0]!.body as Record<string, unknown>
    expect(calls[0]!.url).toBe('https://x/v1/images/generations')
    expect(body).toMatchObject({ model: 'agnes-image-2.5-flash', size: '2K', ratio: '16:9' })
    expect(body.n).toBeUndefined()
    expect(body.quality).toBeUndefined()
  })

  it('★★ Agnes Image 2.0 Flash：尺寸是像素、且不发 ratio（它没有 ratio 参数）', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      { ...request([], 1), model: 'agnes-image-2.0-flash', params: { count: 1, resolution: '1024x768', ratio: '16:9' } },
      signal,
    )
    const body = calls[0]!.body as Record<string, unknown>
    expect(body).toMatchObject({ model: 'agnes-image-2.0-flash', size: '1024x768' })
    expect(body.ratio).toBeUndefined()
  })

  it('★ Agnes 图片带参考图时改为 JSON `image` + Data URI（文档明写支持 Base64）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const platform = platformWithAssets([{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }])
    const a = createOpenAiImagesAdapter(cfg, {
      network: networkSeeing('/v1/images/generations', calls),
      assets: platform.assets,
    })
    await a.generateImage(
      {
        ...request([{ kind: 'asset', nodeId: 'up', assetHash: 'h1', mime: 'image/png' }], 1),
        model: 'agnes-image-2.5-flash',
        params: { count: 1, resolution: '1k', ratio: '1:1' },
      },
      signal,
    )
    const body = calls[0]!.body as Record<string, unknown>
    expect(calls[0]!.url).toBe('https://x/v1/images/generations')
    expect(body.image).toEqual([`data:image/png;base64,${bytesToB64(new Uint8Array([1, 2, 3]))}`])
  })

  it('★ 清单外的模型完全不受影响（仍走通用 OpenAI 口径：n + quality + 比例换算）', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(legacy([], 2, { ratio: '1:1', resolution: '1k', quality: 'medium' }), signal)
    expect(calls[0]!.body).toMatchObject({ model: 'legacy-image-x', n: 2, size: '1024x1024', quality: 'medium' })
  })

  /**
   * **GPT Image 三档**：面板给的是**比例 + 清晰度**（用户 2026-10-03 图一：
   * 「我不想用具体的像素标志，我想要比例那种档位」），发请求时换算成 OpenAI 认的像素 `size`；
   * `quality` 走该模型能力表（2026-10-16 起只有 `low / medium / high`），`n` 按能力表夹到 4。
   */
  it('★★ GPT Image 2.5 Flare：比例 × 清晰度 → 像素 size、quality 走能力表、张数夹到 4', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      {
        ...request([], 12),
        model: 'gpt-image-2.5-flare',
        params: { count: 12, ratio: '1:1', resolution: '1k', quality: 'medium' },
      },
      signal,
    )
    const body = calls[0]!.body as Record<string, unknown>
    /** 1:1 × 1K = 1024×1024（`openAiImageSize` 按预算解出来再吸附到 16 的倍数） */
    expect(body.size).toBe('1024x1024')
    expect(body.quality).toBe('medium')
    expect(body.n).toBe(4)
  })

  it('★★ 面板传大写 4K 时，GPT Image 2.5 Sunburst 实际下发 2880x2880', async () => {
    const calls: { url: string; body: unknown }[] = []
    const assets = await adapter(calls).generateImage(
      {
        ...request([], 1),
        model: 'gpt-image-2.5-sunburst',
        params: { count: 1, ratio: '1:1', resolution: '4K', quality: 'high' },
      },
      signal,
    )
    expect(calls[0]!.body).toMatchObject({
      size: '2880x2880',
      quality: 'high',
    })
    expect(assets[0]!.requestedWidth).toBe(2880)
    expect(assets[0]!.requestedHeight).toBe(2880)
  })

  /**
   * **自定义像素优先生效**（用户 2026-10-15：「自定义要加上」）。
   *
   * 面板选了「自定义」并填了像素时，`resolution` 里存的就是那个 `宽x高`：
   * 它**直接就是 `size`**，不再按比例 × 档位换算 —— 否则用户填的 1536 宽会被
   * 比例表悄悄改掉，界面上看到的和发出去的就不是一个东西。
   */
  it('★★ GPT Image：自定义像素直接当 size 发（不再按比例换算）', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      {
        ...request([], 1),
        model: 'gpt-image-2',
        /** 故意留一个与 1024x1536 不符的比例：自定义值要赢 */
        params: { count: 1, ratio: '1:1', resolution: '1024x1536' },
      },
      signal,
    )
    expect(calls[0]!.body).toMatchObject({ size: '1024x1536' })
  })

  /** 非法自定义像素（不是 16 的倍数）不下发 —— 交给服务端默认，而不是换一个 400 */
  it('★ GPT Image：非法自定义像素不发 size', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      {
        ...request([], 1),
        model: 'gpt-image-2',
        params: { count: 1, ratio: '1:1', resolution: '1024x1000' },
      },
      signal,
    )
    /** `1024x1000` 过不了校验 ⇒ 回落到比例 × 档位那条老路（1:1 + 未设档位 = 1K） */
    expect(calls[0]!.body).toMatchObject({ size: '1024x1024' })
  })

  it('★ 选「自动」尺寸时不发 size（交给服务端默认），不是发一个字符串 auto', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      {
        ...request([], 1),
        model: 'gpt-image-2.5-flare',
        params: { count: 1, resolution: 'auto', quality: 'auto' },
      },
      signal,
    )
    expect(calls[0]!.body).not.toHaveProperty('size')
    /**
     * `quality: 'auto'` 同样**不下发**：图一那份画质菜单只有五档（低/标准/高/超高/极致），
     * 没有「自动」；而 OpenAI 的 `auto` 语义就是「让服务端自己定」——
     * 不发与发 `auto` 等价，不发更不容易被中转站拒。
     */
    expect(calls[0]!.body).not.toHaveProperty('quality')
    expect(calls[0]!.body).toMatchObject({ n: 1 })
  })

  /**
   * **背景**（用户 2026-10-15：只剩两格 —— 默认 / 透明底）。
   *
   * 取值就发 OpenAI 官方的 `background` 枚举里**这一档还摆着的**那个（`transparent`）；
   * 「自动」= 不指定 ⇒ **不发这个字段**。声明里没有这一段的模型（Agnes 图片那几档）
   * 就算节点上带着旧值也不发 —— 这正是用户要的「每个模型只发它支持的参数」。
   */
  it('★★ 背景：声明支持的模型才发；「自动」与不支持的模型都不发', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = adapter(calls)
    await a.generateImage(
      { ...request([], 1), model: 'gpt-image-2', params: { count: 1, background: 'transparent' } },
      signal,
    )
    await a.generateImage(
      { ...request([], 1), model: 'gpt-image-2', params: { count: 1, background: 'auto' } },
      signal,
    )
    await a.generateImage(
      { ...request([], 1), model: 'agnes-image-2.5-flash', params: { count: 1, background: 'transparent' } },
      signal,
    )
    expect(calls[0]!.body).toMatchObject({ background: 'transparent' })
    expect(calls[1]!.body).not.toHaveProperty('background')
    expect(calls[2]!.body).not.toHaveProperty('background')
  })

  /**
   * ★★ **Midjourney 的「高级设置」拼成提示词后缀**（用户 2026-10-03 图二）。
   *
   * MJ 的参数**本来就写在提示词里**（`a cat --stylize 500`），这是它唯一被官方支持的
   * 传参方式；塞进 JSON 的某个自定义字段没有意义。
   * 判据同时盯住三件事：拼对了、**默认值不写进去**（否则只是噪音）、
   * 以及「分辨率 = 自适应」时不发 `size`。
   */
  it('★★ Midjourney：高级设置拼成提示词后缀（默认值不写、自适应不发 size）', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      {
        ...request([], 1),
        model: 'midjourney',
        prompt: '一只猫',
        params: {
          count: 1,
          ratio: '16:9',
          /** `mj` 由 `nodeSpecs/params.ts` 从节点的四个字段拼出来 */
          mj: { stylize: 500, weird: 50, chaos: 0, personalize: 'abc' },
        },
      },
      signal,
    )
    const body = calls[0]!.body as Record<string, unknown>
    expect(body.prompt).toBe('一只猫 --stylize 500 --weird 50 --p abc')
    /** `chaos: 0` 是官方默认值 —— 不写进提示词 */
    expect(String(body.prompt)).not.toContain('--chaos')
    /** 「自适应」= 不向渠道指定尺寸 */
    expect(body).not.toHaveProperty('size')
  })

  /**
   * 质量档**逐模型**白名单（官方原文：只有 `gpt-image-2.5-flare` / `-sunburst` 支持
   * `xhigh` / `max`）：
   *  · `gpt-image-2` 只认三档 ⇒ 给它 `xhigh` **不发**；
   *  · 2.5 那两档认五档 ⇒ 给它 `xhigh` **照发**；
   *  · 没有能力表的老模型走通用白名单（`auto/low/medium/high`）⇒ `low` 发、`xhigh` 不发。
   */
  it('★★ 质量档逐模型放行：xhigh 只对 2.5 两档发，gpt-image-2 与老模型都不发', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = adapter(calls)
    await a.generateImage(
      { ...request([], 1), model: 'gpt-image-2.5-flare', params: { count: 1, quality: 'xhigh' } },
      signal,
    )
    await a.generateImage(
      { ...request([], 1), model: 'gpt-image-2', params: { count: 1, quality: 'xhigh' } },
      signal,
    )
    await a.generateImage(
      { ...request([], 1), model: 'some-other-image', params: { count: 1, quality: 'xhigh' } },
      signal,
    )
    await a.generateImage(
      { ...request([], 1), model: 'some-other-image', params: { count: 1, quality: 'low' } },
      signal,
    )
    expect((calls[0]!.body as Record<string, unknown>).quality).toBe('xhigh')
    expect((calls[1]!.body as Record<string, unknown>).quality).toBeUndefined()
    expect((calls[2]!.body as Record<string, unknown>).quality).toBeUndefined()
    /** 没有能力表的老模型仍走通用白名单，`low` 照发 */
    expect((calls[3]!.body as Record<string, unknown>).quality).toBe('low')
  })

  /**
   * **Nano Banana（Gemini 系）走 chat 端点**（2026-10-03 真机实测）：
   * `/images/generations` 对 `gemini-3-pro-image` 回 503「不支持此 API 路径」，
   * 而 `/chat/completions` 两张都出图 —— 图藏在回复正文的 markdown 里
   * （`![image](https://…jpg)`），要抠出来再自己取字节。
   */
  it('★★ Nano Banana Pro：打 Gemini 原生端点，官方 imageConfig 真的发出去', async () => {
    const calls: { url: string; body: unknown }[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        return {
          status: 200,
          headers: {},
          async text() {
            return ''
          },
          async json<T>(): Promise<T> {
            return {
              candidates: [
                {
                  content: {
                    parts: [{ inlineData: { mimeType: 'image/jpeg', data: btoa('jpegbytes') } }],
                  },
                },
              ],
            } as T
          },
          async arrayBuffer() {
            return new ArrayBuffer(0)
          },
        }
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const assets = await a.generateImage(
      { ...request([], 1), model: 'gemini-3-pro-image', prompt: '一只猫', params: { count: 1, ratio: '21:9', resolution: '2k' } },
      signal,
    )
    expect(calls[0]!.url).toBe(
      'https://x/v1beta/models/gemini-3-pro-image:generateContent',
    )
    expect(calls[0]!.body).toMatchObject({
      contents: [{ parts: [{ text: '一只猫' }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '21:9', imageSize: '2K' },
      },
    })
    expect(assets).toHaveLength(1)
    expect(assets[0]!.mime).toBe('image/jpeg')
  })

  it('★★ Nano Banana 2.1：官方 ID 走 Gemini 原生端点，1K/2K/4K 参数照发', async () => {
    const calls: { url: string; body: unknown }[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        return resp(200, {
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa('png') } }] } },
          ],
        })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    await a.generateImage(
      {
        ...request([], 1),
        model: 'gemini-nano-banana-2.1',
        prompt: '一只猫',
        params: { count: 1, ratio: '1:8', resolution: '4k' },
      },
      signal,
    )
    expect(calls[0]!.url).toBe(
      'https://x/v1beta/models/gemini-nano-banana-2.1:generateContent',
    )
    expect(calls[0]!.body).toMatchObject({
      generationConfig: {
        imageConfig: { aspectRatio: '1:8', imageSize: '4K' },
      },
    })
  })

  it('★★ Gemini 图片在后续 candidate / 蛇形 inline_data 里也要能读出来', async () => {
    const net = createMemoryNetwork({
      handler: async () =>
        resp(200, {
          candidates: [
            {
              content: { parts: [{ text: '已生成图片' }] },
              finishReason: 'STOP',
            },
            {
              content: {
                parts: [
                  {
                    inline_data: {
                      mime_type: 'image/webp',
                      data: btoa('webp-bytes'),
                    },
                  },
                ],
              },
            },
          ],
        }),
    })
    const a = createOpenAiImagesAdapter(cfg, {
      network: net,
      assets: platformWithAssets([]).assets,
    })
    const assets = await a.generateImage(
      {
        ...request([], 1),
        model: 'gemini-nano-banana-2.1',
        prompt: '替换帐篷颜色',
        params: { count: 1 },
      },
      signal,
    )
    expect(assets[0]?.mime).toBe('image/webp')
    expect(new TextDecoder().decode(assets[0]!.bytes)).toBe('webp-bytes')
  })

  it('★★ Gemini 返回 fileData.fileUri 时下载该文件，不误报没有图片', async () => {
    const calls: string[] = []
    const bytes = new Uint8Array([9, 8, 7, 6])
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push(req.url)
        if (req.method === 'GET') {
          return {
            status: 200,
            headers: { 'content-type': 'image/jpeg; charset=binary' },
            async text() {
              return ''
            },
            async json<T>(): Promise<T> {
              return {} as T
            },
            async arrayBuffer() {
              return bytes.buffer.slice(0) as ArrayBuffer
            },
          }
        }
        return resp(200, {
          candidates: [
            {
              content: {
                parts: [
                  {
                    fileData: {
                      mimeType: 'image/jpeg',
                      fileUri: 'https://files.example/out.jpg',
                    },
                  },
                ],
              },
            },
          ],
        })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, {
      network: net,
      assets: platformWithAssets([]).assets,
    })
    const assets = await a.generateImage(
      {
        ...request([], 1),
        model: 'gemini-nano-banana-2.1',
        prompt: '替换帐篷颜色',
        params: { count: 1 },
      },
      signal,
    )
    expect(calls).toEqual([
      'https://x/v1beta/models/gemini-nano-banana-2.1:generateContent',
      'https://files.example/out.jpg',
    ])
    expect(assets[0]).toMatchObject({ mime: 'image/jpeg' })
    expect([...assets[0]!.bytes]).toEqual([9, 8, 7, 6])
  })

  it('★ Gemini 只回文字时，错误里带出模型结束原因和正文，不吞真实原因', async () => {
    const net = createMemoryNetwork({
      handler: async () =>
        resp(200, {
          candidates: [
            {
              content: { parts: [{ text: '无法修改这张图片：参考图缺失' }] },
              finishReason: 'STOP',
            },
          ],
        }),
    })
    const a = createOpenAiImagesAdapter(cfg, {
      network: net,
      assets: platformWithAssets([]).assets,
    })
    await expect(
      a.generateImage(
        {
          ...request([], 1),
          model: 'gemini-nano-banana-2.1',
          prompt: '替换帐篷颜色',
          params: { count: 1 },
        },
        signal,
      ),
    ).rejects.toMatchObject({
      appError: {
        kind: 'parse',
        raw: expect.stringMatching(/STOP.*参考图缺失/),
      },
    })
  })

  /**
   * ★★★ **参考图必须真的发出去**（用户 2026-10-16 报：「为什么给我出的图不一样，
   * 而且 10 秒左右就出了」）。
   *
   * 病根：Nano Banana 走 Gemini 原生 `:generateContent`，而那条分支只发了
   * `parts: [{ text }]` —— 连进来的参考图**一个字节都没带**。模型于是只能凭提示词
   * 凭空画：图是"正常"的、却跟上游两张图没有关系，而且比真图生图快（不用读图）。
   * 这类「静默丢参数」不报错，只有逐字段断言请求体才抓得住。
   */
  it('★★★ Gemini 原生端点：连进来的参考图要作为内联图片一起发出去', async () => {
    const calls: { url: string; body: unknown }[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        return resp(200, {
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa('out') } }] } },
          ],
        })
      },
    })
    const platform = platformWithAssets([
      { id: 'refA', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      { id: 'refB', bytes: new Uint8Array([4, 5]), mime: 'image/jpeg' },
    ])
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platform.assets })
    await a.generateImage(
      {
        ...request(
          [
            { kind: 'asset', nodeId: 'n1', assetHash: 'refA', mime: 'image/png' },
            { kind: 'asset', nodeId: 'n2', assetHash: 'refB', mime: 'image/jpeg' },
          ],
          1,
        ),
        model: 'gemini-3.1-flash-image',
        prompt: '把图一中的字形替换成图二中的字形',
        params: { count: 1, ratio: '16:9', resolution: '2k' },
      },
      signal,
    )
    const parts = (calls[0]!.body as { contents: { parts: Record<string, unknown>[] }[] })
      .contents[0]!.parts
    expect(parts[0]).toEqual({ text: '把图一中的字形替换成图二中的字形' })
    /** 两份参考图各占一个 part —— Gemini 原生的内联图片写法 */
    expect(parts).toHaveLength(3)
    expect(parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: bytesToB64(new Uint8Array([1, 2, 3])) },
    })
    expect(parts[2]).toEqual({
      inlineData: { mimeType: 'image/jpeg', data: bytesToB64(new Uint8Array([4, 5])) },
    })
  })

  /**
   * ★ chat 兜底那条同样会丢参考图（它只发 `content: "…"` 字符串）。
   * 有图时改成多模态数组；**没有图时保持字符串** —— 老网关只认字符串，这是它的常态。
   */
  it('★★ chat 兜底：有参考图时发多模态数组', async () => {
    const calls: { url: string; body: unknown }[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        if (req.url.includes('/v1beta/')) return resp(503, { error: { message: '不支持此 API 路径' } })
        if (req.url.endsWith('/chat/completions')) {
          return resp(200, {
            choices: [{ message: { content: '![image](https://files.example/a.jpg)' } }],
          })
        }
        return {
          status: 200,
          headers: {},
          async text() {
            return ''
          },
          async json<T>(): Promise<T> {
            return {} as T
          },
          async arrayBuffer() {
            return new Uint8Array([9]).buffer
          },
        }
      },
    })
    const platform = platformWithAssets([
      { id: 'refA', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
    ])
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platform.assets })
    await a.generateImage(
      {
        ...request([{ kind: 'asset', nodeId: 'n1', assetHash: 'refA', mime: 'image/png' }], 1),
        model: 'gemini-3.1-flash-image',
        prompt: '把图一的字形换掉',
      },
      signal,
    )
    const chat = calls.find((c) => c.url.endsWith('/chat/completions'))
    expect(chat?.body).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '把图一的字形换掉' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${bytesToB64(new Uint8Array([1, 2, 3]))}` },
            },
          ],
        },
      ],
    })
  })

  it('★ 网关没有 /v1beta（404/503）时回落 chat 路径，并从正文 markdown 里取图', async () => {
    const calls: { url: string; body: unknown }[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        if (req.url.includes('/v1beta/')) return resp(503, { error: { message: '不支持此 API 路径' } })
        if (req.url.endsWith('/chat/completions')) {
          return resp(200, {
            choices: [{ message: { content: '![image](https://files.example/a.jpg)' } }],
          })
        }
        if (req.url === 'https://files.example/a.jpg') {
          return {
            status: 200,
            headers: {},
            async text() {
              return ''
            },
            async json<T>(): Promise<T> {
              return {} as T
            },
            async arrayBuffer() {
              return new Uint8Array([9, 9, 9]).buffer
            },
          }
        }
        return resp(404, {})
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const assets = await a.generateImage(
      { ...request([], 1), model: 'gemini-3-pro-image', prompt: '一只猫' },
      signal,
    )
    expect(calls[0]!.url).toContain('/v1beta/models/gemini-3-pro-image:generateContent')
    expect(calls[1]!.url).toBe('https://x/v1/chat/completions')
    expect(calls[1]!.body).toMatchObject({
      model: 'gemini-3-pro-image',
      messages: [{ role: 'user', content: '一只猫' }],
    })
    expect(calls[2]!.url).toBe('https://files.example/a.jpg')
    expect(assets).toHaveLength(1)
    expect(assets[0]!.mime).toBe('image/jpeg')
  })

  it('Gemini generic 503 sends one POST and ends as accepted', async () => {
    let submitPosts = 0
    const calls: string[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push(req.url)
        if (req.url.includes('/v1beta/')) {
          submitPosts += 1
          throw { kind: 'http', status: 503, body: 'service temporarily unavailable' }
        }
        return resp(200, {
          choices: [{ message: { content: '![image](https://files.example/a.jpg)' } }],
        })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })

    await expect(
      a.generateImage(
        { ...request([], 1), model: 'gemini-3-pro-image', prompt: '一只猫' },
        signal,
      ),
    ).rejects.toMatchObject({
      appError: { kind: 'execution', detail: 'accepted' },
    })
    expect(submitPosts).toBe(1)
    expect(calls.some((url) => url.endsWith('/chat/completions'))).toBe(false)
  })

  it('Gemini explicit unsupported fallback may send chat once, whose 503 cannot trigger more POSTs', async () => {
    let submitPosts = 0
    const net = createMemoryNetwork({
      handler: async (req) => {
        if (req.url.includes('/v1beta/')) {
          submitPosts += 1
          return resp(503, { error: { message: '不支持此 API 路径' } })
        }
        if (req.url.endsWith('/chat/completions')) {
          submitPosts += 1
          throw { kind: 'http', status: 503, body: 'service temporarily unavailable' }
        }
        return resp(404, {})
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })

    await expect(
      a.generateImage(
        { ...request([], 1), model: 'gemini-3-pro-image', prompt: '一只猫' },
        signal,
      ),
    ).rejects.toMatchObject({
      appError: { kind: 'execution', detail: 'accepted' },
    })
    expect(submitPosts).toBe(2)
  })

  it('★ chat 回复里没有图片地址 → 如实报错（不把整段正文当地址）', async () => {
    const net = createMemoryNetwork({
      handler: async (req) =>
        req.url.includes('/v1beta/')
          ? resp(503, { error: { message: '不支持此 API 路径' } })
          : resp(200, { choices: [{ message: { content: '我不会画图' } }] }),
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    await expect(
      a.generateImage({ ...request([], 1), model: 'gemini-3.1-flash-image' }, signal),
    ).rejects.toMatchObject({ appError: { kind: 'parse' } })
  })

  it('★★ 200 但不是图片列表 → 报解析错并带服务端原文，不假成功', async () => {
    const net = createMemoryNetwork({
      handler: async () => resp(200, { code: 451, message: '识别到您当前网络处于暂不支持的地区' }),
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    await expect(
      a.generateImage({ ...request([], 1), model: 'gpt-image-2.5' }, signal),
    ).rejects.toMatchObject({
      appError: {
        kind: 'parse',
        raw: expect.stringContaining('识别到您当前网络处于暂不支持的地区'),
      },
    })
  })

  /**
   * ★ 关键：真实渠道下「请求像素」与「实际像素」**不能同源**。
   *
   * 早先实现把请求的 size 直接当产物宽高写上，于是日志里两个数恒等——
   * 缺口看着被填上了，实际什么都没证明。现在实际像素读产物字节的文件头：
   * 这里喂一张 3×5 的真 PNG，请求侧是 1024x1536，两侧必须不相等。
   */
  it('★ 实际像素读产物字节，不照抄请求 size（请求 1024x1536 / 实际 3x5）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const tiny = solidPng(3, 5, [0x11, 0x22, 0x33])
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        return resp(200, { data: [{ b64_json: bytesToB64(tiny) }] })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    /** 用清单外的模型：这条测的是「比例 → 像素 size」的通用兜底 */
    const assets = await a.generateImage(
      { ...request([], 1, { ratio: '2:3' }), model: 'legacy-image-x' },
      signal,
    )
    expect(assets[0]!.requestedWidth).toBe(832)
    expect(assets[0]!.requestedHeight).toBe(1248)
    expect(assets[0]!.width).toBe(3)
    expect(assets[0]!.height).toBe(5)
    // 两个数不相等的那一刻，日志里的「请求 / 实际」才真的是两个数
    expect(assets[0]!.width).not.toBe(assets[0]!.requestedWidth)
  })

  it('超 3:1 的比例 → 不发 size，请求像素也就不填（不拿实际像素顶替）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const tiny = solidPng(7, 7, [0x00, 0x00, 0x00])
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        return resp(200, { data: [{ b64_json: bytesToB64(tiny) }] })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const assets = await a.generateImage(request([], 1, { ratio: '22:7' }), signal)
    expect(assets[0]!.requestedWidth).toBeUndefined()
    expect(assets[0]!.width).toBe(7)
  })

  it('非图片字节（解不出尺寸）→ 实际像素留空，不猜', async () => {
    const calls: { url: string; body: unknown }[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        return resp(200, { data: [{ b64_json: bytesToB64(new Uint8Array([1, 2, 3, 4])) }] })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const assets = await a.generateImage(
      { ...request([], 1, { ratio: '1:1' }), model: 'legacy-image-x' },
      signal,
    )
    expect(assets[0]!.requestedWidth).toBe(1024)
    expect(assets[0]!.width).toBeUndefined()
  })

  /**
   * ★ 用户报的原始场景（2026-09-17）：选 4 张生成、再选 2 张生成，
   * 两次**同 model + 同 prompt**，结果「前两张与后两张一模一样」、灯箱点开是别的图。
   *
   * 根因是 hash 按请求维度取（`model|prompt|序号`）：序号在两批之间从 0 重新数，
   * 于是批二的 0/1 撞上批一的 0/1，不同的图共用一个 hash ⇒ 展示层按 hash 取图取错。
   * 这里喂 4 张**字节各不相同**的图（真实渠道必然如此），断言 6 个 hash 互不相同。
   */
  it('★ 两批同参数生成：产物 hash 全不重复（内容寻址，不是请求索引）', async () => {
    // 第一批 4 张 + 第二批 2 张，字节各不相同（真实渠道必然如此）
    const first = [0x11, 0x22, 0x33, 0x44].map((c) => solidPng(4, 4, [c, c, c]))
    const second = [0x55, 0x66].map((c) => solidPng(4, 4, [c, c, c]))
    const queue = [...first, ...second]
    let served = 0
    const net = createMemoryNetwork({
      handler: async () => resp(200, { data: [{ b64_json: bytesToB64(queue[served++]!) }] }),
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })

    const hashes: string[] = []
    for (let i = 0; i < 6; i += 1) {
      // 每次都是同一个 model + prompt —— 按请求维度取 hash 的实现会在这里撞车
      const [asset] = await a.generateImage(request([], 1), signal)
      hashes.push(asset!.hash)
    }
    expect(new Set(hashes).size).toBe(6)
  })

  it('同一张图重复生成 → hash 稳定（内容寻址的幂等面）', async () => {
    const same = solidPng(4, 4, [0x11, 0x22, 0x33])
    const net = createMemoryNetwork({
      handler: async () => resp(200, { data: [{ b64_json: bytesToB64(same) }] }),
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const [one] = await a.generateImage(request([], 1), signal)
    const [two] = await a.generateImage(request([], 1), signal)
    expect(two!.hash).toBe(one!.hash)
  })

  it('纯函数映射表（含边界：null / 未知 / 空白）', () => {
    expect(openAiImageSize('1:1')).toBe('1024x1024')
    expect(openAiImageSize(' 3:2 ')).toBe('1248x832')
    expect(openAiImageSize('2:3')).toBe('832x1248')
    // 比例本身超 3:1（如 22:7）拒发
    expect(openAiImageSize('22:7')).toBeNull()
    expect(openAiImageSize(null)).toBeNull()
    expect(openAiImageSize(undefined)).toBeNull()
    /**
     * `auto` = 「让服务端自己定」⇒ **映射结果就是 null（不下发）**。
     * 用户 2026-10-15：参考图那排画质带「自动」，所以它进了能力表（面板要显示、
     * 要能高亮这一格）；但传输层依旧等价于「不指定」——发了反而可能被中转站拒。
     * 界面有得选 / 线上一字不多发，是两件事。
     */
    expect(openAiImageQuality('auto')).toBeNull()
    expect(openAiImageQuality('auto', ['auto', 'low'])).toBeNull()
    expect(openAiImageQuality('medium')).toBe('medium')
    expect(openAiImageQuality('ultra')).toBeNull()
    expect(openAiImageQuality(null)).toBeNull()
  })

  it('4K 档：16:9 → 3840x2160（文档常用值），1:1 特批 2880', () => {
    expect(openAiImageSize('16:9', '4k')).toBe('3840x2160')
    expect(openAiImageSize('9:16', '4k')).toBe('2160x3840')
    expect(openAiImageSize('1:1', '4k')).toBe('2880x2880')
    /* 电商 / 画布面板传的是大写，不能因此掉回 1K */
    expect(openAiImageSize('1:1', '4K')).toBe('2880x2880')
    expect(openAiImageSize('16:9', '4K')).toBe('3840x2160')
  })

  it('2K 档：1:1 → 2048x2048，16:9 → 2736x1536', () => {
    expect(openAiImageSize('1:1', '2k')).toBe('2048x2048')
    expect(openAiImageSize('16:9', '2k')).toBe('2736x1536')
  })

  /**
   * **自定义像素**（用户 2026-10-15：「自定义要加上」）。
   *
   * 面板「画质」那排最后一格填 `宽x高`。约束与 `openAiImageSize` 同一份文档
   * （最大边 ≤ 3840 / 16 的倍数 / 总像素 655360–8294400 / 长短边比 ≤ 3:1）——
   * 过不了就返回 `null`（**不下发**），而不是发一个注定 400 的值。
   */
  it('★★ 自定义像素：合法值原样透传，越界值一律拒发', () => {
    expect(customImageSize('1024x1536')).toBe('1024x1536')
    expect(customImageSize(' 2048 × 1152 ')).toBe('2048x1152')
    /** 大写入参也认（用户手敲时大小写、乘号都可能不一样） */
    expect(customImageSize('1024*1024')).toBe('1024x1024')
    /** 两边都要是 16 的倍数：1024×1000 会被拒 */
    expect(customImageSize('1024x1000')).toBeNull()
    /** 最长边超 3840 */
    expect(customImageSize('4096x4096')).toBeNull()
    /** 总像素低于文档下限（655360） */
    expect(customImageSize('512x512')).toBeNull()
    /** 长短边比超 3:1（文档明确拒绝） */
    expect(customImageSize('3840x1024')).toBeNull()
    /** 不是 `宽x高` 的字样（档位值、空值、非字符串） */
    expect(customImageSize('1k')).toBeNull()
    expect(customImageSize('')).toBeNull()
    expect(customImageSize(null)).toBeNull()
    expect(customImageSize(1024)).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
// 失败文案必须**可读**。
//
// 设置页状态行是用户唯一的失败反馈面。真实链路里 `deps.network.request` 抛的**不是
// Error 实例**，而是归一化后的 `AppError` 字面量（见 platform/web/fetchNetwork）。
// 早先 classifyError 只认 `instanceof Error`，这类对象一路掉到 `String(e)`，
// 状态行显示「✗ [object Object]」——地址填错了、证书不对、被 CORS 拦了，全长得一样。
// ────────────────────────────────────────────────────────────
describe('openaiImages adapter / 失败文案可读', () => {
  /** 与 fetchNetwork 一致：抛 AppError 字面量，而不是 Error */
  const throwing = (thrown: unknown) =>
    createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async () => {
          throw thrown
        },
      }),
      assets: platformWithAssets([]).assets,
    })

  it('网络层抛 AppError 字面量 → 保留原错误、给出可读文案（不再是 [object Object]）', async () => {
    const r = await throwing({ kind: 'network', detail: 'dns' }).verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // 错误本身不能被降级成 parse（那会丢掉「是网络问题」这个结论）
      expect(r.error).toEqual({ kind: 'network', detail: 'dns' })
      expect(r.message).not.toContain('[object Object]')
      expect(r.message).toContain('连不上')
    }
  })

  it('HTTP 状态以 AppError 抛出 → 仍按状态码给建议（404 要点到地址/协议）', async () => {
    const r = await throwing({ kind: 'http', status: 404, body: '{}' }).verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toEqual({ kind: 'http', status: 404, body: '{}' })
      expect(r.message).toContain('404')
      expect(r.message).toContain('地址')
    }
  })

  it('ChannelError（载荷在 appError 上）→ 不透出内部调试串 `[channel] unsupported`', async () => {
    const r = await throwing(new ChannelError({ kind: 'channel', detail: 'unsupported' })).verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('channel')
      expect(r.message).not.toContain('[channel]')
      expect(r.message).toContain('不支持')
    }
  })

  it('verify 命中 404 响应（非抛出）→ 文案与抛出路一致', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(404, {}) })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('404')
  })
})
