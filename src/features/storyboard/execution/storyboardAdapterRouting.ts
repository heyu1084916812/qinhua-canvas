import type { Channel } from '../../../domain/project/channel'
import type { StoryboardRunPlan } from '../../../domain/storyboard/runTypes'
import type { ChannelAdapter } from '../../../platform/channels/types'
import type { RunRouteCandidate } from '../../../domain/shared/execution/types'

export function storyboardAdapterKey(args: {
  channelId: string
  credentialGroupId?: string
  kind: 'image' | 'video' | 'text' | 'speech'
}): string {
  return `${args.channelId}\u0000${args.credentialGroupId ?? ''}\u0000${args.kind}`
}

export async function prepareStoryboardAdapters(args: {
  plan: StoryboardRunPlan
  channels: readonly Channel[]
  resolve: (input: {
    taskId: string
    channel: Channel
    credentialGroupId?: string
  }) => Promise<ChannelAdapter>
}): Promise<{
  adapters: Map<string, ChannelAdapter>
  groupsByTask: Map<string, string[]>
  routesByTask: Map<string, RunRouteCandidate[]>
}> {
  const channels = new Map(args.channels.map((channel) => [channel.id, channel]))
  const adapters = new Map<string, ChannelAdapter>()
  const groupsByTask = new Map<string, string[]>()
  const routesByTask = new Map<string, RunRouteCandidate[]>()

  for (const task of args.plan.tasks) {
    const candidates: RunRouteCandidate[] =
      task.request.routeCandidates?.length
        ? task.request.routeCandidates.map((candidate) => ({ ...candidate }))
        : (task.request.credentialGroupIds?.length
            ? task.request.credentialGroupIds
            : [task.request.credentialGroupId]
          ).map((credentialGroupId) => ({
            channelId: task.request.channelId,
            ...(credentialGroupId ? { credentialGroupId } : {}),
            model: task.request.model,
          }))
    const usable: string[] = []
    const usableRoutes: RunRouteCandidate[] = []
    let firstError: unknown

    for (const candidate of candidates) {
      const channel = channels.get(candidate.channelId)
      if (!channel || !channel.enabled) {
        firstError ??= new Error(
          `漫剧执行渠道不存在或未启用：${candidate.channelId}`,
        )
        continue
      }
      const credentialGroupId = candidate.credentialGroupId
      const key = storyboardAdapterKey({
        channelId: candidate.channelId,
        credentialGroupId,
        kind: task.request.kind,
      })
      try {
        if (!adapters.has(key)) {
          adapters.set(
            key,
            await args.resolve({
              taskId: task.id,
              channel,
              credentialGroupId,
            }),
          )
        }
        usableRoutes.push(candidate)
        if (credentialGroupId) usable.push(credentialGroupId)
      } catch (error) {
        firstError ??= error
      }
    }

    if (usableRoutes.length === 0) {
      throw firstError ?? new Error('漫剧渠道没有可用的 Key 分组')
    }
    groupsByTask.set(task.id, usable)
    routesByTask.set(task.id, usableRoutes)
    task.request.routeCandidates = usableRoutes
    const firstRoute = usableRoutes[0]!
    task.request.channelId = firstRoute.channelId
    task.request.model = firstRoute.model
    if (firstRoute.credentialGroupId) {
      task.request.credentialGroupId = firstRoute.credentialGroupId
    } else {
      delete task.request.credentialGroupId
    }
    if (usable.length > 0) {
      task.request.credentialGroupIds = usable
      if (!task.request.credentialGroupId || !usable.includes(task.request.credentialGroupId)) {
        task.request.credentialGroupId = usable[0]
      }
    }
  }

  return { adapters, groupsByTask, routesByTask }
}
