import type { AgentSession, AgentSessionStore } from '../../../state/agent/sessionStore'
import type { AgentJobStore } from '../../../state/agent/jobStore'
import type { AgentToolRequest } from '../../../domain/agent/toolRequest'
import type {
  AgentEventType,
  AgentJob,
  AgentJobPatch,
  AgentJobStatus,
} from '../../../domain/agent/job'
import {
  confirmationApprovalSteps,
  confirmationRunsGeneration,
  type ConfirmationRequestRef,
} from '../../../domain/agent/confirmation'
import type { QueuedAgentTurn } from '../../../domain/agent/queuedTurn'

export interface AgentControllerHooks {
  isSessionActivityActive: (sessionId: string) => boolean
  onPendingConfirmation: (sessionId: string, request: AgentToolRequest) => void
  onContinuation: (sessionId: string, maxSteps: number) => void
  onNeedsAttention: (sessionId: string, message: string) => void
  onIdle: (sessionId: string) => void
  notify: (message: string, tone: 'info' | 'error') => void
}

export interface AgentController {
  sessions: AgentSessionStore
  jobs: AgentJobStore
  jobId: (sessionId: string) => string | undefined
  ensureJob: (session: AgentSession, turnId: string) => Promise<AgentJob>
  transition: (
    sessionId: string,
    to: AgentJobStatus,
    eventType?: AgentEventType,
    patch?: AgentJobPatch,
    payload?: Record<string, unknown>,
  ) => Promise<{ job: AgentJob; event: import('../../../domain/agent/job').AgentEvent } | null>
  beginConfirmation: (
    sessionId: string,
    request: ConfirmationRequestRef,
  ) => Promise<void>
  finishConfirmedTool: (
    sessionId: string,
    request: ConfirmationRequestRef,
  ) => Promise<void>
  enqueueTurn: (
    sessionId: string,
    turn: QueuedAgentTurn,
  ) => Promise<
    | { ok: true; session: AgentSession }
    | { ok: false; reason: 'missing' | 'empty' | 'full' }
  >
  removeQueuedTurn: (sessionId: string, turnId: string) => Promise<AgentSession | null>
  editQueuedTurn: (
    sessionId: string,
    turnId: string,
    text: string,
  ) => Promise<AgentSession | null>
  /** 读回项目会话，并修复上次进程中断留下的运行态。 */
  refresh: () => Promise<AgentSession[]>
}

/**
 * 画布 Agent 的宿主控制器。
 *
 * 第一刀只抽出“会话列表 + Job 恢复”这层确定性生命周期；模型循环、确认执行和
 * React 展示仍由现有 AgentPanel 持有。这样 HarnessRuntimePort 接入时，
 * 可以直接复用同一套会话恢复规则，而不用再复制一份。
 */
