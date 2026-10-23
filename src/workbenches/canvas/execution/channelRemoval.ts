/**
 * 找出一个运行计划里真正使用被删渠道的任务。
 *
 * 只按执行时记录的 channelId 命中，不按模型名或全局优先级猜：
 * 同一个模型可能同时在多条渠道上，删除 A 不能误停正在跑 B 的任务。
 */
export function tasksAffectedByChannelRemoval(
  taskChannels: ReadonlyMap<string, string>,
  removedChannelIds: ReadonlySet<string>,
): { taskId: string; channelId: string }[] {
  const affected: { taskId: string; channelId: string }[] = []
  for (const [taskId, channelId] of taskChannels) {
    if (removedChannelIds.has(channelId)) affected.push({ taskId, channelId })
  }
  return affected
}
