import { fingerprintBytes } from '../../domain/shared/hash'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import { imageParamsFor, type ImageParamSpec } from '../../domain/canvas/layout/imageParams'
import { bytesToBase64 } from './base64'
import { prepareModelImageInput } from './chatImageInput'
import { mjFlags } from '../../domain/canvas/layout/mjParams'
import {
  CUSTOM_SIZE_MAX_EDGE as MAX_EDGE,
  CUSTOM_SIZE_MAX_PIXELS as MAX_PIXELS,
  customImageSize,
  CUSTOM_SIZE_SNAP as SNAP,
} from '../../domain/canvas/layout/customSize'
/**
 * 自定义像素尺寸的**规则住在 domain**（`domain/canvas/layout/customSize`），与面板共用同一份 ——
 * 面板那侧要拿它给用户一句"为什么填的不算数"。这里只把它原样转出去，保持既有导入路径可用。
 */
export { customImageSize }
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
/** 上面三个约束常量与 `SNAP` 都来自 `domain/canvas/layout/customSize`（见那里的说明） */

/**
 * **Gemini 的「不下发比例」默认值**（内部哨兵，**不在任何能力表里**）。
 *
 * 官方语义：不传 `aspectRatio` = 跟输入图一致；没有输入图时才是 1:1。
 * 面板上表达这件事的是**跟随素材**那一档（只在真有上游图时出现），
 * 所以 `auto` 已经不在 `spec.ratios` 里 —— 没选比例时由这里兜底，
 * 而不是再靠「`spec.ratios[0]` 恰好是 `auto`」顺带实现。
 */
const GEMINI_DEFAULT_RATIO = 'auto'

export function openAiImageSize(ratio: unknown, resolution?: unknown): string | null {
  if (typeof ratio !== 'string') return null
  const [rawW, rawH] = ratio.replace(/\s+/g, '').split(':').map((s) => Number.parseFloat(s))
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) return null
  const aspect = rawW / rawH
  // 比例字面量本身超 3:1（如 22:7）不发——文档明确拒绝
  if (Math.max(aspect, 1 / aspect) > 3) return null
  /**
   * 面板发的是 `1K / 2K / 4K`，协议层历史上只认小写。
   * 不做大小写归一会把“4K”静默降成 1K，且任务里仍写着 4K，极难发现。
   */
  const wanted = typeof resolution === 'string' ? resolution.trim().toLowerCase() : ''
  const tier = wanted === '2k' ? '2k' : wanted === '4k' ? '4k' : '1k'
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

/*
 * **自定义像素尺寸**（用户 2026-10-15：「自定义要加上」）的校验实现**已搬到 domain**：
 * 见 `domain/canvas/layout/customSize.ts`（本文件顶部 re-export 了 `customImageSize`）。
 * 搬家的原因写在那个文件的头注释里 —— 一句话：面板也要用同一份规则给用户提示，
 * 而面板不该反向依赖 `platform/channels`。
 *
 * ⚠️ 只有 `openai-images` 方言能用自定义档。Nano Banana 的 `image_size` 只认
 * 1K / 2K / 4K（Pro）与 512（Flash）—— 那边官方**没有**自定义这一档，
 * 所以面板也不会给那一格（见 `CreationPanel` 里的 `canCustomSize`）。
 */

/**
 * OpenAI 官方图像协议接受的 `quality` 取值。
 *
 * `xhigh` / `max` 不在这里 —— 官方规范把它们标成**模型专属**：只有
 * `gpt-image-2.5-flare` / `-sunburst`（含 `2026-09-08` 快照）支持。
 * 所以它们要发必须由模型的 `imageParamsFor` 能力表（`spec.qualities`）放行，
 * 见 `openAiImageQuality` 的第二个参数 —— 这条「白名单」正是为这种逐模型差异准备的。
 */
const OPENAI_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])

/**
 * 质量档透传：**只发自名单里的值**（发了它不认的就是 400）。
 *
 * `allowed` 由模型能力表给（用户 2026-10-03「每个模型单独配置」）。GPT Image 那三档
 * 2026-10-16 起**按官方规范逐模型**点名：`gpt-image-2` 是 `low / medium / high`，
 * 2.5 那两档另有 `xhigh` / `max`（官方原文见 `imageParams.ts` 的 `OPENAI_IMAGE_QUALITIES`）。
 */
