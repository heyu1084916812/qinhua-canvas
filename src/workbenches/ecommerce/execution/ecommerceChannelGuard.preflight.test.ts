import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { EcommerceRunTask } from '../../../features/ecommerce/execution/ecommerceRunPlan'
import {
  clearGuardedChannelRuns,
  interruptGuardedRunsForRemovedChannels,
} from '../../../features/shared/execution/runChannelGuard'
import { registerEcommerceChannelGuard } from './ecommerceChannelGuard'
import {
  createEcommercePreflightBoundary,
  ECOMMERCE_CHANNEL_REMOVED_MESSAGE,
} from './ecommercePreflightBoundary'

const plan: RunPlan<EcommerceRunTask> = {
  id: 'ecommerce:preflight-task:run',
  scope: 'global',
  mode: 'single',
  tasks: [
    {
      id: 'preflight-task-1',
      nodeId: 'result-1',
      resultId: 'result-1',
      taskId: 'preflight-task',
      planId: 'ecommerce:preflight-task:run',
      dependsOn: [],
      fingerprint: 'fp-preflight',
      params: {},
      request: {
        kind: 'image',
        channelId: 'channel-a',
        model: 'model-a',
        prompt: 'prompt',
        inputs: [],
        params: {},
      },
    },
  ],
}

afterEach(() => clearGuardedChannelRuns())

describe('ecommerce channel guard during preflight', () => {
  it('blocks startRun when the channel disappears while resolve is pending', async () => {
    const cancelRun = vi.fn()
    const startRun = vi.fn()
    const boundary = createEcommercePreflightBoundary()
    const unregister = registerEcommerceChannelGuard(
      plan,
      { cancelRun },
      boundary.interrupt,
    )
    let resolvePreflight!: (value: string) => void
    const pendingResolve = new Promise<string>((resolve) => {
      resolvePreflight = resolve
    })

    const run = (async () => {
      await boundary.run(() => pendingResolve)
      startRun()
    })()

    expect(interruptGuardedRunsForRemovedChannels(new Set(['channel-a']))).toBe(1)
    resolvePreflight('resolved-after-channel-removal')

    await expect(run).rejects.toThrow(ECOMMERCE_CHANNEL_REMOVED_MESSAGE)
    expect(cancelRun).toHaveBeenCalledWith(plan.id)
    expect(startRun).not.toHaveBeenCalled()
    unregister()
  })
})
