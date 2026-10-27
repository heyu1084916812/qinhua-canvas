import {
  AGENT_EVENT_TYPES,
  isActiveAgentJobStatus,
  isAgentJobStatus,
  isTerminalAgentJobStatus,
  transitionAgentJob,
  type AgentEvent,
  type AgentEventType,
  type AgentJob,
  type AgentJobCheckpoint,
  type AgentJobPatch,
  type AgentJobStatus,
} from '../../domain/agent/job'
import type { RowOf, StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'

export interface AgentJobStore {
  create(input: {
    sessionId: string
    projectId: string
    turnId: string
  }): Promise<{ job: AgentJob; event: AgentEvent; created: boolean }>
  get(id: string): Promise<AgentJob | null>
  list(sessionId: string): Promise<AgentJob[]>
  active(sessionId: string): Promise<AgentJob | null>
  forTurn(sessionId: string, turnId: string): Promise<AgentJob | null>
  events(jobId: string): Promise<AgentEvent[]>
  transition(
    id: string,
    to: AgentJobStatus,
    eventType?: AgentEventType,
    patch?: AgentJobPatch,
    payload?: Record<string, unknown>,
  ): Promise<{ job: AgentJob; event: AgentEvent } | null>
  appendEvent(
    id: string,
    type: AgentEventType,
    payload?: Record<string, unknown>,
  ): Promise<AgentEvent | null>
  /** 应用重启后恢复；等待生成的任务绝不自动重发。 */
  recoverSession(sessionId: string): Promise<AgentJob[]>
}

const EVENT_TYPES = new Set<AgentEventType>(AGENT_EVENT_TYPES)

function normalizeCheckpoint(value: unknown): AgentJobCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (
    row.kind !== 'max_steps' ||
    typeof row.maxSteps !== 'number' ||
    typeof row.completedSteps !== 'number'
  ) {
    return undefined
  }
  return {
    kind: 'max_steps',
    maxSteps: Math.max(1, Math.trunc(row.maxSteps)),
    completedSteps: Math.max(1, Math.trunc(row.completedSteps)),
    savedAt:
      typeof row.savedAt === 'number' ? Math.max(0, row.savedAt) : 0,
  }
}

function toJob(row: RowOf<'agentJobs'>): AgentJob {
  const status = isAgentJobStatus(row.status) ? row.status : 'failed'
  return {
    id: String(row.id),
    sessionId: String(row.sessionId ?? ''),
    projectId: String(row.projectId ?? ''),
    turnId: String(row.turnId ?? ''),
    status,
    revision:
      typeof row.revision === 'number' && Number.isFinite(row.revision)
        ? Math.max(0, Math.trunc(row.revision))
        : 0,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
    ...(typeof row.startedAt === 'number' && row.startedAt > 0
      ? { startedAt: row.startedAt }
      : {}),
    ...(typeof row.finishedAt === 'number' && row.finishedAt > 0
      ? { finishedAt: row.finishedAt }
      : {}),
    ...(typeof row.operationId === 'string' && row.operationId
      ? { operationId: row.operationId }
      : {}),
    ...(row.checkpoint
      ? (() => {
          const checkpoint = normalizeCheckpoint(row.checkpoint)
          return checkpoint ? { checkpoint } : {}
        })()
      : {}),
    ...(typeof row.pendingCallId === 'string' && row.pendingCallId
      ? { pendingCallId: row.pendingCallId }
      : {}),
    ...(typeof row.lastError === 'string' && row.lastError
      ? { lastError: row.lastError }
      : {}),
  }
}

function toEvent(row: RowOf<'agentEvents'>): AgentEvent {
  const type = EVENT_TYPES.has(row.type as AgentEventType)
    ? (row.type as AgentEventType)
    : 'status_changed'
  const payload =
    row.payload && typeof row.payload === 'object'
      ? { ...(row.payload as Record<string, unknown>) }
      : {}
  return {
    id: String(row.id),
    jobId: String(row.jobId ?? ''),
    sessionId: String(row.sessionId ?? ''),
    projectId: String(row.projectId ?? ''),
    seq: Number(row.seq ?? 1),
    type,
    createdAt: Number(row.createdAt ?? 0),
    payload,
  }
}

function eventRow(event: AgentEvent): RowOf<'agentEvents'> {
  return event as unknown as RowOf<'agentEvents'>
}

function jobRow(job: AgentJob): RowOf<'agentJobs'> {
  return job as unknown as RowOf<'agentJobs'>
}

function nextEvent(
  job: AgentJob,
  previous: readonly AgentEvent[],
  type: AgentEventType,
  at: number,
  payload: Record<string, unknown> = {},
): AgentEvent {
  return {
    id: createId('aevent'),
    jobId: job.id,
    sessionId: job.sessionId,
    projectId: job.projectId,
    seq: Math.max(0, ...previous.map((event) => event.seq)) + 1,
    type,
    createdAt: at,
    payload,
  }
}

