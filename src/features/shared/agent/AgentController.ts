import type { AgentSession, AgentSessionStore } from '../../../state/agent/sessionStore'
import type { AgentJobStore } from '../../../state/agent/jobStore'
import type { AgentToolRequest } from '../../../domain/agent/toolRequest'

export interface AgentControllerHooks {
  isSessionActivityActive: (sessionId: string) => boolean
  onPendingConfirmation: (sessionId: string, request: AgentToolRequest) => void
  onContinuation: (sessionId: string, maxSteps: number) => void
  onIdle: (sessionId: string) => void
  notify: (message: string, tone: 'info' | 'error') => void
}

export interface AgentController {
  sessions: AgentSessionStore
  jobs: AgentJobStore
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
      if (!liveHere) await jobs.recoverSession(row.id)
      if (row.pendingConfirmation) {
        hooks.onPendingConfirmation(row.id, row.pendingConfirmation)
      } else if (row.continuation) {
        hooks.onContinuation(row.id, row.continuation.maxSteps)
      }
    }
    return sessions.list(projectId)
  }

  return { sessions, jobs, refresh }
}
