/**
 * 错误在产生处分类，在展示处映射文案（架构 §6.2）
 */
export type AppError =
  | { kind: 'network'; detail: 'dns' | 'tls' | 'cors' | 'timeout' | 'aborted' }
  | { kind: 'http'; status: number; body?: string }
  | { kind: 'parse'; raw: string }
  | { kind: 'storage'; detail: 'quota' | 'corrupt' | 'permission' }
  | { kind: 'validation'; field: string; reason: string }
  | { kind: 'channel'; detail: 'missingKey' | 'missingModel' | 'unsupported' }

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

/**
 * 从 HTTP 错误响应体里抠出**服务端自己给的原因**。
 *
 * 放在 shared 而不是 platform：**产生错误的地方要解析它，展示错误的地方也要解析它**，
 * 而 shared 是两者唯一的共同下层。放到 platform 会让 shared 反向依赖 platform（架构禁止）。
 *
 * OpenAI 兼容格式是 `{"error":{"message":"..."}}`；少数中转把原因放在顶层
 * `message` / `detail`。都不是就返回 null —— **不猜**，宁可只显示状态码。
 * 不是 JSON 时原样回一段（截断），总比什么都不给强。
 */
export function serverReasonOf(body?: string): string | null {
  if (!body) return null
  const raw = body.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const err = (parsed as { error?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err.trim()
    if (err && typeof err === 'object') {
      const msg = (err as { message?: unknown }).message
      if (typeof msg === 'string' && msg.trim()) return msg.trim()
    }
    for (const key of ['message', 'detail'] as const) {
      const v = (parsed as Record<string, unknown>)[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return null
  } catch {
    return raw.slice(0, 200)
  }
}

export function Ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function Err<T = never>(error: AppError): Result<T> {
  return { ok: false, error }
}

export function isOk<T>(r: Result<T>): r is { ok: true; value: T } {
  return r.ok
}

export function describeError(e: AppError): string {
  switch (e.kind) {
    case 'network':
      return `网络错误：${e.detail}`
    case 'http':
      /**
       * 带上服务端原话（如果拿到了）。
       *
       * 此前只出「HTTP 403」这样的三个字符，用户看完仍然不知道发生了什么——
       * 而 403 的成因远不止一种（模型未开通 / 额度用尽 / IP 白名单 / 渠道被禁），
       * **真正的原因就写在响应体里**。适配器已经把 body 收进 AppError 了，
       * 这里再不显示就等于白收。
       */
      return e.body ? `HTTP ${e.status}｜${serverReasonOf(e.body) ?? e.body.slice(0, 200)}` : `HTTP ${e.status}`
    case 'parse':
      return '解析失败'
    case 'storage':
      return `存储错误：${e.detail}`
    case 'validation':
      return `${e.field}：${e.reason}`
    case 'channel':
      return `渠道错误：${e.detail}`
  }
}

/**
 * 从任意抛出物里取出归一化后的 `AppError`。
 *
 * 平台层抛出的**不是 Error 实例**：
 *  - 网络端口直接抛 AppError 字面量（如 `throw { kind: 'network', detail: 'dns' }`）；
 *  - 渠道层抛 `ChannelError`，真载荷在 `appError` 字段上。
 *
 * 于是「只认 `instanceof Error`」的调用方会掉进两个坑：
 * 走 `String(e)` 得到 `[object Object]`（用户完全看不懂），
 * 或拿到 `ChannelError` 的调试串 `[channel] network`（内部术语泄漏到 UI）。
 * 故凡是要展示错误信息的地方，先过这一层。
 */
export function asAppError(e: unknown): AppError | null {
  if (!e || typeof e !== 'object') return null
  if ('appError' in e) {
    const inner = (e as { appError?: unknown }).appError
    if (inner && typeof inner === 'object' && 'kind' in inner) return inner as AppError
  }
  return 'kind' in e ? (e as AppError) : null
}
