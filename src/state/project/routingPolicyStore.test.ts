import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import {
  createRoutingPolicyStore,
  ROUTING_CURSOR_ROW_ID,
  ROUTING_POLICY_ROW_ID,
} from './routingPolicyStore'

const store = () => {
  const storage = createMemoryPlatform().storage
  return { storage, policies: createRoutingPolicyStore(storage) }
}

describe('RoutingPolicyStore', () => {
  it('缺省策略与现有 priority 行为一致', async () => {
    const { policies } = store()
    expect(await policies.load()).toEqual({
      strategy: 'priority',
      maxAttempts: 3,
      allowedCandidates: [],
    })
  })

  it('保存勾选候选、去重并按渠道/分组读回', async () => {
    const { storage, policies } = store()
    await policies.save({
      strategy: 'round_robin',
      maxAttempts: 2,
      allowedCandidates: [
        { channelId: 'relay', credentialGroupId: 'a' },
        { channelId: 'relay', credentialGroupId: 'a' },
        { channelId: 'backup' },
      ],
    })
    expect(await policies.load()).toEqual({
      strategy: 'round_robin',
      maxAttempts: 2,
      allowedCandidates: [
        { channelId: 'relay', credentialGroupId: 'a' },
        { channelId: 'backup' },
      ],
    })
    const row = (await storage.query('presets', { id: ROUTING_POLICY_ROW_ID }))[0]
    expect(row?.strategy).toBe('round_robin')
  })

  it('游标按模型和能力隔离，连续领取会循环', async () => {
    const { storage, policies } = store()
    expect(await policies.nextCursor('gpt-5', 'chat', 2)).toBe(0)
    expect(await policies.nextCursor('gpt-5', 'chat', 2)).toBe(1)
    expect(await policies.nextCursor('gpt-5', 'chat', 2)).toBe(0)
    expect(await policies.nextCursor('gpt-5', 'image', 2)).toBe(0)
    expect(await policies.nextCursor('gpt-5', 'chat', 1)).toBe(0)
    const row = (await storage.query('presets', { id: ROUTING_CURSOR_ROW_ID }))[0]
    expect(row?.cursors).toMatchObject({
      ['gpt-5\u0000chat']: 0,
      ['gpt-5\u0000image']: 1,
    })
  })

  it('损坏数据回落默认值，保存失败显式报错', async () => {
    const { storage, policies } = store()
    await storage.put('presets', {
      id: ROUTING_POLICY_ROW_ID,
      strategy: 'unknown',
      maxAttempts: -9,
      allowedCandidates: [{ nope: true }],
    } as never)
    expect(await policies.load()).toEqual({
      strategy: 'priority',
      maxAttempts: 1,
      allowedCandidates: [],
    })

    const broken = {
      ...storage,
      async put() {
        throw new Error('disk full')
      },
    }
    await expect(createRoutingPolicyStore(broken).save({
      strategy: 'priority',
      maxAttempts: 3,
      allowedCandidates: [],
    })).rejects.toThrow('disk full')
  })
})
