import { describe, expect, it } from 'vitest'
import type { RunRequest } from '../../../domain/shared/execution/types'
import type { ChannelAdapter } from '../../../platform/channels/types'
import {
  ecommerceAdapterKey,
  resolveEcommerceAdapter,
} from './ecommerceAdapterRouting'

const request: RunRequest = {
  kind: 'image',
  channelId: 'channel-a',
  model: 'model-a',
  prompt: 'prompt',
  inputs: [],
  params: {},
  credentialGroupIds: ['group-a', 'group-b'],
  routingAttempt: 0,
}

describe('resolveEcommerceAdapter', () => {
  it('uses different group adapters for routing attempts 0 and 1', () => {
    const groupAAdapter = { id: 'adapter-group-a' } as unknown as ChannelAdapter
    const groupBAdapter = { id: 'adapter-group-b' } as unknown as ChannelAdapter
    const adapters = new Map([
      [
        ecommerceAdapterKey('channel-a', 'group-a', 'image'),
        groupAAdapter,
      ],
      [
        ecommerceAdapterKey('channel-a', 'group-b', 'image'),
        groupBAdapter,
      ],
    ])

    expect(resolveEcommerceAdapter(adapters, 'plan-a', request)).toBe(groupAAdapter)
    expect(
      resolveEcommerceAdapter(adapters, 'plan-a', {
        ...request,
        routingAttempt: 1,
      }),
    ).toBe(groupBAdapter)
  })

  it('★ RoutePlan 跨渠道时按 attempt 切到候选自己的适配器', () => {
    const first = { id: 'adapter-first' } as unknown as ChannelAdapter
    const second = { id: 'adapter-second' } as unknown as ChannelAdapter
    const adapters = new Map([
      [ecommerceAdapterKey('channel-a', 'group-a', 'image'), first],
      [ecommerceAdapterKey('channel-b', 'group-b', 'image'), second],
    ])
    const routed: RunRequest = {
      ...request,
      routeCandidates: [
        { channelId: 'channel-a', credentialGroupId: 'group-a', model: 'model-a' },
        { channelId: 'channel-b', credentialGroupId: 'group-b', model: 'model-b' },
      ],
    }

    expect(resolveEcommerceAdapter(adapters, 'plan-a', routed)).toBe(first)
    expect(
      resolveEcommerceAdapter(adapters, 'plan-a', {
        ...routed,
        routingAttempt: 1,
      }),
    ).toBe(second)
  })
})
