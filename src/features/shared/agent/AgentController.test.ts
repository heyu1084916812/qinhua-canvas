import { describe, expect, it, vi } from 'vitest'
import { createAgentController } from './AgentController'
import type { AgentSession } from '../../../state/agent/sessionStore'

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    projectId: 'p1',
    title: 'test',
    channelId: '',
    model: 'm',
    queuedTurns: [],
    pendingSteers: [],
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('AgentController', () => {
  it('releases an interrupted active turn and recovers its job', async () => {
    const rows = [session({ activeTurnId: 'turn-1' })]
    const sessions = {
      list: vi.fn(async () => rows),
      get: vi.fn(),
      repairConfirmationSteerCollision: vi.fn(),
      releaseActiveTurn: vi.fn(async () => null),
    }
    const jobs = {
      active: vi.fn(),
      transition: vi.fn(),
      recoverSession: vi.fn(async () => {}),
    }
    const controller = createAgentController({
      projectId: 'p1',
      sessions: sessions as never,
      jobs: jobs as never,
      hooks: {
        isSessionActivityActive: () => false,
        onPendingConfirmation: vi.fn(),
        onContinuation: vi.fn(),
        onNeedsAttention: vi.fn(),
        onIdle: vi.fn(),
        notify: vi.fn(),
      },
    })

    await controller.refresh()
    expect(sessions.releaseActiveTurn).toHaveBeenCalledWith('s1')
    expect(jobs.recoverSession).toHaveBeenCalledWith('s1')
  })

  it('repairs confirmation/steer collisions and cancels the stale job', async () => {
    const repaired = session({ pendingConfirmation: { callId: 'c1', name: 'runNode', args: {} } })
    const sessions = {
      list: vi.fn(async () => [session({ pendingConfirmation: repaired.pendingConfirmation, pendingSteers: [{ id: 'st1', text: 'x', createdAt: 1 }] })]),
      get: vi.fn(),
      repairConfirmationSteerCollision: vi.fn(async () => repaired),
      releaseActiveTurn: vi.fn(),
    }
    const jobs = {
      active: vi.fn(async () => ({ id: 'job-1' })),
      transition: vi.fn(async () => null),
      recoverSession: vi.fn(async () => {}),
    }
    const hooks = {
      isSessionActivityActive: () => false,
      onPendingConfirmation: vi.fn(),
      onContinuation: vi.fn(),
      onNeedsAttention: vi.fn(),
      onIdle: vi.fn(),
      notify: vi.fn(),
    }
    const controller = createAgentController({
      projectId: 'p1',
      sessions: sessions as never,
      jobs: jobs as never,
      hooks,
    })

    await controller.refresh()
    expect(sessions.repairConfirmationSteerCollision).toHaveBeenCalledWith('s1')
    expect(jobs.transition).toHaveBeenCalledWith(
      'job-1',
      'canceled',
      'canceled',
      {},
      { reason: 'recovered_confirmation_steer_collision' },
    )
    expect(hooks.onIdle).toHaveBeenCalledWith('s1')
    expect(hooks.notify).toHaveBeenCalled()
    expect(hooks.onPendingConfirmation).toHaveBeenCalledWith('s1', repaired.pendingConfirmation)
  })

  it('restores persisted paused and awaiting-confirmation UI states', async () => {
    const rows = [
      session({
        id: 'paused',
        continuation: { reason: 'max_steps', maxSteps: 8, createdAt: 2 },
      }),
      session({
        id: 'confirm',
        pendingConfirmation: { callId: 'c1', name: 'runNode', args: {} },
      }),
    ]
    const hooks = {
      isSessionActivityActive: () => false,
      onPendingConfirmation: vi.fn(),
      onContinuation: vi.fn(),
      onNeedsAttention: vi.fn(),
      onIdle: vi.fn(),
      notify: vi.fn(),
    }
    const controller = createAgentController({
      projectId: 'p1',
      sessions: {
        list: vi.fn(async () => rows),
        get: vi.fn(),
        repairConfirmationSteerCollision: vi.fn(),
        releaseActiveTurn: vi.fn(),
      } as never,
      jobs: {
        active: vi.fn(),
        transition: vi.fn(),
        recoverSession: vi.fn(async () => {}),
      } as never,
      hooks,
    })

    await controller.refresh()
    expect(hooks.onContinuation).toHaveBeenCalledWith('paused', 8)
    expect(hooks.onPendingConfirmation).toHaveBeenCalledWith(
      'confirm',
      rows[1]!.pendingConfirmation,
    )
  })

  it('surfaces a recovered need-attention job instead of pretending it is idle', async () => {
    const hooks = {
      isSessionActivityActive: () => false,
      onPendingConfirmation: vi.fn(),
      onContinuation: vi.fn(),
      onNeedsAttention: vi.fn(),
      onIdle: vi.fn(),
      notify: vi.fn(),
    }
    const controller = createAgentController({
      projectId: 'p1',
      sessions: {
        list: vi.fn(async () => [session({ id: 'attention' })]),
        get: vi.fn(),
        repairConfirmationSteerCollision: vi.fn(),
        releaseActiveTurn: vi.fn(),
      } as never,
      jobs: {
        active: vi.fn(),
        transition: vi.fn(),
        recoverSession: vi.fn(async () => [
          {
            id: 'job-1',
            sessionId: 'attention',
            projectId: 'p1',
            turnId: 'turn-1',
            status: 'needs_attention',
            revision: 1,
            createdAt: 1,
            updatedAt: 2,
            lastError: '结果未知，未自动重发',
          },
        ]),
      } as never,
      hooks,
    })

    await controller.refresh()
    expect(hooks.onNeedsAttention).toHaveBeenCalledWith(
      'attention',
      '结果未知，未自动重发',
    )
  })

  it('owns session-to-job mapping and lifecycle transitions', async () => {
    const job = {
      id: 'job-1',
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-1',
      status: 'queued' as const,
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const jobs = {
      get: vi.fn(async () => job),
      forTurn: vi.fn(async () => null),
      active: vi.fn(async () => null),
      create: vi.fn(async () => ({
        job,
        event: { id: 'e1' },
        created: true,
      })),
      transition: vi.fn(async () => ({
        job: { ...job, status: 'planning' as const },
        event: { id: 'e2' },
      })),
      recoverSession: vi.fn(async () => []),
    }
    const controller = createAgentController({
      projectId: 'p1',
      sessions: {
        list: vi.fn(async () => []),
        get: vi.fn(),
        repairConfirmationSteerCollision: vi.fn(),
        releaseActiveTurn: vi.fn(),
      } as never,
      jobs: jobs as never,
      hooks: {
        isSessionActivityActive: () => false,
        onPendingConfirmation: vi.fn(),
        onContinuation: vi.fn(),
        onNeedsAttention: vi.fn(),
        onIdle: vi.fn(),
        notify: vi.fn(),
      },
    })

    await expect(controller.ensureJob(session(), 'turn-1')).resolves.toBe(job)
    expect(controller.jobId('s1')).toBe('job-1')
    await expect(
      controller.transition('s1', 'planning'),
    ).resolves.toMatchObject({ job: { status: 'planning' } })
    expect(jobs.transition).toHaveBeenCalledWith(
      'job-1',
      'planning',
      'status_changed',
      {},
      {},
    )
  })
})
