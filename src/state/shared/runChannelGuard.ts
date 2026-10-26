export interface GuardedChannelRun {
  /** Each task in this plan and the channel it actually uses. */
  taskChannels: ReadonlyMap<string, string>
  /** Abort the plan. Must remain callable after navigating away from its Provider. */
  cancel: () => void
  /** Let the owner write a visible interrupted state for affected tasks. */
  onInterrupted: (
    affected: readonly { taskId: string; channelId: string }[],
  ) => void
}

/** A direct call was aborted because its channel was removed. */
export class ChannelRemovalInterruptedError extends Error {
  constructor() {
    super('channel removed during active call')
    this.name = 'ChannelRemovalInterruptedError'
  }
}

const guardedRuns = new Map<string, GuardedChannelRun>()

export function registerGuardedChannelRun(planId: string, run: GuardedChannelRun): void {
  guardedRuns.set(planId, run)
}

export function unregisterGuardedChannelRun(planId: string): void {
  guardedRuns.delete(planId)
}

/**
 * Channel deletion is an app-level event. It must not depend on a mounted
 * workbench Provider, because users delete channels from Settings.
 */
export function interruptGuardedRunsForRemovedChannels(
  removedChannelIds: ReadonlySet<string>,
): number {
  if (removedChannelIds.size === 0) return 0
  let interrupted = 0
  for (const run of guardedRuns.values()) {
    const affected = [...run.taskChannels]
      .filter(([, channelId]) => removedChannelIds.has(channelId))
      .map(([taskId, channelId]) => ({ taskId, channelId }))
    if (affected.length === 0) continue
    interrupted += 1
    run.cancel()
    run.onInterrupted(affected)
  }
  return interrupted
}

/** Test-only: isolate the module-level registry between test cases. */
export function clearGuardedChannelRuns(): void {
  guardedRuns.clear()
}
