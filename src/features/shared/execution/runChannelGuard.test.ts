import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearGuardedChannelRuns,
  interruptGuardedRunsForRemovedChannels,
  registerGuardedChannelRun,
  unregisterGuardedChannelRun,
} from '../../../state/shared/runChannelGuard'

afterEach(() => clearGuardedChannelRuns())

describe('runChannelGuard', () => {
  it('运行中删除渠道时只中止真正使用该渠道的计划', () => {
    const deletedCancel = vi.fn()
    const deletedInterrupted = vi.fn()
    const otherCancel = vi.fn()
    const otherInterrupted = vi.fn()

    registerGuardedChannelRun('plan-a', {
      taskChannels: new Map([
        ['task-1', 'channel-a'],
        ['task-2', 'channel-b'],
      ]),
      cancel: deletedCancel,
      onInterrupted: deletedInterrupted,
    })
    registerGuardedChannelRun('plan-b', {
      taskChannels: new Map([['task-3', 'channel-c']]),
      cancel: otherCancel,
      onInterrupted: otherInterrupted,
    })

    expect(interruptGuardedRunsForRemovedChannels(new Set(['channel-a']))).toBe(1)
    expect(deletedCancel).toHaveBeenCalledTimes(1)
    expect(deletedInterrupted).toHaveBeenCalledWith([
      { taskId: 'task-1', channelId: 'channel-a' },
    ])
    expect(otherCancel).not.toHaveBeenCalled()
    expect(otherInterrupted).not.toHaveBeenCalled()
  })

  it('计划结束后注销，再删渠道不会误停已完成的任务', () => {
    const cancel = vi.fn()
    const interrupted = vi.fn()
    registerGuardedChannelRun('plan-done', {
      taskChannels: new Map([['task-1', 'channel-a']]),
      cancel,
      onInterrupted: interrupted,
    })
    unregisterGuardedChannelRun('plan-done')

    expect(interruptGuardedRunsForRemovedChannels(new Set(['channel-a']))).toBe(0)
    expect(cancel).not.toHaveBeenCalled()
    expect(interrupted).not.toHaveBeenCalled()
  })
})
