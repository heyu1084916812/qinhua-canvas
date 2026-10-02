import { fingerprintBytes } from '../../domain/shared/hash'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import { imageParamsFor, type ImageParamSpec } from '../../domain/canvas/layout/imageParams'
import { bytesToBase64 } from './base64'
import type { SafeChannelConfig, NetworkResponse } from '../ports'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
  type ImageRunRequest,
  type VerifyResult,
} from './types'
import {
  authHeader,
  classifyError,
  toModelCapability,
  fileExtensionOf,
  isModelListBody,
  normalizeBaseUrl,
  openAiBaseUrl,
  GENERATE_TIMEOUT_MS,
  VERIFY_TIMEOUT_MS,
} from './openaiCommon'

/** 地址归一化现与聊天协议共用一份（openaiCommon），此处转出以保持既有引用点不变 */
export { normalizeBaseUrl }

export interface OpenAiAdapterConfig extends SafeChannelConfig {
  /** 调用前由凭据层注入的明文令牌；为 null 时按匿名请求（多数中继会 401） */
  apiKey: string | null
}

/**
 * 比例 + 画质档位 → OpenAI 规范里的像素 `size`。
 *
 * 规范要的是**像素**（`1024x1536`），不是比例字面量：早期实现把比例直接
 * `replace(':','x')` 发出去，得到 `"1x1"` 这种非法值，真实模型一律拒绝。
 *
 * gpt-image-2 的 size 约束（gpt-best 文档 api-447258891，与官方
 * image-generation#calculating-costs 同源）：
 *   - 最大边 ≤ 3840
 *   - 两边都是 16 的倍数
 *   - 长短边比 ≤ 3:1
 *   - 总像素 ∈ [655360, 8294400]
 *
 * 档位语义：用户在前端选的是 1K / 2K / 4K「目标分辨率档位」，不是 size 本身。
 * 这里按档位先定总像素，再按比例解出两边，最后**吸附到 16 的倍数**（约掉会
 * 破坏比例的事不做——吸附误差最大 16px，肉眼不可辨）。
 * `auto`（或未设置）= 不从档位推，走 1K 表；比例解不出（0 / NaN）也返回 null，
 * 宁可不发 size（用服务端默认），也不发一个猜的值。
 */
const RES_PIXEL_BUDGET: Record<'1k' | '2k' | '4k', number> = {
  '1k': 1024 * 1024,
  '2k': 2048 * 2048,
  // 用户 2026-09-16 指定：4K 档的 1:1 先按 2880 发（2880² > 2048² 但
  // 仍满足总像素上限；其余 4K 档比例照常按 4096² 的预算解）。
  '4k': 4096 * 4096,
}
const MAX_EDGE = 3840
const MAX_PIXELS = 8294400
const SNAP = 16

export function openAiImageSize(ratio: unknown, resolution?: unknown): string | null {
  if (typeof ratio !== 'string') return null
  const [rawW, rawH] = ratio.replace(/\s+/g, '').split(':').map((s) => Number.parseFloat(s))
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) return null
  const aspect = rawW / rawH
  // 比例字面量本身超 3:1（如 22:7）不发——文档明确拒绝
  if (Math.max(aspect, 1 / aspect) > 3) return null
  const tier = resolution === '2k' ? '2k' : resolution === '4k' ? '4k' : '1k'
  const budget = RES_PIXEL_BUDGET[tier]
  if (tier === '4k' && Math.abs(aspect - 1) < 1e-9) {
    // 4K 1:1 特批：2880×2880（用户 2026-09-16 指定，且在文档约束内）
    return '2880x2880'
  }
  // 长边 h、短边 h/aspect（aspect ≥ 1）：h² × aspect = budget；
  // 预算解出的长边再与 MAX_EDGE 取 min——先钳后解，吸附后比例不变形
  const long = Math.min(Math.sqrt(budget * Math.max(aspect, 1 / aspect)), MAX_EDGE)
  let w = Math.round((long * (aspect >= 1 ? 1 : aspect)) / SNAP) * SNAP
  let h = Math.round((long * (aspect >= 1 ? 1 / aspect : 1)) / SNAP) * SNAP
  // 吸附向上取整可能略超边长上限：只压超界的那条边
  if (w > MAX_EDGE) w = Math.floor(MAX_EDGE / SNAP) * SNAP
  if (h > MAX_EDGE) h = Math.floor(MAX_EDGE / SNAP) * SNAP
  // 吸附后仍可能略超总像素上限：等比压长边直到达标
  while (w * h > MAX_PIXELS) {
    const shrinkW = w >= h
    if (shrinkW) {
      w = Math.max(SNAP, w - SNAP)
      h = Math.max(SNAP, Math.round((w / aspect) / SNAP) * SNAP)
    } else {
      h = Math.max(SNAP, h - SNAP)
      w = Math.max(SNAP, Math.round((h * aspect) / SNAP) * SNAP)
    }
  }
  return `${w}x${h}`
}

