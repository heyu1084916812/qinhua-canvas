import type { AgentToolEffect } from '../../../domain/agent/job'
import { agentToolIdempotencyKey } from '../../../domain/agent/toolRegistry'
import { fingerprintHex } from '../../../domain/shared/hash'
import type { AgentJobStore } from '../../../state/agent/jobStore'
import { errorTextOf } from '../../../shared/result'

export type AgentToolEffectRun =
  | { kind: 'completed'; result: unknown; replayed: boolean; effect: AgentToolEffect }
  | { kind: 'failed'; error: string; replayed: boolean; effect: AgentToolEffect }
  | { kind: 'pending'; reason: string; effect: AgentToolEffect }
  | { kind: 'conflict'; reason: string; effect: AgentToolEffect }

export class AgentToolEffectBlockedError extends Error {
  constructor(
    message: string,
    readonly status: 'needs_attention' | 'failed',
    readonly outcome: Exclude<AgentToolEffectRun, { kind: 'completed' }>,
  ) {
    super(message)
    this.name = 'AgentToolEffectBlockedError'
  }
}

export interface AgentToolEffectLedger {
  run(input: {
    jobId: string
    stepId: string
    toolCallId: string
    toolName: string
    args: unknown
    execute: () => Promise<unknown>
  }): Promise<AgentToolEffectRun>
}

/**
 * 持久工具效果账本。
 *
 * “已开始未完成”不能重试：付费请求、写画布或外部副作用可能已经发生，正确出口是
 * needs_attention / 用户确认，而不是再次执行。
 */
export function createAgentToolEffectLedger(
  jobs: Pick<
    AgentJobStore,
    'claimToolEffect' | 'completeToolEffect' | 'failToolEffect'
  >,
): AgentToolEffectLedger {
  return {
    async run(input) {
      const effectKey = agentToolIdempotencyKey({
        jobId: input.jobId,
        stepId: input.stepId,
        toolCallId: input.toolCallId,
      })
      const claim = await jobs.claimToolEffect({
        jobId: input.jobId,
        effectKey,
        stepId: input.stepId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        argsDigest: fingerprintHex(JSON.stringify(input.args ?? null)),
      })
      if (claim.kind === 'completed') {
        return {
          kind: 'completed',
          result: claim.effect.result,
          replayed: true,
          effect: claim.effect,
        }
      }
      if (claim.kind === 'failed') {
        return {
          kind: 'failed',
          error: claim.effect.error ?? '工具执行失败',
          replayed: true,
          effect: claim.effect,
        }
      }
      if (claim.kind === 'pending') {
        return {
          kind: 'pending',
          reason:
            claim.reason ??
            ('上一次同名工具已经开始执行，但应用没有收到完成结果。' +
              '为避免重复写画布或重复扣费，本次不会自动重发。'),
          effect: claim.effect,
        }
      }
      if (claim.kind === 'conflict') {
        return {
          kind: 'conflict',
          reason: claim.reason ?? '工具效果键冲突',
          effect: claim.effect,
        }
      }

      try {
        const result = await input.execute()
        const completed = await jobs.completeToolEffect({
          jobId: input.jobId,
          effectKey,
          result,
        })
        if (!completed) {
          throw new Error('工具已执行，但完成结果未能写入持久账本')
        }
        return {
          kind: 'completed',
          result,
          replayed: false,
          effect: completed,
        }
      } catch (error) {
        const message = errorTextOf(error)
        const failed = await jobs.failToolEffect({
          jobId: input.jobId,
          effectKey,
          error: message,
        })
        return {
          kind: 'failed',
          error: message,
          replayed: false,
          effect: failed ?? claim.effect,
        }
      }
    },
  }
}