export function openAiImageQuality(quality: unknown, allowed?: readonly string[]): string | null {
  if (typeof quality !== 'string') return null
  /**
   * **`auto` 一律不下发**：它在传输层的语义就是「让服务端自己定」= 等价于
   * 不指定这个字段，发 `auto` 反而可能被中转站拒。
   *
   * 2026-10-16 起它连面板也不摆了（GPT 那排只剩低/中/高），但这条分支**保留**：
   * 旧节点上存过 `auto`、没有能力表的老模型也还认它，两条路都不该把它发出去。
   */
  if (quality === 'auto') return null
  if (allowed) return allowed.includes(quality) ? quality : null
  return OPENAI_QUALITIES.has(quality) ? quality : null
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
  /** `openai-images` / `pixel`：档位本身就是最终值（`auto`、`1024x768` 这种） */
  return spec.sizes.includes(wanted) ? wanted : (spec.sizes[0] ?? '1024x1024')
}

/** 从 `1024x1536` 解出本次请求的像素；解不出返回空对象（不用 512 编造） */
function sizeToDimensions(size: string | null): { width?: number; height?: number } {
  const m = size ? /^(\d+)x(\d+)$/.exec(size) : null
  if (!m) return {}
  return { width: Number(m[1]), height: Number(m[2]) }
}

/**
 * 从 chat 回复正文里抠出**图片地址**。
 *
 * 中转站的 Gemini 系图片模型（Nano Banana）返回的是这样一段 markdown：
 * `![image](https://files.xxx/output/....jpg)`（2026-10-03 实测两次，形状一致）。
 * 先按 markdown 图片语法取，取不到再退一步找裸的图片链接 —— 都不中才算没有图，
 * 不能把整段正文当成地址发出去。
 */
export function imageUrlFromChatContent(content: unknown): string | null {
  if (typeof content !== 'string') return null
  const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(content)
  if (md?.[1]) return md[1]
  const bare = /(https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif))/i.exec(content)
  return bare?.[1] ?? null
}

/**
 * 从 **Gemini 原生响应**里取出内联图片。
 *
 * 形态：`candidates[0].content.parts[]` 里的一项带 `inlineData: { mimeType, data }`
 * （官方 camelCase；老网关常见 `inline_data` 蛇形写法，两种都认）。
 */
