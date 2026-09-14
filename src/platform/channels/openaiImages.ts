import { fingerprintHex } from '../../domain/shared/hash'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
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
 * 比例 → OpenAI 规范里的像素 `size`。
 *
 * 规范要的是**像素**（`1024x1536`），不是比例字面量：早期实现把比例直接
 * `replace(':','x')` 发出去，得到 `"1x1"` 这种非法值，真实模型一律拒绝。
 * 比例不在表内时返回 null —— **宁可不发 size（用服务端默认），也不发一个猜的值**。
 *
 * 关于 `resolution`（画质 1K/2K/4K）：OpenAI 图像协议**没有档位参数**，
 * 像素尺寸由模型与 `size` 共同决定，故这里**刻意不从档位推 size**——
 * 把 2K 猜成 `2048x2048` 在多数中转上是 400，比「档位不生效」更糟。
 */
const OPENAI_SIZE_BY_RATIO: Record<string, string> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '16:9': '1536x1024',
  '2:3': '1024x1536',
  '9:16': '1024x1536',
}

export function openAiImageSize(ratio: unknown): string | null {
  if (typeof ratio !== 'string') return null
  return OPENAI_SIZE_BY_RATIO[ratio.replace(/\s+/g, '')] ?? null
}

/** OpenAI 图像协议接受的 `quality` 取值；其余档位一律不发（发了就是 400） */
const OPENAI_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])

export function openAiImageQuality(quality: unknown): string | null {
  return typeof quality === 'string' && OPENAI_QUALITIES.has(quality) ? quality : null
}

/** 从 `1024x1536` 解出产物元数据用的宽高；解不出返回空对象（不用 512 编造） */
function sizeToDimensions(size: string | null): { width?: number; height?: number } {
  const m = size ? /^(\d+)x(\d+)$/.exec(size) : null
  if (!m) return {}
  return { width: Number(m[1]), height: Number(m[2]) }
}

export function createOpenAiImagesAdapter(
  config: OpenAiAdapterConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  const base = normalizeBaseUrl(config.baseUrl)
  const modelsUrl = `${base}/v1/models`
  const imagesUrl = `${base}/v1/images/generations`
  /** 图生图端点（M6-12）：带参考图时走这里，multipart 上传 */
  const editsUrl = `${base}/v1/images/edits`

  const verify: ChannelAdapter['verify'] = async (_cfg, signal): Promise<VerifyResult> => {
    try {
      const res = await deps.network.request(
        { url: modelsUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        const { error, message } = classifyError(null, res.status)
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
      const { error } = classifyError(null, res.status)
      throw new ChannelError(error)
    }
    const body = await res.json<{ data?: { id: string }[] }>().catch(() => ({ data: [] as { id: string }[] }))
    return (body.data ?? []).map((m) => toModelCapability(m.id))
  }

  /** 把 b64 / url 两种返回形态统一解码成产物；两种都没有时该项跳过 */
  const toAssets = async (
    res: NetworkResponse,
    model: string,
    prompt: string,
    dims: { width?: number; height?: number },
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const body = await res.json<{ data?: { b64_json?: string; url?: string }[] }>()
    const items = body.data ?? []
    const assets: GeneratedAsset[] = []
    for (const item of items) {
      if (item.b64_json) {
        const bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0))
        // 宽高取自己请求的 size（不再写死 512 —— 那是个与真实产物无关的假值）
        assets.push({ hash: fingerprintHex(`${model}|${prompt}|${assets.length}`), mime: 'image/png', bytes, ...dims })
      } else if (item.url) {
        const dl = await deps.network.request({ url: item.url, method: 'GET', headers: {} }, signal)
        const buf = await dl.arrayBuffer()
        assets.push({ hash: fingerprintHex(`${model}|${item.url}`), mime: 'image/png', bytes: new Uint8Array(buf), ...dims })
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

  const generateImage: ChannelAdapter['generateImage'] = async (request: ImageRunRequest, signal) => {
    const count = Math.max(1, typeof request.params.count === 'number' ? request.params.count : 1)
    // 比例 → 合法像素 size（非法/未知比例宁可不发）；质量 → OpenAI 的 quality 取值
    const size = openAiImageSize(request.params.ratio)
    const quality = openAiImageQuality(request.params.quality)
    // 有参考图 → 图生图（multipart）；一张都没有 → 文生图（JSON，与 M6-12 前一致）
    const files = await readImageFiles(request)
    const res =
      files.length > 0
        ? await postEdits(request, count, size, quality, files, signal)
        : await postGenerations(request, count, size, quality, signal)

    if (res.status < 200 || res.status >= 300) {
      const { error } = classifyError(null, res.status)
      throw new ChannelError(error)
    }
    return toAssets(res, request.model, request.prompt, sizeToDimensions(size), signal)
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
