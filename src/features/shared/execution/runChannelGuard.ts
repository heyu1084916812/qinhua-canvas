export interface GuardedChannelRun {
  /** 本执行计划里每个 task 实际使用的渠道。 */
  taskChannels: ReadonlyMap<string, string>
  /** 中止本计划的 AbortController；运行跨路由后仍必须可用。 */
  cancel: () => void
  /** 让宿主写失败态并提示用户。 */
  onInterrupted: (
    affected: readonly { taskId: string; channelId: string }[],
  ) => void
}

const guardedRuns = new Map<string, GuardedChannelRun>()

export function registerGuardedChannelRun(planId: string, run: GuardedChannelRun): void {
  guardedRuns.set(planId, run)
}

export function unregisterGuardedChannelRun(planId: string): void {
  guardedRuns.delete(planId)
}

/**
 * 渠道删除是应用级事件，不能只靠画布页里的 React effect 监听：
 * 用户必须离开画布去设置页才能删渠道，此时原 Provider 可能已经卸载。
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

/** 仅测试使用：避免模块级登记表在单测之间串味。 */
export function clearGuardedChannelRuns(): void {
  guardedRuns.clear()
}