/** OpenAI 图像协议接受的 `quality` 取值；其余档位一律不发（发了就是 400） */
const OPENAI_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])

export function openAiImageQuality(quality: unknown): string | null {
  return typeof quality === 'string' && OPENAI_QUALITIES.has(quality) ? quality : null
}

/**
 * 按**模型自己的能力表**把用户选的档位翻译成该模型要的 `size`。
 *
 * 两种方言（见 `domain/canvas/layout/imageParams.ts`）：
 * - `tier`：档位字符串（`'1k'` → `'1K'`；Agnes 2.1 / 2.5）；
 * - `pixel`：像素（`'1024x768'` 原样；Agnes Image 2.0 Flash 只认这种）。
 *
 * 认不出来时回落到该模型的**第一档**（而不是发一个它不认的值去换 400）。
 */
export function specImageSize(resolution: unknown, spec: ImageParamSpec): string {
  const wanted = typeof resolution === 'string' ? resolution.trim() : ''
  if (spec.dialect === 'tier') {
    const upper = wanted.toUpperCase()
    return spec.sizes.find((s) => s.toUpperCase() === upper) ?? spec.sizes[0] ?? '1K'
  }
  return spec.sizes.includes(wanted) ? wanted : (spec.sizes[0] ?? '1024x1024')
}

/** 从 `1024x1536` 解出本次请求的像素；解不出返回空对象（不用 512 编造） */
function sizeToDimensions(size: string | null): { width?: number; height?: number } {
  const m = size ? /^(\d+)x(\d+)$/.exec(size) : null
  if (!m) return {}
  return { width: Number(m[1]), height: Number(m[2]) }
}

/**
 * 产物装配（§6.18「请求像素 / 实际像素」）。
 *
 * **实际像素一律从字节里读出来**（PNG/JPEG/GIF/WebP 的文件头即可，见
 * `domain/shared/imageSize`），不再拿「我们请求的 size」顶替——那是
 * 「问渠道要了多大」，不是「渠道给了多大」。早先两者同源，于是日志里两个数
 * **恒等**，缺口看着被填上了、实则什么都没证明。
 *
 * 读不出（非图片字节 / 视频 / 截断）就留空，由展示侧按「未知」处理，**不猜**。
 */
function toAsset(
  hash: string,
  mime: string,
  bytes: Uint8Array,
  requested: { width?: number; height?: number },
): GeneratedAsset {
  const actual = imageSizeFromHeader(bytes)
  return {
    hash,
    mime,
    bytes,
    ...(actual ? { width: actual.width, height: actual.height } : {}),
    ...(requested.width && requested.height
      ? { requestedWidth: requested.width, requestedHeight: requested.height }
      : {}),
  }
}

