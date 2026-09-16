import type { AppError } from '../../shared/result'
import { asAppError } from '../../shared/result'
import type { ModelCapability } from '../../domain/shared/capability'

/**
 * OpenAI 兼容协议的**公共零件**（地址归一、错误归一、鉴权头）。
 *
 * 抽出来的直接原因：聊天协议（`openai-chat`）与生图协议（`openai-images`）
 * 共用同一套错误语义与地址写法。若各写一份，用户在设置页看到的失败文案就会
 * 「同一个 401，两种说法」——而这正是 M6-14 刚修掉的「失败原因一个字都没传上来」
   * 那类问题的温床。
 *
 * 纯度：只依赖 `shared/result`，无副作用、无 IO（架构 §2.2）。
 */

export const VERIFY_TIMEOUT_MS = 10_000
export const GENERATE_TIMEOUT_MS = 120_000
/** 聊天比出图快得多，且中转常对长连接掐得更早，单独给一个更短的超时 */
export const CHAT_TIMEOUT_MS = 60_000

/** mime → 上传文件名后缀；未知类型回落到 png（多数图床按内容嗅探，后缀只作提示） */
export function fileExtensionOf(mime: string): string {
  const sub = mime.toLowerCase().split('/')[1] ?? 'png'
  if (sub === 'jpeg') return 'jpg'
  return /^[a-z0-9]+$/.test(sub) ? sub : 'png'
}

export function authHeader(apiKey: string | null): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/**
 * 归一化 OpenAI 兼容中转的 Base URL。
 *
 * 中继对「地址含不含版本段」没有统一约定：官方文档写 `https://api.openai.com`，
 * 但后台常直接给 `https://xxx/v1`（gpt-best 这类中转的文档就明确两种写法都可能）。
 * 适配器原本无条件拼 `/v1/...`，于是「地址已含 /v1」时会变成 `/v1/v1/models`——
 * 一律 404，而错误只会说「端点不存在」，用户根本猜不到是自己多贴了一段。
 * 这里统一剥掉结尾的版本段，再由适配器补一次，两种写法都成立。
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v\d+$/i, '')
}

/** 网络细节 → 用户能据以自查的文案。光说「网络错误」等于没说，得点到地址/证书/CORS */
export const NETWORK_MESSAGE: Record<'dns' | 'tls' | 'cors' | 'timeout' | 'aborted', string> = {
  dns: '连不上这个地址（域名解析失败或连接被拒绝）——核对地址、确认中继可达',
  tls: 'TLS 证书错误（证书不受信任）',
  cors: '跨域被拦截，中继需开放 CORS',
  timeout: '请求超时，服务无响应',
  aborted: '请求已取消',
}

export function httpMessage(status: number): string {
  if (status === 401 || status === 403) return 'API Key 无效或无权限（401/403）'
  if (status === 404) return '端点不存在，检查地址与协议（404）'
  if (status === 429) return '请求过于频繁（429）'
  if (status >= 500) return `服务端错误（${status}）`
  return `HTTP ${status}`
}

/** 已有 HTTP 状态码时的归一化（error 联合 + 可读文案） */
export function statusToFailure(status: number): { error: AppError; message: string } {
  const message = httpMessage(status)
  if (status === 401 || status === 403) return { error: { kind: 'channel', detail: 'missingKey' }, message }
  return { error: { kind: 'http', status }, message }
}

/** 归一化的 AppError → 可读文案（verify/listModels 的失败会直接显示在设置页状态行） */
export function appErrorMessage(e: AppError): string {
  switch (e.kind) {
    case 'network':
      return NETWORK_MESSAGE[e.detail]
    case 'http':
      return httpMessage(e.status)
    case 'channel':
      return e.detail === 'missingKey' ? httpMessage(401) : `渠道不支持该能力（${e.detail}）`
    case 'parse':
      return '响应不是合法 JSON'
    case 'storage':
      return `存储错误：${e.detail}`
    case 'validation':
      return `${e.field}：${e.reason}`
  }
}

