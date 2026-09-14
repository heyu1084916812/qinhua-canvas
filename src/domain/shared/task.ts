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

/** 仅网络中断、408、429、5xx 可重试 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true
  return status >= 500 && status <= 599
}

/** 日志按项目滚动裁剪，保留最近 limit 条 */
export function trimLog<T>(entries: readonly T[], limit: number): T[] {
  if (entries.length <= limit) return entries.slice()
  return entries.slice(entries.length - limit)
}
