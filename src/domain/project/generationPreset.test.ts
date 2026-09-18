import { describe, it, expect } from 'vitest'
import {
  NO_PRESET,
  presetFromRow,
  presetToRow,
  rememberPreset,
  resolvePreset,
  type PresetChannelLike,
} from './generationPreset'

/** 两个渠道：ch1 勾了 m1 / m2，ch2 一个都没勾 */
const channels: PresetChannelLike[] = [
  { id: 'ch1', models: [{ id: 'm1' }, { id: 'm2' }] },
  { id: 'ch2', models: [] },
]

describe('生成预设（新建节点默认渠道 / 模型）', () => {
  it('★ 渠道与模型都齐了才记（半份预设比没有更糟）', () => {
    expect(rememberPreset('ch1', 'm1', 100)).toEqual({ channelId: 'ch1', model: 'm1', savedAt: 100 })
    // 只选了渠道、还没选模型 → 不记
    expect(rememberPreset('ch1', '', 100)).toBeNull()
    expect(rememberPreset('', 'm1', 100)).toBeNull()
  })

  it('行 ↔ 预设：字段缺失 / 类型不对一律退化为空预设', () => {
    expect(presetFromRow(null)).toEqual(NO_PRESET)
    expect(presetFromRow({})).toEqual(NO_PRESET)
    // 半份：有渠道没模型 → 不当预设用（否则面板显示渠道却跑不起来）
    expect(presetFromRow({ channelId: 'ch1' })).toEqual(NO_PRESET)
    expect(presetFromRow({ channelId: 'ch1', model: 'm1', savedAt: 7 })).toEqual({
      channelId: 'ch1',
      model: 'm1',
      savedAt: 7,
    })
    expect(presetToRow({ channelId: 'ch1', model: 'm1', savedAt: 7 }).id).toBe('generation-default')
  })

  it('★ 预设仍可用 → 原样返回', () => {
    expect(resolvePreset({ channelId: 'ch1', model: 'm1', savedAt: 0 }, channels)).toEqual({
      channelId: 'ch1',
      model: 'm1',
      substituted: false,
    })
  })

  it('★ 原模型已不在该渠道里 → 兜底取第一个已勾选模型，并标明是兜底', () => {
    expect(resolvePreset({ channelId: 'ch1', model: 'gone', savedAt: 0 }, channels)).toEqual({
      channelId: 'ch1',
      model: 'm1',
      substituted: true,
    })
  })

  it('渠道被删 / 渠道没勾任何模型 → 没有默认值可用（返回 null，不猜）', () => {
    expect(resolvePreset({ channelId: 'deleted', model: 'm1', savedAt: 0 }, channels)).toBeNull()
    expect(resolvePreset({ channelId: 'ch2', model: 'm1', savedAt: 0 }, channels)).toBeNull()
    expect(resolvePreset(NO_PRESET, channels)).toBeNull()
  })
})