export function classifyError(e: unknown, status?: number): { error: AppError; message: string } {
  if (typeof status === 'number') return statusToFailure(status)
  // 网络端口抛的是**归一化后的 AppError 字面量**、渠道层抛的是 ChannelError（载荷在 appError 上），
  // 两者都不是「有 message 的 Error」。早先这里只认 `instanceof Error`，于是它们一路掉到
  // `String(e)`，设置页状态行显示「✗ [object Object]」——失败原因一个字都没传上来。
  const app = asAppError(e)
  if (app) return { error: app, message: appErrorMessage(app) }
  if (e instanceof Error) {
    const msg = e.message.toLowerCase()
    if (msg.includes('cors') || msg.includes('cross-origin')) return { error: { kind: 'network', detail: 'cors' }, message: '跨域被拦截，中继需开放 CORS' }
    if (msg.includes('certificate') || msg.includes('tls') || msg.includes('ssl')) return { error: { kind: 'network', detail: 'tls' }, message: 'TLS / 证书错误' }
    if (msg.includes('timeout') || msg.includes('aborted')) return { error: { kind: 'network', detail: 'timeout' }, message: '请求超时' }
    if (msg.includes('dns') || msg.includes('resolve') || msg.includes('fetch')) return { error: { kind: 'network', detail: 'dns' }, message: NETWORK_MESSAGE.dns }
    return { error: { kind: 'network', detail: 'dns' }, message: e.message }
  }
  return { error: { kind: 'parse', raw: String(e) }, message: String(e) }
}

/**
 * `/v1/models` 里的一个 id → 能力表（生图与聊天协议共用同一套判据）。
 *
 * 按 id 里的关键词猜类别是**退而求其次**：中转站的 `/v1/models` 基本不带类别字段，
 * 而面板要按类别筛模型（提示词节点只列 `chat`、生成节点只列 `image` / `video`）。
 * 猜错的代价是「这个模型没出现在该出现的位置」，比「把所有模型都塞给用户」小。
 */
export function toModelCapability(modelId: string): ModelCapability {
  const id = modelId.toLowerCase()
  const category: ModelCapability['category'] = id.includes('video')
    ? 'video'
    : id.includes('image')
      ? 'image'
      : 'chat'
  return {
    id: modelId,
    category,
    inputTypes: category === 'chat' ? ['text'] : ['text', 'image'],
    /**
     * 比例能力表：与面板兜底档位**同一套九档**（§6.8）。
     *
     * 中转站的 `/v1/models` 基本不报 `aspectRatios`，所以这张表就是用户实际能选到的
     * 全部比例——早先写死 5 档，用支持到 21:9 的模型（如香蕉系）时明显不够选。
     * 改成与 `CreationPanel.RATIO_OPTIONS` 一致的九档，两处口径合一；
     * 真渠道上报了自己的比例时，仍以模型上报值为准。
     */
    aspectRatios: [
      '1:1',
      '1:2',
      '2:1',
      '9:16',
      '16:9',
      '3:4',
      '4:3',
      '3:2',
      '2:3',
      '5:4',
      '4:5',
      '21:9',
      '9:21',
    ],
    /**
     * 清晰度档位。**必须包含 4K**：这张表是「模型支持哪些档位」的单一事实来源，
     * 面板按它过滤 —— 少写一档，用户在面板上就永远看不到那一档（报「没有 4K」的根因）。
     */
    resolutions: ['1k', '2k', '4k'],
    qualities: ['auto', 'low', 'medium', 'high'],
    maxCount: 4,
  }
}

/**
 * `/v1/models` 响应 → 能力表。
 *
 * 「200 不等于这里是 OpenAI 兼容接口」：SPA 站点、登录页、网关默认页都会对任意
 * 路径回 200（index.html）。若把这类响应判为成功，「验证协议」的自动选中就成了
 * 假动作（任何地址都会命中第一个候选协议）。所以要求响应体里**真有一份模型列表**
 * 才认——这个判定两个协议共用，放在这里而不是各自的实现里。
 */
export function isModelListBody(body: unknown): body is { data: { id: string }[] } {
  return !!body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)
}
