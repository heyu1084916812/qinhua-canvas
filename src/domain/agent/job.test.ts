import { describe, expect, it } from 'vitest'
import {
  assertAgentJobTransition,
  canTransitionAgentJob,
  transitionAgentJob,
  type AgentJob,
} from './job'

function job(over: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    turnId: 'turn-1',
    status: 'queued',
    revision: 0,
    createdAt: 10,
    updatedAt: 10,
    ...over,
  }
}

describe('AgentJob 状态机', () => {
  it('队列任务只能先进入规划或取消', () => {
    expect(canTransitionAgentJob('queued', 'planning')).toBe(true)
    expect(canTransitionAgentJob('queued', 'canceled')).toBe(true)
    expect(canTransitionAgentJob('queued', 'completed')).toBe(false)
    expect(() => assertAgentJobTransition('completed', 'planning')).toThrow(
      'completed',
    )
  })

  it('首次进入规划时记录 startedAt，终态记录 finishedAt', () => {
    const planning = transitionAgentJob(job(), 'planning', 20, {
      operationId: 'op-1',
    })
    expect(planning).toMatchObject({
      status: 'planning',
      revision: 1,
      startedAt: 20,
      operationId: 'op-1',
    })
    const paused = transitionAgentJob(planning, 'paused', 30, {
      checkpoint: {
        kind: 'max_steps',
        maxSteps: 8,
        completedSteps: 8,
        savedAt: 30,
      },
    })
    const resumed = transitionAgentJob(paused, 'planning', 40)
    const completed = transitionAgentJob(resumed, 'completed', 50)
    expect(completed).toMatchObject({
      status: 'completed',
      startedAt: 20,
      finishedAt: 50,
      revision: 4,
    })
  })

  it('同状态同补丁是幂等，不制造虚假 revision', () => {
    const current = job({ status: 'planning', startedAt: 20, revision: 3 })
    expect(transitionAgentJob(current, 'planning', 30)).toBe(current)
  })
})
