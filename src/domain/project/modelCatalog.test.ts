import { describe, expect, it } from 'vitest'
import {
  aliasTargets,
  categoryOfLogical,
  channelIdForLogical,
  logicalNames,
  logicalOptions,
  panelModelOptions,
  presetOf,
  toLogicalName,
  type CatalogChannelLike,
} from './modelCatalog'
import type { ModelCapability } from '../shared/capability'
import { PRESET_MODELS } from './modelPresets'

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

  /**
   * ★★ 用户 2026-10-02 报的真现象：**Agnes 的对话模型只有一个，agent 里却列了一串**。
   *
   * 数据来自只读探针（`scripts/probe-user-channels.mjs` 读用户浏览器那份真数据）：
   * Agnes 渠道 `models` 只勾了 3 个，但「拉取模型」给 15 个模型各登记了一行映射 ——
   * 其中 12 行是**恒等**（`agnes-3.0-flash → agnes-3.0-flash` 这种），
   * 只有 3 行是真的重命名（`Agnes 2.5 Pro → agnes-2.5-pro`）。
   *
   * 恒等行会把**没勾选**的模型重新拽回下拉（它们躺在 `modelCache` 里，
   * `findProvider` 找得到、分类也取得到），于是「筛选过」这件事被绕过。
   */
  it('★★ 恒等映射不贡献逻辑名：没勾选的模型不许从后门漏回下拉', () => {
    const agnes = ch({
      id: 'agnes',
      models: [cap('agnes-2.5-pro', 'chat')],
      modelCache: [
        cap('agnes-2.5-pro', 'chat'),
        cap('agnes-3.0-flash', 'chat'),
        cap('agnes-2.0-flash', 'chat'),
        cap('agnes-image-2.5-flash', 'image'),
      ],
      modelMap: {
        'agnes-3.0-flash': 'agnes-3.0-flash',
        'agnes-2.0-flash': 'agnes-2.0-flash',
        'agnes-2.5-pro': 'agnes-2.5-pro',
        'agnes-image-2.5-flash': 'agnes-image-2.5-flash',
        'Agnes 2.5 Pro': 'agnes-2.5-pro',
        'Agnes Image 2.5 Flash': 'agnes-image-2.5-flash',
      },
    })
    expect(logicalNames([agnes]).sort()).toEqual(['Agnes 2.5 Pro', 'Agnes Image 2.5 Flash'])
    expect(logicalOptions([agnes], 'chat')).toEqual(['Agnes 2.5 Pro'])
  })

  it('★★ 老节点 / 老会话里存的裸 ID 归一成显示名（不被恒等行先截胡）', () => {
    const agnes = ch({
      id: 'agnes',
      models: [cap('agnes-2.5-pro', 'chat')],
      modelMap: { 'agnes-2.5-pro': 'agnes-2.5-pro', 'Agnes 2.5 Pro': 'agnes-2.5-pro' },
    })
    expect(toLogicalName([agnes], 'agnes-2.5-pro')).toBe('Agnes 2.5 Pro')
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

/**
 * 创作面板的模型下拉数据源（用户 2026-09-27 第 7 轮）。
 *
 * 用户要的是「前端只显示我定好的那几个名字」：
 * 固定清单排在**最前**，其后才是渠道里勾选过的其它模型。
 */
describe('panelModelOptions', () => {
  it('★ 固定显示名排在最前（用户拍板的那几个永远看得见）', () => {
    const c = ch({ id: 'A', models: [cap('mock-image-1')] })
    const opts = panelModelOptions([c], 'image')
    // 与清单本身对齐，不写死名字 —— 以后加显示名（Agnes 那三条）不用回来改断言，
    // 但「固定名排在最前」这条性质仍然被钉住
    const presetImage = PRESET_MODELS.filter((m) => m.category === 'image').map((m) => m.id)
    expect(opts.slice(0, presetImage.length)).toEqual(presetImage)
    expect(presetImage).toContain('GPT Image 2')
    expect(presetImage).toContain('Midjourney')
  })

  it('★ 渠道勾过的其它模型跟在固定清单后面（没配映射的站不该一个都选不出来）', () => {
    const c = ch({ id: 'A', models: [cap('mock-image-1')] })
    const opts = panelModelOptions([c], 'image')
    expect(opts).toContain('mock-image-1')
    expect(opts.indexOf('mock-image-1')).toBeGreaterThan(opts.indexOf('Midjourney'))
  })

  it('★ 与固定名同名的渠道模型不重复出现', () => {
    const c = ch({ id: 'A', models: [cap('Midjourney')] })
    const opts = panelModelOptions([c], 'image')
    expect(opts.filter((n) => n === 'Midjourney')).toHaveLength(1)
  })

  it('按类别分档：生图档不混入对话 / 视频固定名', () => {
    const image = panelModelOptions([], 'image')
    expect(image).not.toContain('GPT-6 Astra')
    expect(image).not.toContain('即梦 2.5')
    const chat = panelModelOptions([], 'chat')
    // 对话档里不该出现生图 / 视频的名字
    expect(chat).not.toContain('Midjourney')
    expect(chat).not.toContain('即梦 2.5')
    // 每档恰好是清单里该类别的那几个（顺序也一致）
    for (const c of ['image', 'chat', 'video'] as const) {
      expect(panelModelOptions([], c)).toEqual(
        PRESET_MODELS.filter((m) => m.category === c).map((m) => m.id),
      )
    }
  })

  it('presetOf 取得到厂商（面板据此画图标），非固定名返回 undefined', () => {
    expect(presetOf('Midjourney')?.vendor).toBe('midjourney')
    expect(presetOf('Gemini Omni Flash 1.1')?.vendor).toBe('google')
    expect(presetOf('GPT Image 2')?.vendor).toBe('openai')
    expect(presetOf('mock-image-1')).toBeUndefined()
  })

  /**
   * ★ 渠道勾的是上游 ID（`gpt-image-2`），而固定清单里已经有 `GPT Image 2` ——
   * 不归一的话用户会在下拉里同时看到这两行，看起来像两个模型
   * （用户 2026-09-27 第 8 轮报的正是「id 格式不一样」）。
   */
  it('★ 上游 ID 归一成显示名，不与固定项重复占位', () => {
    const c = ch({ id: 'A', models: [cap('gpt-image-2')] })
    const opts = panelModelOptions([c], 'image')
    expect(opts.filter((n) => n === 'GPT Image 2')).toHaveLength(1)
    expect(opts).not.toContain('gpt-image-2')
  })

  it('★ 老节点存的是上游 ID → 显示成拍板过的显示名', () => {
    const channels = [ch({ id: 'A', models: [cap('gpt-image-2')] })]
    expect(toLogicalName(channels, 'gpt-image-2')).toBe('GPT Image 2')
  })

  it('★ 固定显示名即使渠道里没有同名模型，也能取到分类（切类别不被误清）', () => {
    const channels = [ch({ id: 'A', models: [cap('mock-image-1')] })]
    // 渠道里根本没有 GPT Image 2.5 Flare，但它是固定生图名
    expect(categoryOfLogical(channels, 'GPT Image 2.5 Flare', 'A')).toBe('image')
    expect(categoryOfLogical(channels, 'GPT-6 Astra', 'A')).toBe('chat')
    expect(categoryOfLogical(channels, '即梦 2.5', 'A')).toBe('video')
  })
})

/**
 * 用户 2026-10-02：「不要有选择渠道」——对话窗只让选模型。
 *
 * 但 `completeWithTools` 必须拿到 channelId 才能找到适配器与令牌，所以
 * 「选模型」这一步要顺带解析出渠道。这份解析与 `capabilityOfLogical`
 * **同一条搜索**：各写一份就会出现「模型在下拉里选得出来、渠道却找不到」
 * 的幽灵项，表现是发消息报看不懂的渠道错误。
 */
describe('channelIdForLogical', () => {
  it('★ 映射优先：逻辑名翻译成上游 ID 后，落在真勾了那条 ID 的渠道上', () => {
    const channels = [
      ch({ id: 'A', models: [cap('gpt-image-2')], modelMap: { 'image-2': 'gpt-image-2' } }),
    ]
    expect(channelIdForLogical(channels, 'image-2')).toBe('A')
  })

  it('★ 没有映射时按同名直配找（老渠道零迁移）', () => {
    const channels = [ch({ id: 'B', models: [cap('mock-image-1')] })]
    expect(channelIdForLogical(channels, 'mock-image-1')).toBe('B')
  })

  it('★ 两条渠道都能提供时取目录顺序的第一条，不许随机挑', () => {
    const channels = [
      ch({ id: 'A', models: [cap('shared-model')] }),
      ch({ id: 'B', models: [cap('shared-model')] }),
    ]
    expect(channelIdForLogical(channels, 'shared-model')).toBe('A')
  })

  /**
   * 当前会话**已经在用的**渠道若能提供这个模型就不要换 ——
   * 换渠道会让同一个模型突然走另一条线（另一套令牌、另一份映射），
   * 而用户只是在换模型，没要求换渠道。
   */
  it('★ preferChannelId 让在用渠道赢过目录顺序（换模型不该顺手换渠道）', () => {
    const channels = [
      ch({ id: 'A', models: [cap('shared-model')] }),
      ch({ id: 'B', models: [cap('shared-model')] }),
    ]
    expect(channelIdForLogical(channels, 'shared-model', 'B')).toBe('B')
  })

  it('★ 在用的渠道提供不了它时才换（不许因为偏好就留在错的渠道上）', () => {
    const channels = [
      ch({ id: 'A', models: [cap('only-in-a')] }),
      ch({ id: 'B', models: [cap('only-in-b')] }),
    ]
    expect(channelIdForLogical(channels, 'only-in-b', 'A')).toBe('B')
  })

  it('没有任何渠道提供它时返回 undefined（不猜、不硬塞一条）', () => {
    const channels = [ch({ id: 'A', models: [cap('mock-image-1')] })]
    expect(channelIdForLogical(channels, 'GPT-6 Astra')).toBeUndefined()
    expect(channelIdForLogical(channels, '')).toBeUndefined()
  })
})
