import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { EcommerceRunTask } from '../../../features/ecommerce/execution/ecommerceRunPlan'
import {
  clearGuardedChannelRuns,
  interruptGuardedRunsForRemovedChannels,
} from '../../../features/shared/execution/runChannelGuard'
import { registerEcommerceChannelGuard } from './ecommerceChannelGuard'

const plan: RunPlan<EcommerceRunTask> = {
  id: 'ecommerce:task-1:run',
  scope: 'global',
  mode: 'single',
  tasks: [
    {
      id: 'task-1-1',
      nodeId: 'result-1',
      resultId: 'result-1',
      taskId: 'task-1',
      planId: 'ecommerce:task-1:run',
      dependsOn: [],
      fingerprint: 'fp-1',
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

describe('registerEcommerceChannelGuard', () => {
  it('aborts the affected ecommerce plan when its channel is removed', () => {
    const cancelRun = vi.fn()
    const onInterrupted = vi.fn()
    registerEcommerceChannelGuard(plan, { cancelRun }, onInterrupted)

    expect(interruptGuardedRunsForRemovedChannels(new Set(['channel-a']))).toBe(1)
    expect(cancelRun).toHaveBeenCalledWith(plan.id)
    expect(onInterrupted).toHaveBeenCalledTimes(1)
  })

  it('does not abort a plan for an unrelated channel and unregisters cleanly', () => {
    const cancelRun = vi.fn()
    const onInterrupted = vi.fn()
    const unregister = registerEcommerceChannelGuard(
      plan,
      { cancelRun },
      onInterrupted,
    )

    expect(interruptGuardedRunsForRemovedChannels(new Set(['channel-b']))).toBe(0)
    unregister()
    expect(interruptGuardedRunsForRemovedChannels(new Set(['channel-a']))).toBe(0)
    expect(cancelRun).not.toHaveBeenCalled()
    expect(onInterrupted).not.toHaveBeenCalled()
  })
})
