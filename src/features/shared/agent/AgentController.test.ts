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
})
