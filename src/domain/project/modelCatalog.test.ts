import { describe, expect, it } from 'vitest'
import {
  aliasTargets,
  categoryOfLogical,
  logicalNames,
  logicalOptions,
  toLogicalName,
  type CatalogChannelLike,
} from './modelCatalog'
import type { ModelCapability } from '../shared/capability'

const cap = (id: string, category: ModelCapability['category'] = 'image'): ModelCapability => ({
  id,
  category,
  inputTypes: ['text'],
})

const ch = (over: Partial<CatalogChannelLike> & { id: string }): CatalogChannelLike => ({
  enabled: true,
  models: [],
  modelCache: [],
  modelMap: {},
  ...over,
})

describe('logicalNames', () => {
  it('★ 同一个模型只出一个名字：映射目标不再单独占位', () => {
    const out = logicalNames([
      ch({ id: 'A', models: [cap('image-2')], modelMap: { 'image-2': 'gpt-image-2' } }),
      ch({ id: 'B', models: [cap('gpt-image-2')] }),
    ])
    // B 站的 gpt-image-2 是 A 站 image-2 的别名目标 ⇒ 不单独出现
    expect(out).toEqual(['image-2'])
  })

  it('★ 无映射时逻辑名 = 上游 ID（老渠道零迁移，下拉与以前一字不差）', () => {
    const out = logicalNames([ch({ id: 'A', models: [cap('mock-image-1'), cap('mock-chat-1', 'chat')] })])
    expect(out.sort()).toEqual(['mock-chat-1', 'mock-image-1'])
  })

  it('★ 映射的**键**就是逻辑名（跨站点稳定）', () => {
    const out = logicalNames([
      ch({ id: 'A', modelMap: { '我的主力模型': 'gpt-image-2' } }),
      ch({ id: 'B', modelMap: { '我的主力模型': 'image-2' } }),
    ])
    expect(out).toEqual(['我的主力模型'])
  })

  it('空渠道不炸', () => {
    expect(logicalNames([])).toEqual([])
  })

  /**
   * ★ 用户 2026-09-27 报「我的模型上又很多很多模型」的回归断言。
   *
   * 中转站一次拉回几百个进 `modelCache`，而用户只勾了 2 个进 `models`。
   * 下拉必须**只列勾选的那 2 个** —— 把缓存全量并进来，用户特意筛掉的会全回来。
   */
  it('★★ 已勾选时，缓存里的其它模型不进下拉（勾选优先）', () => {
    const c = ch({
      id: 'A',
      models: [cap('picked-1'), cap('picked-2')],
      modelCache: [cap('picked-1'), cap('picked-2'), cap('junk-1'), cap('junk-2'), cap('junk-3')],
    })
    expect(logicalNames([c]).sort()).toEqual(['picked-1', 'picked-2'])
    expect(logicalOptions([c], 'image').sort()).toEqual(['picked-1', 'picked-2'])
  })

  it('★ 一个都没勾选时才回落缓存（「拉取了但还没勾」不该是空下拉）', () => {
    const c = ch({ id: 'A', models: [], modelCache: [cap('cached-1'), cap('cached-2')] })
    expect(logicalNames([c]).sort()).toEqual(['cached-1', 'cached-2'])
  })

  it('aliasTargets 收集全部映射目标', () => {
    expect(
      aliasTargets([
        ch({ id: 'A', modelMap: { x: 'up-1' } }),
        ch({ id: 'B', modelMap: { x: 'up-2', y: '' } }),
      ]),
    ).toEqual(new Set(['up-1', 'up-2']))
  })

  /**
   * 恒等映射（`image-2 → image-2`）**不能**把 `image-2` 排出目录：
   * 否则一个只是登记过恒等映射的模型会凭空消失，chip 取不到能力
   * ⇒ 视频参数不出现、切类别时旧模型清不掉（G46 回归）。
   */
  it('★ 恒等映射不该把模型排出目录（否则它会凭空消失）', () => {
    const channels = [ch({ id: 'A', models: [cap('image-2')], modelMap: { 'image-2': 'image-2' } })]
    expect(aliasTargets(channels).has('image-2')).toBe(false)
    expect(logicalNames(channels)).toEqual(['image-2'])
    expect(categoryOfLogical(channels, 'image-2', 'A')).toBe('image')
  })
})

