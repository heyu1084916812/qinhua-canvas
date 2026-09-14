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
      return `HTTP ${e.status}`
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
