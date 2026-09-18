import { describe, it, expect } from 'vitest'
import { beforeEach } from 'vitest'
import { newGeneratingNodeData } from './newNodePreset'
import { registerAllSpecs, resetSpecs } from './index'

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

describe('新建节点的默认数据（用户 2026-09-17）', () => {
  it('★ 生成 / 批量节点带上上次用过的渠道与模型', () => {
    const preset = { channelId: 'ch1', model: 'm1' }
    // 用 matchObject：结果还含 spec 的默认字段（见下一条用例的理由）
    expect(newGeneratingNodeData('generation', preset)).toMatchObject({
      channelId: 'ch1',
      model: 'm1',
    })
    expect(newGeneratingNodeData('batch', preset)).toMatchObject({ channelId: 'ch1', model: 'm1' })
  })

  it('没有可用预设 → 不写（节点回到 spec 默认，用户自己选）', () => {
    expect(newGeneratingNodeData('generation', null)).toEqual({})
  })

  /**
   * ★ 预设必须基于 spec 默认数据叠加，不能只返回渠道 + 模型。
   *
   * 回归的是 2026-09-18 实测到的一个真 bug：`node.create` 的 reducer 是
   * `cmd.data ?? spec.createDefaultData()` —— 传了 data 就**整体替换**。
   * 只给两个字段会让 `mode` / `count` / `thumbOrder` 全丢，节点连
   * 「是图片还是视频」都不知道，请求的 `kind` 随之 undefined，
   * 渠道层 switch 不匹配、静默返回 undefined —— 表现为「点生成什么都没出」。
   */
  it('★ 带预设时仍保留 spec 的默认字段（mode 不能被吃掉）', () => {
    const d = newGeneratingNodeData('generation', { channelId: 'ch1', model: 'm1' })
    expect(d.mode).toBe('image')
    expect(d.thumbOrder).toEqual([])
    expect(d.channelId).toBe('ch1')
    expect(d.model).toBe('m1')
  })

  /**
   * 提示词 / 对比 / 分组 / 画板不参与：它们没有「渠道 + 模型」这个概念，
   * 塞进去只会让 data 多两个永远没人读的字段（假数据）。
   */
  it('非生成类节点不带渠道 / 模型', () => {
    const preset = { channelId: 'ch1', model: 'm1' }
    for (const t of ['prompt', 'compare', 'group', 'board'] as const) {
      expect(newGeneratingNodeData(t, preset)).toEqual({})
    }
  })
})
