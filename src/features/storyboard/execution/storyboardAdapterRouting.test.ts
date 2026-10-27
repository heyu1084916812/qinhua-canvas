import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../../domain/project/channel'
import type {
  StoryboardRunPlan,
  StoryboardRunTask,
} from '../../../domain/storyboard/runTypes'
import type { ChannelAdapter } from '../../../platform/channels/types'
import {
  prepareStoryboardAdapters,
  storyboardAdapterKey,
} from './storyboardAdapterRouting'

const channel = {
  id: 'channel-1',
  name: '渠道',
  enabled: true,
} as Channel

function task(
  action: 'shot-image' | 'shot-video',
  credentialGroupIds?: string[],
): StoryboardRunTask {
  const kind = action === 'shot-image' ? 'image' : 'video'
  const subject = {
    kind: action,
    id: 'shot:shot-1',
    scopeId: 'episode:episode-1',
    episodeId: 'episode-1',
    shotId: 'shot-1',
  } as const
  return {
    id: `plan-1:${action}:${subject.id}`,
    nodeId: subject.id,
    planId: 'plan-1',
    workbench: 'storyboard',
    operationId: 'op-1',
    action,
    subject,
    request: {
      kind,
      channelId: 'channel-1',
      model: 'model-1',
      prompt: 'prompt',
      inputs: [],
      params: {},
      ...(credentialGroupIds ? { credentialGroupIds } : {}),
    },
    dependsOn: [],
    fingerprint: `fp-${action}`,
    params: {
      action,
      episodeId: 'episode-1',
      shotId: 'shot-1',
    },
  }
}

function plan(tasks: StoryboardRunTask[]): StoryboardRunPlan {
  return {
    id: 'plan-1',
    workbench: 'storyboard',
    tasks,
    scope: 'node',
    mode: 'single',
  }
}

describe('prepareStoryboardAdapters', () => {
  it('同一计划的不同动作各自持有适配器，不互相覆盖', async () => {
    const image = task('shot-image')
    const video = task('shot-video')
    const resolve = vi.fn(async ({ credentialGroupId }) => ({
      protocol: credentialGroupId ?? 'default',
    })) as unknown as (input: {
      taskId: string
      channel: Channel
      credentialGroupId?: string
    }) => Promise<ChannelAdapter>

    const result = await prepareStoryboardAdapters({
      plan: plan([image, video]),
      channels: [channel],
      resolve,
    })

    expect(result.adapters.size).toBe(2)
    expect(
      result.adapters.get(
        storyboardAdapterKey({
          channelId: 'channel-1',
          kind: 'image',
        }),
      ),
    ).toMatchObject({ protocol: 'default' })
    expect(
      result.adapters.get(
        storyboardAdapterKey({
          channelId: 'channel-1',
          kind: 'video',
        }),
      ),
    ).toMatchObject({ protocol: 'default' })
  })

  it('组级预检只保留实际可用的 Key 分组', async () => {
    const image = task('shot-image', ['bad-group', 'good-group'])
    const resolve = vi.fn(async ({ credentialGroupId }) => {
      if (credentialGroupId === 'bad-group') throw new Error('missing key')
      return { protocol: 'good' } as ChannelAdapter
    })

    const result = await prepareStoryboardAdapters({
      plan: plan([image]),
      channels: [channel],
      resolve,
    })

    expect(result.groupsByTask.get(image.id)).toEqual(['good-group'])
    expect(image.request.credentialGroupIds).toEqual(['good-group'])
    expect(image.request.credentialGroupId).toBe('good-group')
  })

  it('★ RoutePlan 跨渠道预检会为所有候选准备适配器，并保留可执行顺序', async () => {
    const image = task('shot-image')
    image.request.logicalModel = 'front-image'
    image.request.routeCandidates = [
      { channelId: 'channel-1', credentialGroupId: 'a', model: 'upstream-a' },
      { channelId: 'channel-2', credentialGroupId: 'b', model: 'upstream-b' },
    ]
    const resolve = vi.fn(async ({ channel }) => ({
      protocol: channel.id,
    })) as unknown as (input: {
      taskId: string
      channel: Channel
      credentialGroupId?: string
    }) => Promise<ChannelAdapter>

    const result = await prepareStoryboardAdapters({
      plan: plan([image]),
      channels: [channel, { ...channel, id: 'channel-2', name: '渠道 2' }],
      resolve,
    })

    expect(resolve).toHaveBeenCalledTimes(2)
    expect(image.request.routeCandidates).toEqual([
      { channelId: 'channel-1', credentialGroupId: 'a', model: 'upstream-a' },
      { channelId: 'channel-2', credentialGroupId: 'b', model: 'upstream-b' },
    ])
    expect(image.request.channelId).toBe('channel-1')
    expect(image.request.model).toBe('upstream-a')
    expect(result.routesByTask.get(image.id)).toHaveLength(2)
  })

  it('渠道停用或全部 Key 分组不可用时在发请求前失败', async () => {
    await expect(
      prepareStoryboardAdapters({
        plan: plan([task('shot-image')]),
        channels: [{ ...channel, enabled: false }],
        resolve: async () => ({ protocol: 'x' }) as ChannelAdapter,
      }),
    ).rejects.toThrow('不存在或未启用')

    await expect(
      prepareStoryboardAdapters({
        plan: plan([task('shot-image', ['bad'])]),
        channels: [channel],
        resolve: async () => {
          throw new Error('missing key')
        },
      }),
    ).rejects.toThrow('missing key')
  })
})
