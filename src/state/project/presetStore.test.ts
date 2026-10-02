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

  /**
   * ★★ **反向**也要挡住：`loadAll`（配方全量读）只认 `recipe:` 前缀的行。
   *
   * 这是一条真缺陷的回归断言（2026-10-02 冒烟 G95 抓出来，在它之前一直
   * 「同表但互不干扰」那条断言是绿的 —— 因为它只验了**正向**读，没验全表扫描）：
   * `agent:default` 那行恰好也带 `channelId` + `model`，`loadAll` 不挡前缀的话
   * 它会被读成一条**生成配方**。于是用户点完「设为默认模型」，画布上新建的
   * 生成节点就带上了那个对话模型，点生成静默失败（报「没有渠道提供模型」）。
   */
  it('★★ loadAll 只读配方行：Agent 默认模型与选路策略都不许混进来', async () => {
    const s = store()
    await s.save({ channelId: 'c1', model: 'mock-image-1', params: { ratio: '1:1' }, savedAt: 5 })
    await s.saveAgentDefault({ channelId: 'c9', model: 'Agnes 2.5 Pro' })
    await s.saveRoutingStrategy('balanced')
    const all = await s.loadAll()
    expect([...all.keys()]).toEqual(['c1'])
    expect(all.get('c1')?.model).toBe('mock-image-1')
  })
})
