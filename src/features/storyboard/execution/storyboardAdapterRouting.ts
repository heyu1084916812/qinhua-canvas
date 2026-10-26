import type { Channel } from '../../../domain/project/channel'
import type { StoryboardRunPlan } from '../../../domain/storyboard/runTypes'
import type { ChannelAdapter } from '../../../platform/channels/types'

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
}> {
  const channels = new Map(args.channels.map((channel) => [channel.id, channel]))
  const adapters = new Map<string, ChannelAdapter>()
  const groupsByTask = new Map<string, string[]>()

  for (const task of args.plan.tasks) {
    const channel = channels.get(task.request.channelId)
    if (!channel || !channel.enabled) {
      throw new Error(`漫剧执行渠道不存在或未启用：${task.request.channelId}`)
    }
    const candidates = task.request.credentialGroupIds?.length
      ? [...task.request.credentialGroupIds]
      : task.request.credentialGroupId
        ? [task.request.credentialGroupId]
        : [undefined]
    const usable: string[] = []
    let firstError: unknown

    for (const credentialGroupId of candidates) {
      const key = storyboardAdapterKey({
        channelId: task.request.channelId,
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
        if (credentialGroupId) usable.push(credentialGroupId)
      } catch (error) {
        firstError ??= error
      }
    }

    if (!usable.length && !adapters.has(
      storyboardAdapterKey({
        channelId: task.request.channelId,
        credentialGroupId: task.request.credentialGroupId,
        kind: task.request.kind,
      }),
    )) {
      throw firstError ?? new Error('漫剧渠道没有可用的 Key 分组')
    }
    groupsByTask.set(task.id, usable)
    if (usable.length > 0) {
      task.request.credentialGroupIds = usable
      if (!task.request.credentialGroupId || !usable.includes(task.request.credentialGroupId)) {
        task.request.credentialGroupId = usable[0]
      }
    }
  }

  return { adapters, groupsByTask }
}
