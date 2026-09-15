import { describe, it, expect } from 'vitest'
import {
  createOpenAiImagesAdapter,
  normalizeBaseUrl,
  openAiImageSize,
  openAiImageQuality,
} from './openaiImages'
import { createMemoryNetwork, createMemoryPlatform } from '../../platform/memory'
import { solidPng } from './mockPng'
import type { ResolvedChannelConfig } from './registry'
import { ChannelError, type ImageRunRequest } from './types'

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

  it('比例 → 合法像素 size；绝不发出 `1x1` 这类非法值', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = adapter(calls)
    await a.generateImage(request([], 1, { ratio: '1:1' }), signal)
    await a.generateImage(request([], 1, { ratio: '16:9' }), signal)
    await a.generateImage(request([], 1, { ratio: '9:16' }), signal)
    expect(calls[0]!.body).toMatchObject({ size: '1024x1024' })
    expect(calls[1]!.body).toMatchObject({ size: '1536x1024' })
    expect(calls[2]!.body).toMatchObject({ size: '1024x1536' })
    expect((calls[0]!.body as Record<string, unknown>).size).not.toBe('1x1')
  })

  it('未知比例 → 不发 size（宁可用服务端默认，也不猜）', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(request([], 1, { ratio: '21:9' }), signal)
    expect(calls[0]!.body).not.toHaveProperty('size')
  })

  it('画质档位（resolution）刻意不发 —— 本协议没有对应参数', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(request([], 1, { ratio: '1:1', resolution: '2k' }), signal)
    expect(calls[0]!.body).not.toHaveProperty('resolution')
    expect(calls[0]!.body).toMatchObject({ size: '1024x1024' })
  })

  it('质量 → quality 透传；非法档位不发', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = adapter(calls)
    await a.generateImage(request([], 1, { quality: 'high' }), signal)
    await a.generateImage(request([], 1, { quality: 'ultra' }), signal)
    expect(calls[0]!.body).toMatchObject({ quality: 'high' })
    expect(calls[1]!.body).not.toHaveProperty('quality')
  })

  it('产物宽高来自请求的 size（不再写死 512）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const assets = await adapter(calls).generateImage(request([], 1, { ratio: '2:3' }), signal)
    expect(assets[0]!.requestedWidth).toBe(1024)
    expect(assets[0]!.requestedHeight).toBe(1536)
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
    const assets = await a.generateImage(request([], 1, { ratio: '2:3' }), signal)
    expect(assets[0]!.requestedWidth).toBe(1024)
    expect(assets[0]!.requestedHeight).toBe(1536)
    expect(assets[0]!.width).toBe(3)
    expect(assets[0]!.height).toBe(5)
    // 两个数不相等的那一刻，日志里的「请求 / 实际」才真的是两个数
    expect(assets[0]!.width).not.toBe(assets[0]!.requestedWidth)
  })

  it('未知比例 → 不发 size，请求像素也就不填（不拿实际像素顶替）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const tiny = solidPng(7, 7, [0x00, 0x00, 0x00])
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        return resp(200, { data: [{ b64_json: bytesToB64(tiny) }] })
      },
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    const assets = await a.generateImage(request([], 1, { ratio: '21:9' }), signal)
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
    const assets = await a.generateImage(request([], 1, { ratio: '1:1' }), signal)
    expect(assets[0]!.requestedWidth).toBe(1024)
    expect(assets[0]!.width).toBeUndefined()
  })

  it('纯函数映射表（含边界：null / 未知 / 空白）', () => {
    expect(openAiImageSize('1:1')).toBe('1024x1024')
    expect(openAiImageSize(' 3:2 ')).toBe('1536x1024')
    expect(openAiImageSize('2:3')).toBe('1024x1536')
    expect(openAiImageSize('21:9')).toBeNull()
    expect(openAiImageSize(null)).toBeNull()
    expect(openAiImageSize(undefined)).toBeNull()
    expect(openAiImageQuality('auto')).toBe('auto')
    expect(openAiImageQuality('medium')).toBe('medium')
    expect(openAiImageQuality('ultra')).toBeNull()
    expect(openAiImageQuality(null)).toBeNull()
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
