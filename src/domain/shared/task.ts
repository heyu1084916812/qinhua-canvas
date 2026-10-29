import type { AppError } from '../../shared/result'

/** 异步操作状态机（产品文档 §10.1） */
export type TaskState =
  | 'idle'
  | 'validating'
  | 'queued'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'canceled'

const TERMINAL: ReadonlySet<TaskState> = new Set<TaskState>([
  'succeeded',
  'partial',
  'failed',
  'canceled',
])

/** 启动时需要被中断恢复接管的状态（产品文档 §12.2） */
const INTERRUPTIBLE: ReadonlySet<TaskState> = new Set<TaskState>([
  'validating',
  'queued',
  'running',
  'retrying',
])

export function isTerminal(state: TaskState): boolean {
  return TERMINAL.has(state)
}

export function isInterruptible(state: TaskState): boolean {
  return INTERRUPTIBLE.has(state)
}

export interface TaskLogEntry {
  id: string
  projectId: string
  nodeId: string
  state: TaskState
  createdAt: number
  durationMs?: number
  cost?: number
  error?: string
}

/**
 * 退避时长：1s、2s + 抖动（产品文档 §6.19.6）。
 * attempt 从 0 开始；jitter 由调用方注入 [0,1)，domain 不读随机数。
 */
export function backoffMs(attempt: number, baseMs: number, jitter: number): number {
  const capped = Math.min(attempt, 4)
  const raw = baseMs * 2 ** capped
  return Math.round(raw * (1 + jitter))
}

/** 仅 429 与 5xx 可重试；408 可能已被上游受理，付费请求不得自动重发 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true
  return status >= 500 && status <= 599
}

export function isRequestResendSafe(error: AppError): boolean {
  return error.kind === 'network' && error.sendPhase === 'not-sent'
}

/**
 * 是否允许从当前路由候选切到下一个候选。
 *
 * 付费请求一旦可能到达上游，就不能因为还有备用渠道而再发一次。只有明确未发出，
 * 或服务端已经明确拒绝且没有受理（401 / 403 / 429 / 5xx）时才允许换候选。
 */
export function isRouteFallbackSafe(error: AppError): boolean {
  if (error.kind === 'network') return isRequestResendSafe(error)
  /**
   * OpenAI 兼容 HTTP 401 在协议层归一为 `channel/missingKey`，用来让设置页
   * 说清“凭据无效”；它仍是上游明确拒绝、没有受理付费任务，可以安全换候选。
   * 真正的本地“没填 Key”发生在发送前，同样不需要重发当前候选。
   */
  if (error.kind === 'channel' && error.detail === 'missingKey') return true
  if (error.kind === 'http') {
    return (
      error.status === 401 ||
      error.status === 403 ||
      error.status === 429 ||
      error.status >= 500
    )
  }
  return false
}

/** 日志按项目滚动裁剪，保留最近 limit 条 */
export function trimLog<T>(entries: readonly T[], limit: number): T[] {
  if (entries.length <= limit) return entries.slice()
  return entries.slice(entries.length - limit)
}