describe('category / options', () => {
  const channels = [
    ch({ id: 'A', models: [cap('image-2')], modelMap: { 'image-2': 'gpt-image-2' } }),
    ch({
      id: 'B',
      models: [cap('gpt-image-2'), cap('b-chat', 'chat')],
      modelMap: { 'image-2': 'gpt-image-2' },
    }),
  ]

  it('★ 逻辑名的分类按**映射出的上游 ID**的能力取', () => {
    expect(categoryOfLogical(channels, 'image-2')).toBe('image')
    expect(categoryOfLogical(channels, 'b-chat')).toBe('chat')
  })

  it('★ 逻辑名下按分类过滤（生图档只出生图，不混入对话模型）', () => {
    expect(logicalOptions(channels, 'image')).toEqual(['image-2'])
    expect(logicalOptions(channels, 'chat')).toEqual(['b-chat'])
    expect(logicalOptions(channels, 'video')).toEqual([])
  })

  it('取不到分类时返回 undefined（不猜）', () => {
    expect(categoryOfLogical(channels, '不存在的模型')).toBeUndefined()
  })

  it('★ 切类别判定：节点存的是生图模型 → 判「不属于视频」（G46 回归场景）', () => {
    const one = [
      ch({
        id: 'A',
        models: [cap('mock-image-1', 'image'), cap('mock-video-1', 'video')],
      }),
    ]
    // 存储值就是逻辑名（无映射时恒等）
    const logical = toLogicalName(one, 'mock-image-1')
    expect(logical).toBe('mock-image-1')
    expect(categoryOfLogical(one, logical, 'A')).toBe('image')
    expect(categoryOfLogical(one, logical, 'A') === 'video').toBe(false)
  })

  it('★ 切类别判定：节点存的是视频模型 → 判「属于视频」（不该被清掉）', () => {
    const one = [
      ch({
        id: 'A',
        models: [cap('mock-image-1', 'image'), cap('mock-video-1', 'video')],
      }),
    ]
    expect(categoryOfLogical(one, toLogicalName(one, 'mock-video-1'), 'A')).toBe('video')
  })

  /**
   * G46 的真实形状：**两条**渠道（G46 会建第二条），生图模型只在其中一条，
   * 且没传 channelId（面板是按全量渠道推目录的）。
   */
  it('★ 多渠道 + 不指定渠道：生图模型仍判为 image（不误判成 video 或 undefined）', () => {
    const two = [
      ch({ id: 'A', models: [cap('mock-image-1', 'image'), cap('mock-video-1', 'video')] }),
      ch({ id: 'B', models: [cap('mock-chat-1', 'chat')] }),
    ]
    expect(categoryOfLogical(two, 'mock-image-1')).toBe('image')
    expect(categoryOfLogical(two, 'mock-image-1') === 'video').toBe(false)
    expect(logicalOptions(two, 'video')).toEqual(['mock-video-1'])
  })
})

describe('toLogicalName', () => {
  const channels = [
    ch({ id: 'A', models: [cap('image-2')], modelMap: { 'image-2': 'gpt-image-2' } }),
    ch({ id: 'B', models: [cap('gpt-image-2')] }),
  ]

  it('★ 老节点存的是上游 ID → 归一成逻辑名（下拉里才对得上）', () => {
    expect(toLogicalName(channels, 'gpt-image-2')).toBe('image-2')
  })

  it('本来就是逻辑名则原样返回', () => {
    expect(toLogicalName(channels, 'image-2')).toBe('image-2')
  })

  it('★ 没有别名关系时原样返回（恒等，与以前一致）', () => {
    expect(toLogicalName(channels, 'mock-image-1')).toBe('mock-image-1')
  })

  it('空值不炸', () => {
    expect(toLogicalName(channels, '')).toBe('')
    expect(toLogicalName([], 'x')).toBe('x')
  })
})