export function createAgentController(input: {
  projectId: string
  sessions: AgentSessionStore
  jobs: AgentJobStore
  hooks: AgentControllerHooks
}): AgentController {
  const { projectId, sessions, jobs, hooks } = input
  const jobIds = new Map<string, string>()

  const jobId = (sessionId: string): string | undefined =>
    jobIds.get(sessionId)

  const ensureJob = async (
    session: AgentSession,
    turnId: string,
  ): Promise<AgentJob> => {
    const mappedId = jobIds.get(session.id)
    if (mappedId) {
      const mapped = await jobs.get(mappedId)
      if (mapped) return mapped
      jobIds.delete(session.id)
    }
    let existing = await jobs.forTurn(session.id, turnId)
    if (!existing) {
      const active = await jobs.active(session.id)
      if (active?.status === 'needs_attention') {
        await jobs
          .transition(
            active.id,
            'canceled',
            'canceled',
            {},
            { reason: 'new_turn_after_needs_attention' },
          )
          .catch(() => null)
      } else {
        existing = active
      }
    }
    const job =
      existing ??
      (await jobs.create({
        sessionId: session.id,
        projectId,
        turnId,
      })).job
    jobIds.set(session.id, job.id)
    return job
  }

  const transition: AgentController['transition'] = async (
    sessionId,
    to,
    eventType = 'status_changed',
    patch = {},
    payload = {},
  ) => {
    let id = jobIds.get(sessionId)
    if (!id) {
      const active = await jobs.active(sessionId)
      if (active) {
        id = active.id
        jobIds.set(sessionId, id)
      }
    }
    if (!id) return null
    const result = await jobs.transition(id, to, eventType, patch, payload)
    if (
      result &&
      (to === 'completed' || to === 'failed' || to === 'canceled')
    ) {
      jobIds.delete(sessionId)
    }
    return result
  }

  const beginConfirmation: AgentController['beginConfirmation'] = async (
    sessionId,
    request,
  ) => {
    await sessions.updateFields(sessionId, { pendingConfirmation: undefined })
    for (const step of confirmationApprovalSteps(request)) {
      await transition(
        sessionId,
        step.to,
        step.eventType,
        step.patch,
        { tool: request.name, approved: true },
      )
    }
  }

  const finishConfirmedTool: AgentController['finishConfirmedTool'] = async (
    sessionId,
    request,
  ) => {
    if (!confirmationRunsGeneration(request.name)) return
    await transition(
      sessionId,
      'planning',
      'generation_finished',
      { pendingCallId: undefined },
      { tool: request.name },
    )
  }

  const enqueueTurn: AgentController['enqueueTurn'] = async (sessionId, turn) => {
    const queued = await sessions.enqueueTurn(sessionId, turn)
    if (!queued.ok) return queued
    const job = await jobs.create({
      sessionId,
      projectId,
      turnId: turn.id,
    })
    if (job.created) {
      await jobs.appendEvent(job.job.id, 'message_queued', {
        turnId: turn.id,
        textLength: turn.text.length,
      })
    }
    return queued
  }

  const removeQueuedTurn: AgentController['removeQueuedTurn'] = async (
    sessionId,
    turnId,
  ) => {
    const queuedJob = await jobs.forTurn(sessionId, turnId)
    if (queuedJob?.status === 'queued') {
      await jobs.transition(
        queuedJob.id,
        'canceled',
        'canceled',
        {},
        { reason: 'queued_turn_removed' },
      )
    }
    return sessions.removeQueuedTurn(sessionId, turnId)
  }

  const editQueuedTurn: AgentController['editQueuedTurn'] = (
    sessionId,
    turnId,
    text,
  ) => sessions.updateQueuedTurnText(sessionId, turnId, text)

  const refresh = async (): Promise<AgentSession[]> => {
    const rows = await sessions.list(projectId)
    for (let row of rows) {
      const liveHere = hooks.isSessionActivityActive(row.id)
      if (!liveHere && row.pendingConfirmation && row.pendingSteers.length > 0) {
        const repaired = await sessions.repairConfirmationSteerCollision(row.id)
        if (repaired) {
          row = repaired
          const staleJob = await jobs.active(row.id).catch(() => null)
          if (staleJob) {
            await jobs
              .transition(
                staleJob.id,
                'canceled',
                'canceled',
                {},
                { reason: 'recovered_confirmation_steer_collision' },
              )
              .catch(() => null)
          }
          hooks.onIdle(row.id)
          hooks.notify(
            '已恢复一条卡在确认步骤的引导，并转成排队消息；可点“继续”重发',
            'info',
          )
        } else {
          row = (await sessions.get(row.id)) ?? row
        }
      }
      if (row.activeTurnId && !liveHere) {
        await sessions.releaseActiveTurn(row.id)
      }
      const recovered = (!liveHere ? await jobs.recoverSession(row.id) : []) ?? []
      const attention = recovered.find(
        (job) => job.status === 'needs_attention',
      )
      if (row.pendingConfirmation) {
        hooks.onPendingConfirmation(row.id, row.pendingConfirmation)
      } else if (row.continuation) {
        hooks.onContinuation(row.id, row.continuation.maxSteps)
      } else if (attention) {
        hooks.onNeedsAttention(
          row.id,
          attention.lastError ||
            '上次任务已经提交或开始执行，但应用没有收到结果。为避免重复扣费，本次没有自动重发。',
        )
      }
    }
    return sessions.list(projectId)
  }

  return {
    sessions,
    jobs,
    jobId,
    ensureJob,
    transition,
    beginConfirmation,
    finishConfirmedTool,
    enqueueTurn,
    removeQueuedTurn,
    editQueuedTurn,
    refresh,
  }
}
