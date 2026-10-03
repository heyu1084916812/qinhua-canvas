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
   * `quality` 走该模型能力表（含官方也有的 `xhigh` / `max`），`n` 按能力表夹到 4。
   */
  it('★★ GPT Image 2.5 Flare：比例 × 清晰度 → 像素 size、quality 走 xhigh、张数夹到 4', async () => {
    const calls: { url: string; body: unknown }[] = []
    await adapter(calls).generateImage(
      {
        ...request([], 12),
        model: 'gpt-image-2.5-flare',
        params: { count: 12, ratio: '1:1', resolution: '1k', quality: 'xhigh' },
      },
      signal,
    )
    const body = calls[0]!.body as Record<string, unknown>
    /** 1:1 × 1K = 1024×1024（`openAiImageSize` 按预算解出来再吸附到 16 的倍数） */
    expect(body.size).toBe('1024x1024')
    expect(body.quality).toBe('xhigh')
    expect(body.n).toBe(4)
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
   * **背景**（用户 2026-10-03 图一：自动 / 保留背景 / 透明背景；「看看能否请求到」）。
   *
   * 取值就发 OpenAI 官方的 `background` 枚举（`opaque` / `transparent`）；
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

  it('★ 能力表外的质量档不发（xhigh 只对该模型放行，别家仍是四档）', async () => {
    const calls: { url: string; body: unknown }[] = []
    const a = adapter(calls)
    await a.generateImage(
      { ...request([], 1), model: 'gpt-image-2.5-flare', params: { count: 1, quality: 'max' } },
      signal,
    )
    await a.generateImage(
      { ...request([], 1), model: 'some-other-image', params: { count: 1, quality: 'xhigh' } },
      signal,
    )
    expect((calls[0]!.body as Record<string, unknown>).quality).toBe('max')
    expect((calls[1]!.body as Record<string, unknown>).quality).toBeUndefined()
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
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '21:9', imageSize: '2K' },
      },
    })
    expect(assets).toHaveLength(1)
    expect(assets[0]!.mime).toBe('image/jpeg')
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

  it('★ chat 回复里没有图片地址 → 如实报错（不把整段正文当地址）', async () => {
    const net = createMemoryNetwork({
      handler: async (req) =>
        req.url.includes('/v1beta/')
          ? resp(503, {})
          : resp(200, { choices: [{ message: { content: '我不会画图' } }] }),
    })
    const a = createOpenAiImagesAdapter(cfg, { network: net, assets: platformWithAssets([]).assets })
    await expect(
      a.generateImage({ ...request([], 1), model: 'gemini-3.1-flash-image' }, signal),
    ).rejects.toMatchObject({ appError: { kind: 'parse' } })
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
    expect(openAiImageQuality('auto')).toBe('auto')
    expect(openAiImageQuality('medium')).toBe('medium')
    expect(openAiImageQuality('ultra')).toBeNull()
    expect(openAiImageQuality(null)).toBeNull()
  })

  it('4K 档：16:9 → 3840x2160（文档常用值），1:1 特批 2880', () => {
    expect(openAiImageSize('16:9', '4k')).toBe('3840x2160')
    expect(openAiImageSize('9:16', '4k')).toBe('2160x3840')
    expect(openAiImageSize('1:1', '4k')).toBe('2880x2880')
  })

  it('2K 档：1:1 → 2048x2048，16:9 → 2736x1536', () => {
    expect(openAiImageSize('1:1', '2k')).toBe('2048x2048')
    expect(openAiImageSize('16:9', '2k')).toBe('2736x1536')
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
