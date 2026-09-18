import { describe, it, expect } from 'vitest'
import {
  NO_RECIPE,
  firstUsableChannel,
  presetRowId,
  recipeFromRow,
  recipeToRow,
  rememberRecipe,
  resolveRecipe,
  type PresetChannelLike,
} from './generationPreset'

/** 两个渠道：ch1 勾了 m1 / m2，ch2 一个都没勾 */
const channels: PresetChannelLike[] = [
  { id: 'ch1', models: [{ id: 'm1' }, { id: 'm2' }] },
  { id: 'ch2', models: [] },
]

describe('生成配方（新建节点的默认渠道 / 模型 / 参数）', () => {
  /**
   * ★ 用户 2026-09-18 口径：项目从没生成过时，用**第一个渠道的第一个模型**。
   * 此前返回 null（留空），于是每个新节点都空着，看起来像「默认功能没做」。
   */
  it('★ 没有配方 → 取第一个有模型的渠道的第一个模型', () => {
    expect(firstUsableChannel(channels)).toEqual({
      channelId: 'ch1',
      model: 'm1',
      params: {},
      substituted: true,
    })
  })

  it('渠道都没勾模型 → 给不出默认值（不猜）', () => {
    expect(firstUsableChannel([{ id: 'ch2', models: [] }])).toBeNull()
  })

  /**
   * ★ 勾选为空时**回落到 modelCache**（2026-09-18 实测踩到）。
   *
   * 「拉取模型」只把模型放进缓存，**不等于勾选**——用户还得在设置页的
   * 「选择模型」里勾上并点应用。于是「只配一个渠道、点了拉取、直接回画布建节点」
   * 这条最常见的路径下 `models` 是空的；不回落到缓存就什么都拿不到，
   * 表现成「明明配好了渠道，新建节点还是空的」。
   */
  it('★ 已勾选为空 → 回落到 modelCache 的第一个', () => {
    const ch: PresetChannelLike = {
      id: 'ch1',
      models: [],
      modelCache: [{ id: 'from-cache' }, { id: 'second' }],
    }
    expect(firstUsableChannel([ch])).toEqual({
      channelId: 'ch1',
      model: 'from-cache',
      params: {},
      substituted: true,
    })
  })

  it('★ 有勾选时以勾选为准（不再看缓存，否则用户筛掉的模型会冒出来）', () => {
    const ch: PresetChannelLike = {
      id: 'ch1',
      models: [{ id: 'picked' }],
      modelCache: [{ id: 'from-cache' }],
    }
    expect(firstUsableChannel([ch])?.model).toBe('picked')
  })

  it('★ 配方里的模型仍在该渠道的缓存里 → 视为有效（不算失效）', () => {
    const ch: PresetChannelLike = {
      id: 'ch1',
      models: [],
      modelCache: [{ id: 'kept' }],
    }
    expect(resolveRecipe({ channelId: 'ch1', model: 'kept', params: {}, savedAt: 0 }, [ch])).toEqual({
      channelId: 'ch1',
      model: 'kept',
      params: {},
      substituted: false,
    })
  })

  it('★ 渠道 + 模型都有值才记（半份配方比没有更糟）', () => {
    expect(rememberRecipe('ch1', 'm1', { ratio: '16:9' }, 100)).toEqual({
      channelId: 'ch1',
      model: 'm1',
      params: { ratio: '16:9' },
      savedAt: 100,
    })
    expect(rememberRecipe('ch1', '', {}, 100)).toBeNull()
    expect(rememberRecipe('', 'm1', {}, 100)).toBeNull()
  })

  it('行 ↔ 配方：缺字段 / 类型不对一律退化为空配方', () => {
    expect(recipeFromRow(null)).toEqual(NO_RECIPE)
    expect(recipeFromRow({})).toEqual(NO_RECIPE)
    expect(recipeFromRow({ channelId: 'ch1' })).toEqual(NO_RECIPE)
    expect(recipeFromRow({ channelId: 'ch1', model: 'm1', params: { ratio: '1:1' }, savedAt: 7 })).toEqual({
      channelId: 'ch1',
      model: 'm1',
      params: { ratio: '1:1' },
      savedAt: 7,
    })
    // params 不是对象 → 退化为空对象，而不是把数组/字符串当参数带下去
    const bad = recipeFromRow({ channelId: 'ch1', model: 'm1', params: [1, 2] })
    expect(bad.params).toEqual({})
  })

  /**
   * ★ 配方**按项目存**（用户 2026-09-18 修订自「全局一份」）。
   * 行主键由 projectId 派生，两个项目互不覆盖。
   */
  it('★ 行主键按项目隔离：两个项目的配方互不覆盖', () => {
    const a = recipeToRow('p1', { channelId: 'c', model: 'm', params: {}, savedAt: 0 })
    const b = recipeToRow('p2', { channelId: 'c', model: 'm', params: {}, savedAt: 0 })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toBe(presetRowId('p1'))
    expect(a.projectId).toBe('p1')
  })

  it('配方仍可用 → 原样返回（含参数）', () => {
    const r = resolveRecipe(
      { channelId: 'ch1', model: 'm1', params: { count: 4 }, savedAt: 0 },
      channels,
    )
    expect(r).toEqual({ channelId: 'ch1', model: 'm1', params: { count: 4 }, substituted: false })
  })

  it('★ 原模型已不在该渠道 → 兜底该渠道第一个模型，但参数仍沿用记录', () => {
    const r = resolveRecipe(
      { channelId: 'ch1', model: 'gone', params: { ratio: '16:9' }, savedAt: 0 },
      channels,
    )
    expect(r).toEqual({
      channelId: 'ch1',
      model: 'm1',
      params: { ratio: '16:9' },
      substituted: true,
    })
  })

  it('渠道被删 / 渠道没勾模型 → 解析不出（交由上层落回「第一个可用渠道」）', () => {
    expect(resolveRecipe({ channelId: 'gone', model: 'm1', params: {}, savedAt: 0 }, channels)).toBeNull()
    expect(resolveRecipe({ channelId: 'ch2', model: 'm1', params: {}, savedAt: 0 }, channels)).toBeNull()
    expect(resolveRecipe(NO_RECIPE, channels)).toBeNull()
  })
})
