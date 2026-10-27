/**
 * Agent 任务的生命周期与事件词表。
 *
 * 会话队列回答“下一句话什么时候跑”；AgentJob 回答“这一件任务做到哪、为什么停、
 * 下一步允许进入什么状态”。两者不能再用一个布尔 status 混在一起。
 */

export const AGENT_JOB_STATUSES = [
  'queued',
  'planning',
  'waiting_confirmation',
  'waiting_generation',
  'paused',
  'needs_attention',
  'completed',
  'failed',
  'canceled',
] as const

export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number]

export const TERMINAL_AGENT_JOB_STATUSES: readonly AgentJobStatus[] = [
  'completed',
  'failed',
  'canceled',
]

export const ACTIVE_AGENT_JOB_STATUSES: readonly AgentJobStatus[] = [
  'planning',
  'waiting_confirmation',
  'waiting_generation',
  'paused',
  'needs_attention',
]

const TRANSITIONS: Record<AgentJobStatus, readonly AgentJobStatus[]> = {
  queued: ['planning', 'canceled'],
  planning: [
    'waiting_confirmation',
    'waiting_generation',
    'paused',
    'completed',
    'failed',
    'canceled',
  ],
  waiting_confirmation: ['planning', 'paused', 'failed', 'canceled'],
  waiting_generation: [
    'planning',
    'completed',
    'needs_attention',
    'failed',
    'canceled',
  ],
  paused: ['planning', 'canceled'],
  needs_attention: ['completed', 'failed', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
}

export interface AgentJobCheckpoint {
  kind: 'max_steps'
  maxSteps: number
  completedSteps: number
  savedAt: number
}

export interface AgentJob {
  id: string
  sessionId: string
  projectId: string
  /** 与 queuedTurns.id 对应；直接发送也生成稳定 turnId。 */
  turnId: string
  status: AgentJobStatus
  revision: number
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  operationId?: string
  checkpoint?: AgentJobCheckpoint
  pendingCallId?: string
  lastError?: string
}

export const AGENT_EVENT_TYPES = [
  'created',
  'status_changed',
  'message_queued',
  'steer_applied',
  'checkpoint_saved',
  'confirmation_requested',
  'confirmation_resolved',
  'generation_started',
  'generation_finished',
  'interrupted',
  'recovered',
  'completed',
  'failed',
  'canceled',
] as const

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number]

export interface AgentEvent {
  id: string
  jobId: string
  sessionId: string
  projectId: string
  seq: number
  type: AgentEventType
  createdAt: number
  payload: Record<string, unknown>
}

export function isAgentJobStatus(value: unknown): value is AgentJobStatus {
  return AGENT_JOB_STATUSES.includes(value as AgentJobStatus)
}

export function isTerminalAgentJobStatus(status: AgentJobStatus): boolean {
  return TERMINAL_AGENT_JOB_STATUSES.includes(status)
}

export function isActiveAgentJobStatus(status: AgentJobStatus): boolean {
  return ACTIVE_AGENT_JOB_STATUSES.includes(status)
}

export function canTransitionAgentJob(
  from: AgentJobStatus,
  to: AgentJobStatus,
): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

export function assertAgentJobTransition(
  from: AgentJobStatus,
  to: AgentJobStatus,
): void {
  if (!canTransitionAgentJob(from, to)) {
    throw new Error(`AgentJob 不允许从 ${from} 进入 ${to}`)
  }
}

export interface AgentJobPatch {
  operationId?: string
  checkpoint?: AgentJobCheckpoint
  pendingCallId?: string
  lastError?: string
}

export function transitionAgentJob(
  job: AgentJob,
  to: AgentJobStatus,
  at: number,
  patch: AgentJobPatch = {},
): AgentJob {
  assertAgentJobTransition(job.status, to)
  if (job.status === to && Object.keys(patch).length === 0) return job
  const terminal = isTerminalAgentJobStatus(to)
  return {
    ...job,
    ...patch,
    status: to,
    revision: job.revision + 1,
    updatedAt: at,
    startedAt:
      job.startedAt ?? (to !== 'queued' && to !== 'canceled' ? at : undefined),
    finishedAt: terminal ? at : undefined,
  }
}