export function createOpenAiImagesAdapter(
  config: OpenAiAdapterConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  // 版本段由协议声明（`/v1` 或 Ark 的 `/api/v3`），基址已含版本段，端点直接续写
  const base = openAiBaseUrl(config)
  const modelsUrl = `${base}/models`
  const imagesUrl = `${base}/images/generations`
  /** 图生图端点（M6-12）：带参考图时走这里，multipart 上传 */
  const editsUrl = `${base}/images/edits`

  const verify: ChannelAdapter['verify'] = async (_cfg, signal): Promise<VerifyResult> => {
    try {
      const res = await deps.network.request(
        { url: modelsUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        /**
         * 失败时**先读响应体**：403 / 429 这些状态的真实原因（模型未开通、额度用尽、
         * IP 白名单……）就写在里面，只按状态码翻译会把唯一有用的信息丢掉。
         * `text()` 只能读一次，故这里读到的就是给用户的那份。
         */
        const detail = await res.text().catch(() => '')
        const { error, message } = classifyError(null, res.status, detail)
        return { ok: false, error, message }
      }
      const body = await res.json<{ data?: { id: string }[] }>().catch(() => null)
      // 判定与文案下沉到 openaiCommon.isModelListBody：聊天协议共用同一条规则，
      // 否则「同一个假 200，两个协议两种说法」。
      if (!isModelListBody(body)) {
        return {
          ok: false,
          error: { kind: 'channel', detail: 'unsupported' },
          message: '响应不是模型列表，该地址不像 OpenAI 兼容接口',
        }
      }
      const models = body.data.map((m) => toModelCapability(m.id))
      return { ok: true, models }
    } catch (e) {
      const { error, message } = classifyError(e)
      return { ok: false, error, message }
    }
  }

  const listModels: ChannelAdapter['listModels'] = async (_cfg, signal) => {
    const res = await deps.network.request(
      { url: modelsUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res.json<{ data?: { id: string }[] }>().catch(() => ({ data: [] as { id: string }[] }))
    return (body.data ?? []).map((m) => toModelCapability(m.id))
  }

  /** 把 b64 / url 两种返回形态统一解码成产物；两种都没有时该项跳过 */
  const toAssets = async (
    res: NetworkResponse,
    requested: { width?: number; height?: number },
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const body = await res.json<{ data?: { b64_json?: string; url?: string }[] }>()
    const items = body.data ?? []
    const assets: GeneratedAsset[] = []
    for (const item of items) {
      if (item.b64_json) {
        const bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0))
        // hash 取**产物字节**指纹（内容寻址）：旧的 model|prompt|index 在两次
        // 生成同 model + prompt 时 index 碰撞 ⇒ 不同的图共用一个 hash（用户报）
        const hash = await fingerprintBytes(bytes)
        assets.push(toAsset(hash, 'image/png', bytes, requested))
      } else if (item.url) {
        const dl = await deps.network.request({ url: item.url, method: 'GET', headers: {} }, signal)
        const buf = await dl.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const hash = await fingerprintBytes(bytes)
        assets.push(toAsset(hash, 'image/png', bytes, requested))
      }
    }
    return assets
  }

  /**
   * 读出要随请求上传的参考图（M6-12）。
   *
   * 读不到的（素材尚未落库 / 已被清理）**静默跳过**，而不是让整次生成失败：
   * 参考图是「增强」而非「必需」，少一张仍能出图。全部读不到时返回空数组，
   * 调用方据此回落到文生图端点——这不算静默降级，因为此时确实无图可传。
   */
  const readImageFiles = async (request: ImageRunRequest): Promise<{ blob: Blob; name: string }[]> => {
    const wanted = imageInputsOf(request.inputs)
    if (wanted.length === 0) return []
    const files: { blob: Blob; name: string }[] = []
    for (const item of wanted) {
      const payload = await deps.assets.read(item.assetHash)
      if (!payload) continue
      const copy = new Uint8Array(payload.bytes)
      files.push({
        blob: new Blob([copy as BlobPart], { type: payload.mime }),
        name: `${item.assetHash.slice(0, 12)}.${fileExtensionOf(payload.mime)}`,
      })
    }
    return files
  }

  /**
   * 图生图：POST /v1/images/edits（multipart/form-data）。
   *
   * 多张图一律用重复的 `image` 字段（HTML 表单数组的标准写法）；
   * 之所以不写 `image[]`：那是 OpenAI Node SDK 的私有约定，多数中转站按标准解析。
   * `Content-Type` **刻意不设**——boundary 只能由 fetch 依据 FormData 生成，
   * 手写会让服务端分不出段（见 fetchNetwork.isRawBody 的说明）。
   *
   * 端点不支持时**不回落**：让它如实报 404/405。若在这里悄悄改回文生图，
   * 用户会以为「参考图生效了」，实际却被丢掉——这种「看起来通了」的静默降级
   * 比报错难查得多。
   */
  const postEdits = (
    request: ImageRunRequest,
    count: number,
    size: string | null,
    quality: string | null,
    files: { blob: Blob; name: string }[],
    signal: AbortSignal,
  ): Promise<NetworkResponse> => {
    const form = new FormData()
    form.append('model', request.model)
    form.append('prompt', request.prompt)
    form.append('n', String(count))
    if (size) form.append('size', size)
    if (quality) form.append('quality', quality)
    form.append('response_format', 'b64_json')
    for (const f of files) form.append('image', f.blob, f.name)
    return deps.network.request(
      {
        url: editsUrl,
        method: 'POST',
        headers: { ...authHeader(config.apiKey) },
        body: form,
        timeoutMs: GENERATE_TIMEOUT_MS,
      },
      signal,
    )
  }

  /** 文生图：POST /v1/images/generations（JSON），与 M6-12 之前完全一致 */
  const postGenerations = (
    request: ImageRunRequest,
    count: number,
    size: string | null,
    quality: string | null,
    signal: AbortSignal,
  ): Promise<NetworkResponse> =>
    deps.network.request(
      {
        url: imagesUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
        body: {
          model: request.model,
          prompt: request.prompt,
          n: count,
          ...(size ? { size } : {}),
          ...(quality ? { quality } : {}),
          response_format: 'b64_json',
        },
        timeoutMs: GENERATE_TIMEOUT_MS,
      },
      signal,
    )

  /** 参考素材 → Data URI（Agnes 图片接口文档明写 `image` 收 Data URI Base64） */
  const toDataUris = async (request: ImageRunRequest): Promise<string[]> => {
    const out: string[] = []
    for (const item of imageInputsOf(request.inputs)) {
      const payload = await deps.assets.read(item.assetHash).catch(() => null)
      if (!payload || payload.bytes.length === 0) continue
      out.push(`data:${payload.mime || item.mime};base64,${bytesToBase64(payload.bytes)}`)
    }
    return out
  }

  /**
   * **按模型自己的能力表**发请求（Agnes 图片三档走这条）。
   *
   * 与 OpenAI 那套的区别就在「发什么」：这里只发表里声明过的字段 ——
   * Agnes 图片接口没有 `n`、也没有 `quality`，所以一个都不发；
   * 画幅用 `ratio`（档位方言）或直接给像素（像素方言）。
   */
  const postSpecGenerations = (
    request: ImageRunRequest,
    size: string,
    spec: ImageParamSpec,
    images: string[],
    signal: AbortSignal,
  ): Promise<NetworkResponse> => {
    const wantedRatio = typeof request.params.ratio === 'string' ? request.params.ratio : ''
    const ratio = spec.ratios.includes(wantedRatio) ? wantedRatio : spec.ratios[0]
    return deps.network.request(
      {
        url: imagesUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
        body: {
          model: request.model,
          prompt: request.prompt,
          size,
          ...(spec.dialect === 'tier' && ratio ? { ratio } : {}),
          ...(images.length > 0 ? { image: images } : {}),
          /**
           * 输出形态仍走既有的顶层 `response_format`（一路都在用、渠道也吃）。
           * Agnes 文档把它写在 `extra_body.response_format` 下，但我们没有实证过那条，
           * 不在这次改动里换路径。
           */
          response_format: 'b64_json',
        },
        timeoutMs: GENERATE_TIMEOUT_MS,
      },
      signal,
    )
  }

  const generateImage: ChannelAdapter['generateImage'] = async (request: ImageRunRequest, signal) => {
    /**
     * **模型自己的能力表**（用户 2026-10-03：「把图片生成节点…每个模型有哪些配置
     * 单独设置，不要通用设置」）。
     *
     * 有表（Agnes 图片三档）⇒ 只发表里声明过的参数：`size` 按方言翻译、有 `ratio` 才发、
     * 不发 `n` 与 `quality`（Agnes 图片接口根本没有这两个字段，发了只能换 400）；
     * 没有表（其它厂商的固定显示名）⇒ 完全沿用原来那套 OpenAI 口径，行为一字不变。
     */
    const spec = imageParamsFor(request.model)
    const count = Math.max(1, typeof request.params.count === 'number' ? request.params.count : 1)
    const specSize = spec ? specImageSize(request.params.resolution, spec) : null
    const size = specSize ?? openAiImageSize(request.params.ratio, request.params.resolution)
    const quality = spec ? null : openAiImageQuality(request.params.quality)
    // 有参考图 → 图生图（multipart）；一张都没有 → 文生图（JSON，与 M6-12 前一致）
    const files = spec ? [] : await readImageFiles(request)
    const res = spec && specSize
      ? await postSpecGenerations(request, specSize, spec, await toDataUris(request), signal)
      : files.length > 0
        ? await postEdits(request, count, size, quality, files, signal)
        : await postGenerations(request, count, size, quality, signal)

    if (res.status < 200 || res.status >= 300) {
      /**
       * 生图失败时把响应体一并带回 —— 这里是用户最常撞上 403 的地方
       * （模型没开通 / 额度不足 / 渠道限制），而原因就在 body 里。
       */
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    return toAssets(res, sizeToDimensions(size), signal)
  }

  return {
    protocol: config.protocol,
    verify,
    listModels,
    generateImage,
    async generateVideo() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
    async completeText() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
  }
}
