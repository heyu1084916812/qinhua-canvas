import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createPresetStore } from './presetStore'

/**
 * Agent 默认模型（设计文档 §8）。
 *
 * 它是 **UI 偏好**，所以住 `presets`；会话历史住 `agentSessions`（§12）。
 * 两者混在一张表里会出现「聊得越多，偏好表越大」，这条断言把界限钉住。
 */

const store = () => createPresetStore(createMemoryPlatform().storage)

describe('Agent 默认模型 · UI 偏好', () => {
  it('★ 没设过时返回 null（界面据此回落「第一个可用」）', async () => {
    expect(await store().loadAgentDefault()).toBeNull()
  })

  it('★ 存了能读回；再存覆盖', async () => {
    const s = store()
    await s.saveAgentDefault({ channelId: 'c1', model: 'm1' })
    expect(await s.loadAgentDefault()).toEqual({ channelId: 'c1', model: 'm1' })
    await s.saveAgentDefault({ channelId: 'c2', model: 'm2' })
    expect(await s.loadAgentDefault()).toEqual({ channelId: 'c2', model: 'm2' })
  })

  it('★ 残缺的行当「没设过」处理（不返回半份偏好）', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', { id: 'agent:default', channelId: 'c1' } as never)
    const s = createPresetStore(platform.storage)
    expect(await s.loadAgentDefault()).toBeNull()
  })

  it('★ 与配方、选路策略同表但互不干扰', async () => {
    const s = store()
    await s.saveAgentDefault({ channelId: 'c1', model: 'm1' })
    await s.saveRoutingStrategy('balanced')
    expect(await s.loadAgentDefault()).toEqual({ channelId: 'c1', model: 'm1' })
    expect(await s.loadRoutingStrategy()).toBe('balanced')
  })
})