export function findInlineImage(
  body: unknown,
): { data: string; mimeType: string } | null {
  const parts = (body as { candidates?: { content?: { parts?: unknown[] } }[] } | null)
    ?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null
  for (const part of parts) {
    const p = part as { inlineData?: { data?: unknown; mimeType?: unknown }; inline_data?: { data?: unknown; mime_type?: unknown } }
    const data = p.inlineData?.data ?? p.inline_data?.data
    const mimeType = p.inlineData?.mimeType ?? p.inline_data?.mime_type
    if (typeof data === 'string' && data.length > 0) {
      return { data, mimeType: typeof mimeType === 'string' ? mimeType : 'image/png' }
    }
  }
  return null
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

interface ImageItem {
  b64_json?: string
  url?: string
}

function imageItemsIn(value: unknown): ImageItem[] {
  const out: ImageItem[] = []
  const seen = new Set<string>()
  const push = (item: ImageItem): void => {
    const key = item.url ? `url:${item.url}` : item.b64_json ? `b64:${item.b64_json.slice(0, 64)}` : ''
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(item)
  }
  const visit = (node: unknown, depth: number): void => {
    if (node == null || depth > 8) return
    if (typeof node === 'string') {
      const text = node.trim()
      if (/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) {
        push({ url: text })
      } else if (text.length >= 256 && /^[A-Za-z0-9+/=\r\n]+$/.test(text)) {
        push({ b64_json: text })
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const row = node as Record<string, unknown>
    const urls = Array.isArray(row.url)
      ? row.url.filter((item): item is string => typeof item === 'string')
      : typeof row.url === 'string'
        ? [row.url]
        : []
    const preferredUrl =
      urls.find((item) => /^https?:\/\//i.test(item)) ??
      urls.find((item) => /^data:image\//i.test(item))
    if (preferredUrl) push({ url: preferredUrl })
    const b64Values = Array.isArray(row.b64_json)
      ? row.b64_json.filter((item): item is string => typeof item === 'string')
      : typeof row.b64_json === 'string'
        ? [row.b64_json]
        : []
    if (!preferredUrl && b64Values[0]) push({ b64_json: b64Values[0] })
    for (const key of ['data', 'output', 'outputs', 'images', 'result', 'results', 'image']) {
      if (key in row) visit(row[key], depth + 1)
    }
  }
  visit(value, 0)
  return out
}

function soonStudioTaskIdIn(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.task_id === 'string' && row.task_id.trim()) return row.task_id.trim()
  if (typeof row.taskId === 'string' && row.taskId.trim()) return row.taskId.trim()
  if (typeof row.data === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(row.data.trim())) {
    return row.data.trim()
  }
  if (row.data && typeof row.data === 'object') {
    const nested = row.data as Record<string, unknown>
    if (typeof nested.task_id === 'string' && nested.task_id.trim()) return nested.task_id.trim()
    if (typeof nested.taskId === 'string' && nested.taskId.trim()) return nested.taskId.trim()
  }
  return null
}

function soonStudioFailureIn(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const data = root.data && typeof root.data === 'object'
    ? root.data as Record<string, unknown>
    : root
  const status = String(data.status ?? root.status ?? '').toUpperCase()
  if (status !== 'FAILURE' && status !== 'FAILED' && status !== 'ERROR') return null
  const reason = data.fail_reason ?? data.failReason ?? data.error ?? root.fail_reason ?? root.error
  return typeof reason === 'string' && reason.trim() ? reason.trim() : '生成失败'
}

function transportTextOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'detail' in error) {
    return `${String((error as { kind?: unknown }).kind ?? 'network')}/${String((error as { detail: unknown }).detail)}`
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
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
  /**
   * SoonStudio 的 GPT Image 2 系列走 URL 产物。要求 b64_json 时网关会把整张
   * 4K PNG 内联进 JSON，既显著放大响应，也会撞上桌面回落的 8MB 文本上限。
   * 其他 OpenAI 兼容渠道仍保持原契约，避免扩大改动面。
   */
  const imageResponseFormat = config.protocol === 'soonstudio' ? 'url' : 'b64_json'
  /**
   * Gemini 系图片模型（Nano Banana）的出路：中转站把它们的图放在 **chat 回复正文**里
   * （`![image](url)`），而 `/images/generations` 对 `gemini-3-pro-image` 直接 503。
   * 2026-10-03 真机实测：chat 路径下 `gemini-3-pro-image` 与 `gemini-3.1-flash-image` 都出图。
   */
  const chatUrl = `${base}/chat/completions`

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
  const assetsFromItems = async (
    items: ImageItem[],
    requested: { width?: number; height?: number },
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const assets: GeneratedAsset[] = []
    for (const item of items) {
      if (item.b64_json) {
        const bytes = Uint8Array.from(atob(item.b64_json.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
        // hash 取**产物字节**指纹（内容寻址）：旧的 model|prompt|index 在两次
        // 生成同 model + prompt 时 index 碰撞 ⇒ 不同的图共用一个 hash（用户报）
        const hash = await fingerprintBytes(bytes)
        assets.push(toAsset(hash, 'image/png', bytes, requested))
      } else if (item.url) {
        const dataUri = /^data:([^;,]+);base64,(.*)$/is.exec(item.url)
        const bytes = dataUri
          ? Uint8Array.from(atob(dataUri[2]!.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
          : new Uint8Array(
              await (
                await deps.network.request(
                  { url: item.url, method: 'GET', headers: {}, timeoutMs: GENERATE_TIMEOUT_MS },
                  signal,
                )
              ).arrayBuffer(),
            )
        const hash = await fingerprintBytes(bytes)
        assets.push(toAsset(hash, dataUri?.[1] ?? 'image/png', bytes, requested))
      }
    }
    return assets
  }

  const toAssets = async (
    res: NetworkResponse,
    requested: { width?: number; height?: number },
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const body = await res.json<unknown>()
    const items = imageItemsIn(body)
    if (items.length === 0) {
      throw new ChannelError({
        kind: 'parse',
        raw: `图片接口返回的不是图片列表：${JSON.stringify(body).slice(0, 2000)}`,
      })
    }
    return assetsFromItems(items, requested, signal)
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
      const prepared = await prepareModelImageInput({
        bytes: payload.bytes,
        mime: payload.mime,
      })
      const copy = new Uint8Array(prepared.bytes)
      files.push({
        blob: new Blob([copy as BlobPart], { type: prepared.mime }),
        name: `${item.assetHash.slice(0, 12)}.${fileExtensionOf(prepared.mime)}`,
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
    background: string | null,
    files: { blob: Blob; name: string }[],
    signal: AbortSignal,
  ): Promise<NetworkResponse> => {
    const form = new FormData()
    form.append('model', request.model)
    form.append('prompt', request.prompt)
    form.append('n', String(count))
    if (size) form.append('size', size)
    if (quality) form.append('quality', quality)
    /** 背景（图一）：只在用户显式选了非「自动」时才发 */
    if (background) form.append('background', background)
    form.append('response_format', imageResponseFormat)
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
    background: string | null,
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
          ...(background ? { background } : {}),
          response_format: imageResponseFormat,
        },
        timeoutMs: GENERATE_TIMEOUT_MS,
      },
      signal,
    )

  /**
   * SoonStudio text-to-image uses a short create call plus task polling in the
   * working web client. Keeping the POST open until a 4K result is ready is
   * what times out here. The create response may still contain an immediate
   * image, so both shapes are accepted.
   */
  const generateSoonStudioImage = async (
    request: ImageRunRequest,
    count: number,
    quality: string | null,
    background: string | null,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const ratio =
      typeof request.params.ratio === 'string' && request.params.ratio.trim()
        ? request.params.ratio.trim()
        : 'auto'
    const resolution =
      typeof request.params.resolution === 'string' ? request.params.resolution.trim() : ''
    const imageSize = /^(?:1k|2k|4k)$/i.test(resolution) ? resolution.toUpperCase() : null
    const requested = sizeToDimensions(customImageSize(resolution) ?? openAiImageSize(ratio, resolution))
    let res: NetworkResponse
    try {
      res = await deps.network.request(
        {
          url: `${imagesUrl}?async=true`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
          body: {
            model: request.model,
            prompt: request.prompt,
            n: count,
            aspect_ratio: ratio,
            response_format: 'url',
            ...(imageSize ? { image_size: imageSize } : {}),
            ...(quality ? { quality } : {}),
            ...(background ? { background } : {}),
          },
          timeoutMs: VERIFY_TIMEOUT_MS,
        },
        signal,
      )
    } catch (e) {
      if (signal.aborted) throw e
      throw new ChannelError({
        kind: 'http',
        status: 504,
        body: transportTextOf(e),
        verbatim: true,
      })
    }
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      throw new ChannelError({
        kind: 'http',
        status: res.status,
        body: detail,
        verbatim: true,
      })
    }
    const createdRaw = await res.text()
    let created: unknown
    try {
      created = JSON.parse(createdRaw) as unknown
    } catch {
      throw new ChannelError({
        kind: 'http',
        status: res.status,
        body: createdRaw,
        verbatim: true,
      })
    }
    const immediate = imageItemsIn(created)
    if (immediate.length > 0) return assetsFromItems(immediate, requested, signal)

    const taskId = soonStudioTaskIdIn(created)
    if (!taskId) {
      throw new ChannelError({
        kind: 'http',
        status: res.status,
        body: createdRaw,
        verbatim: true,
      })
    }

    const pollUrl = `${base}/images/tasks/${encodeURIComponent(taskId)}`
    let lastResponse = ''
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (attempt > 0) await waitFor(2_000, signal)
      let poll: NetworkResponse
      try {
        poll = await deps.network.request(
          {
            url: pollUrl,
            method: 'GET',
            headers: authHeader(config.apiKey),
            timeoutMs: VERIFY_TIMEOUT_MS,
          },
          signal,
        )
      } catch (e) {
        if (signal.aborted) throw e
        throw new ChannelError({
          kind: 'http',
          status: 504,
          body: lastResponse || transportTextOf(e),
          verbatim: true,
        })
      }
      if (poll.status < 200 || poll.status >= 300) {
        const detail = await poll.text().catch(() => '')
        throw new ChannelError({
          kind: 'http',
          status: poll.status,
          body: detail,
          verbatim: true,
        })
      }
      const raw = await poll.text()
      let body: unknown
      try {
        body = JSON.parse(raw) as unknown
      } catch {
        throw new ChannelError({
          kind: 'http',
          status: poll.status,
          body: raw,
          verbatim: true,
        })
      }
      lastResponse = raw
      const failure = soonStudioFailureIn(body)
      if (failure) {
        throw new ChannelError({
          kind: 'http',
          status: 502,
          body: raw,
          verbatim: true,
        })
      }
      const items = imageItemsIn(body)
      if (items.length > 0) return assetsFromItems(items, requested, signal)
    }
    throw new ChannelError({
      kind: 'http',
      status: 504,
      body: lastResponse,
      verbatim: true,
    })
  }

  /** 参考素材 → Data URI（Agnes 图片接口文档明写 `image` 收 Data URI Base64） */
  const toDataUris = async (request: ImageRunRequest): Promise<string[]> => {
    const out: string[] = []
    for (const item of imageInputsOf(request.inputs)) {
      const payload = await deps.assets.read(item.assetHash).catch(() => null)
      if (!payload || payload.bytes.length === 0) continue
      const prepared = await prepareModelImageInput({
        bytes: payload.bytes,
        mime: payload.mime || item.mime,
      })
      out.push(
        `data:${prepared.mime};base64,${bytesToBase64(prepared.bytes)}`,
      )
    }
    return out
  }

  /**
   * 参考素材 → Gemini 原生**内联图片**（`{ mimeType, data }`）。
   *
   * 与 `toDataUris` 只差一个 `data:` 前缀：原生 `:generateContent` 要的是分成
   * `mimeType` / `data` 两个字段的对象，不是 Data URI。
   *
   * ⚠️ 这条路径曾经**把参考图整个丢掉**（只发 `parts: [{ text }]`）：图照样能出，
   * 但出的是"照着提示词凭空画"的另一张 —— 用户 2026-10-16 报「出的图不一样、
   * 10 秒左右就出了」就是这个（对账 #551）。删掉这里的图片就等于重新引入那个 bug。
   */
  const toInlineImages = async (
    request: ImageRunRequest,
  ): Promise<{ mimeType: string; data: string }[]> => {
    const out: { mimeType: string; data: string }[] = []
    for (const item of imageInputsOf(request.inputs)) {
      const payload = await deps.assets.read(item.assetHash).catch(() => null)
      if (!payload || payload.bytes.length === 0) continue
      const prepared = await prepareModelImageInput({
        bytes: payload.bytes,
        mime: payload.mime || item.mime,
      })
      out.push({
        mimeType: prepared.mime,
        data: bytesToBase64(prepared.bytes),
      })
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
          response_format: imageResponseFormat,
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
    /**
     * **`gemini` 方言**（Nano Banana Pro / 2）：走 **Gemini 原生端点**
     * `/v1beta/models/<id>:generateContent`。
     *
     * 为什么非走这条不可（2026-10-03 实测）：官方参数 `imageConfig.aspectRatio` /
     * `imageSize` 只在原生端点上生效 —— `1:1 + 2K` 回 2048×2048、`21:9 + 2K` 回
     * 3168×1344（与官方尺寸表逐字对上）；同一模型走 chat / images 路径时，
     * 这两个参数**被中转站吃掉**（三次请求都回同一张 1408×768），
     * 而 `/images/generations` 对 Pro 更是直接 503。
     */
    if (spec?.dialect === 'gemini') {
      const wantedRatio = typeof request.params.ratio === 'string' ? request.params.ratio : ''
      /** 认不出来的值（含面板上的「跟随素材」）一律落到「不下发比例」那一档 */
      const ratio = spec.ratios.includes(wantedRatio) ? wantedRatio : GEMINI_DEFAULT_RATIO
      /** 不下发 `aspectRatio` = 跟输入图一致（没有输入图时官方默认 1:1），只给 imageSize */
      const sendRatio = ratio === GEMINI_DEFAULT_RATIO ? null : ratio
      const wantedSize = String(request.params.resolution ?? '').toUpperCase()
      const imageSize = spec.sizes.find((s) => s.toUpperCase() === wantedSize) ?? spec.sizes[0]
      /** `base` 形如 `…/v1`，原生端点在同一主机的 `/v1beta` 上 */
      const root = base.replace(/\/v1$/, '')
      /** 连进来的参考图 —— 少了这一段，模型就只能凭提示词凭空画（见 `toInlineImages`） */
      const inlineImages = await toInlineImages(request)
      const res = await deps.network.request(
        {
          url: `${root}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
          body: {
            contents: [
              {
                parts: [
                  { text: request.prompt },
                  ...inlineImages.map((image) => ({ inlineData: image })),
                ],
              },
            ],
            generationConfig: {
              responseModalities: ['IMAGE'],
              ...(sendRatio || imageSize
                ? {
                    imageConfig: {
                      ...(sendRatio ? { aspectRatio: sendRatio } : {}),
                      ...(imageSize ? { imageSize } : {}),
                    },
                  }
                : {}),
            },
          },
          timeoutMs: GENERATE_TIMEOUT_MS,
        },
        signal,
      )
      /**
       * `404 / 503` = 这台网关**没有** `/v1beta`（不是参数错），落到下面的 chat 分支
       * 兜底：chat 路径出图没问题，只是官方那两个尺寸参数会被吃掉。
       * 其余非 2xx 才当真正的失败抛出去。
       */
      if (res.status !== 404 && res.status !== 503 && (res.status < 200 || res.status >= 300)) {
        const detail = await res.text().catch(() => '')
        const { error } = classifyError(null, res.status, detail)
        throw new ChannelError(error)
      }
      if (res.status !== 404 && res.status !== 503) {
        const inline = findInlineImage(await res.json<unknown>())
        if (!inline) {
          throw new ChannelError({ kind: 'parse', raw: 'Gemini 响应里没有内联图片' })
        }
        const bytes = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0))
        const hash = await fingerprintBytes(bytes)
        return [toAsset(hash, inline.mimeType, bytes, {})]
      }
    }
    /**
     * **`chat` 方言 / `gemini` 的回退**：请求与解析都换一条路 ——
     * 发 `/chat/completions`，从回复正文里抠出图片地址再取字节。
     * 这条分支必须放在最前：`/images/generations` 对 `gemini-3-pro-image` 是 503。
     */
    if (spec?.dialect === 'chat' || spec?.dialect === 'gemini') {
      /**
       * 参考图走 OpenAI 兼容的**多模态数组**；没有参考图时仍是**字符串** ——
       * 这条路上的网关以「只认 `content: "…"`」为常态，不能顺手改掉它的请求形状。
       * （与 Gemini 原生那条一样，此前是静默把参考图丢掉。）
       */
      const dataUris = await toDataUris(request)
      const content =
        dataUris.length > 0
          ? [
              { type: 'text', text: request.prompt },
              ...dataUris.map((url) => ({ type: 'image_url', image_url: { url } })),
            ]
          : request.prompt
      const res = await deps.network.request(
        {
          url: chatUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
          body: {
            model: request.model,
            messages: [{ role: 'user', content }],
          },
          timeoutMs: GENERATE_TIMEOUT_MS,
        },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        const detail = await res.text().catch(() => '')
        const { error } = classifyError(null, res.status, detail)
        throw new ChannelError(error)
      }
      const body = await res.json<{ choices?: { message?: { content?: unknown } }[] }>()
      const url = imageUrlFromChatContent(body.choices?.[0]?.message?.content)
      if (!url) {
        throw new ChannelError({
          kind: 'parse',
          raw:
            '模型回复里没有图片地址：' +
            (typeof body.choices?.[0]?.message?.content === 'string'
              ? body.choices[0]!.message!.content!.slice(0, 200)
              : '（正文不是字符串）'),
        })
      }
      const dl = await deps.network.request({ url, method: 'GET', headers: {} }, signal)
      const bytes = new Uint8Array(await dl.arrayBuffer())
      const hash = await fingerprintBytes(bytes)
      const mime = /\.jpe?g(\?|$)/i.test(url) ? 'image/jpeg' : 'image/png'
      return [toAsset(hash, mime, bytes, {})]
    }
    /**
     * 三种方言走两条路：
     * - `tier` / `pixel`（Agnes 图片三个）⇒ **能力表 JSON**：`size` 按方言给，
     *   不发 `n` / `quality`（那两个参数它根本没有）；
     * - `ratio+resolution`（Comfy-gpt 的 GPT Image 三个）⇒ **OpenAI 那套**，
     *   只是白名单/张数上限换成能力表里的（`size` 仍然换算成 `WxH`，中转站实测只认这种）。
     */
    /**
     * `openai-images`（GPT Image 三档）走 **OpenAI 那套端点**（`/images/edits` 走 multipart、
     * 否则 `/images/generations`），只是 `size` / `quality` / `n` 按官方规范与能力表来；
     * Agnes 的 `tier` / `pixel` 走下面的「能力表 JSON」分支。
     */
    /**
     * 「走 OpenAI 那套端点」的三种情况：没有能力表（通用兜底）、`openai-images`（GPT Image）、
     * 以及 **`midjourney`**。
     *
     * MJ 为什么也算这一档：它在面板上只有「分辨率（自适应）/ 比例 / 数量」三段，
     * 尺寸字段本来就不发，但**参考图那条路必须留着** —— 走 `postSpecGenerations`
     * 会把连进来的素材整个丢掉（那条分支不读文件）。
     * 它独有的风格参数不走 JSON 字段，而是**拼成提示词后缀**（见下面的 `mjFlags`）。
     */
    const openAiStyle = !spec || spec.dialect === 'openai-images' || spec.dialect === 'midjourney'
    const maxCount = spec ? Math.max(...spec.counts) : Number.POSITIVE_INFINITY
    const count = Math.min(
      maxCount,
      Math.max(1, typeof request.params.count === 'number' ? request.params.count : 1),
    )
    /**
     * 尺寸怎么来：`openai-images`（GPT Image）在面板上给的是**比例 + 清晰度**
     * （用户 2026-10-03 图一），发请求时要按比例 × 清晰度换算成 OpenAI 认的像素 `size`；
     * Agnes 那两个方言的面板值本身就是最终值（档位 / 像素）。
     *
     * **自定义像素优先**（用户 2026-10-15：「自定义要加上」）：用户在「画质」那排
     * 选了「自定义」并填了一个合法像素时，它直接就是 `size` —— 这时比例那一段
     * 在面板上已经退场（自定义尺寸本身就把画幅说全了），不存在「谁覆盖谁」。
     */
    const size =
      spec && spec.dialect !== 'openai-images'
        ? specImageSize(request.params.resolution, spec)
        : (customImageSize(request.params.resolution) ??
          openAiImageSize(request.params.ratio, request.params.resolution))
    /** OpenAI 官方也认 `size: "auto"`，但**我们这边不发它** —— 留给服务端默认 */
    const sizeForBody = size === 'auto' ? null : size
    /**
     * 背景（图一）：`auto` = 不指定，不下发；只下发该模型声明的枚举值。
     * 2026-10-15 起面板只有两档（默认 / 透明底），`opaque` 已从能力表里拿掉 ——
     * 没有能力表的老模型（中转站私有模型）也跟着只放行 `transparent`，
     * 免得节点上一条历史数据把用户早就删掉的那一档又发出去。
     */
    const rawBackground = typeof request.params.background === 'string' ? request.params.background : ''
    const background =
      rawBackground && rawBackground !== 'auto' && (spec ? spec.backgrounds : ['transparent']).includes(rawBackground)
        ? rawBackground
        : null
    const quality = spec
      ? openAiImageQuality(
          request.params.quality,
          openAiStyle ? spec.qualities : [],
        )
      : openAiImageQuality(request.params.quality)
    // 有参考图 → 图生图（multipart）；一张都没有 → 文生图（JSON，与 M6-12 前一致）
    const files = openAiStyle ? await readImageFiles(request) : []
    /**
     * Midjourney：把「高级设置」拼成**提示词后缀**（`--stylize 100 --weird 50 …`）。
     *
     * MJ 的参数**本来就写在提示词里**，这是它唯一被官方支持的传参方式；
     * 拼完只在**这一个模型**上生效（见 `mjParams.ts` 的说明与出处的注记）。
     */
    const mjSuffix = spec?.dialect === 'midjourney' ? mjFlags(request.params.mj) : ''
    const outbound: ImageRunRequest = mjSuffix
      ? { ...request, prompt: `${request.prompt} ${mjSuffix}`.trim() }
      : request
    if (config.protocol === 'soonstudio' && files.length === 0) {
      return generateSoonStudioImage(outbound, count, quality, background, signal)
    }
    const res = !openAiStyle && size
      ? await postSpecGenerations(request, size, spec as ImageParamSpec, await toDataUris(request), signal)
      : files.length > 0
        ? await postEdits(outbound, count, sizeForBody, quality, background, files, signal)
        : await postGenerations(outbound, count, sizeForBody, quality, background, signal)

    if (res.status < 200 || res.status >= 300) {
      /**
       * 生图失败时把响应体一并带回 —— 这里是用户最常撞上 403 的地方
       * （模型没开通 / 额度不足 / 渠道限制），而原因就在 body 里。
       */
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    return toAssets(res, sizeToDimensions(sizeForBody), signal)
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