export function createAgentJobStore(storage: StoragePort): AgentJobStore {
  const get = async (id: string): Promise<AgentJob | null> => {
    const rows = await storage.query('agentJobs', { id })
    return rows[0] ? toJob(rows[0]) : null
  }

  const createJob: AgentJobStore['create'] = async ({
    sessionId,
    projectId,
    turnId,
  }) =>
    storage.transaction(['agentJobs', 'agentEvents'], async (tx) => {
      const existing = (await tx.query('agentJobs', { sessionId }))
        .map(toJob)
        .find((job) => job.turnId === turnId)
      if (existing) {
        const events = (await tx.query('agentEvents', { jobId: existing.id }))
          .map(toEvent)
          .sort((a, b) => a.seq - b.seq)
        return {
          job: existing,
          event: events[events.length - 1]!,
          created: false,
        }
      }
      const at = Date.now()
      const job: AgentJob = {
        id: createId('ajob'),
        sessionId,
        projectId,
        turnId,
        status: 'queued',
        revision: 0,
        createdAt: at,
        updatedAt: at,
      }
      const event = nextEvent(job, [], 'created', at)
      await tx.put('agentJobs', jobRow(job))
      await tx.put('agentEvents', eventRow(event))
      return { job, event, created: true }
    })

  const listJobs: AgentJobStore['list'] = async (sessionId) => {
    const rows = await storage.query('agentJobs', { sessionId })
    return rows.map(toJob).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  const activeJob: AgentJobStore['active'] = async (sessionId) =>
    (await listJobs(sessionId)).find((job) =>
      isActiveAgentJobStatus(job.status),
    ) ?? null

  const turnJob: AgentJobStore['forTurn'] = async (sessionId, turnId) =>
    (await storage.query('agentJobs', { sessionId }))
      .map(toJob)
      .find((job) => job.turnId === turnId) ?? null

  const eventsOf: AgentJobStore['events'] = async (jobId) => {
    const rows = await storage.query('agentEvents', { jobId })
    return rows.map(toEvent).sort((a, b) => a.seq - b.seq)
  }

  const transitionJob: AgentJobStore['transition'] = async (
    id,
    to,
    eventType = 'status_changed',
    patch = {},
    payload = {},
  ) =>
    storage.transaction(['agentJobs', 'agentEvents'], async (tx) => {
      const rows = await tx.query('agentJobs', { id })
      if (!rows[0]) return null
      const current = toJob(rows[0])
      if (
        payload.recovery !== true &&
        (to === 'planning' || isActiveAgentJobStatus(to))
      ) {
        const sameSession = (await tx.query('agentJobs', {
          sessionId: current.sessionId,
        })).map(toJob)
        const conflict = sameSession.find(
          (job) =>
            job.id !== current.id && isActiveAgentJobStatus(job.status),
        )
        if (conflict) {
          throw new Error(`会话已有活动 AgentJob：${conflict.id}`)
        }
      }
      const at = Date.now()
      const job = transitionAgentJob(current, to, at, patch)
      if (job === current && Object.keys(payload).length === 0) {
        const events = (await tx.query('agentEvents', { jobId: id }))
          .map(toEvent)
          .sort((a, b) => a.seq - b.seq)
        return { job, event: events[events.length - 1]! }
      }
      const previous = (await tx.query('agentEvents', { jobId: id }))
        .map(toEvent)
        .sort((a, b) => a.seq - b.seq)
      const finalType =
        to === 'completed'
          ? 'completed'
          : to === 'failed'
            ? 'failed'
            : to === 'canceled'
              ? 'canceled'
              : to === 'paused' && patch.checkpoint
                ? 'checkpoint_saved'
                : to === 'waiting_confirmation'
                  ? 'confirmation_requested'
                  : eventType
      const event = nextEvent(job, previous, finalType, at, {
        from: current.status,
        to,
        ...payload,
      })
      await tx.put('agentJobs', jobRow(job))
      await tx.put('agentEvents', eventRow(event))
      return { job, event }
    })

  const appendEvent: AgentJobStore['appendEvent'] = async (
    id,
    type,
    payload = {},
  ) =>
    storage.transaction(['agentJobs', 'agentEvents'], async (tx) => {
      const rows = await tx.query('agentJobs', { id })
      if (!rows[0]) return null
      const job = toJob(rows[0])
      const previous = (await tx.query('agentEvents', { jobId: id }))
        .map(toEvent)
        .sort((a, b) => a.seq - b.seq)
      const at = Date.now()
      const event = nextEvent(job, previous, type, at, payload)
      await tx.put('agentEvents', eventRow(event))
      return event
    })

  const recoverSession: AgentJobStore['recoverSession'] = async (sessionId) => {
    const jobs = (await storage.query('agentJobs', { sessionId }))
      .map(toJob)
      .filter((job) => !isTerminalAgentJobStatus(job.status))
    const recovered: AgentJob[] = []
    for (const job of jobs) {
      const target: AgentJobStatus =
        job.status === 'planning'
          ? 'paused'
          : job.status === 'waiting_generation'
            ? 'needs_attention'
            : job.status
      if (target === job.status) {
        await appendEvent(job.id, 'recovered', { status: target })
        recovered.push(job)
        continue
      }
      const result = await transitionJob(
        job.id,
        target,
        'recovered',
        {},
        { recovery: true },
      )
      if (result) recovered.push(result.job)
    }
    return recovered
  }

  return {
    get,
    create: createJob,
    list: listJobs,
    active: activeJob,
    forTurn: turnJob,
    events: eventsOf,
    transition: transitionJob,
    appendEvent,
    recoverSession,
  }
}
