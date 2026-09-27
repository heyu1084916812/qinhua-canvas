import { describe, it, expect } from 'vitest'
import {
  NO_RECIPE,
  firstUsableChannel,
  presetRowId,
  recipeFromRow,
  recipeToRow,
  rememberRecipe,
  isRecipeEdit,
  resolveForNode,
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
   * ★ 配方**按渠道存**（2026-09-18 晚收口；对照参考项目的「模式桶」后确认，
   * 本项目统一走渠道，故其模式层等价于渠道层）。行主键由 channelId 派生，
   * 两条渠道互不覆盖。
   */
  it('★ 行主键按渠道隔离：两条渠道的配方互不覆盖', () => {
    const a = recipeToRow({ channelId: 'ch1', model: 'm', params: {}, savedAt: 0 })
    const b = recipeToRow({ channelId: 'ch2', model: 'm', params: {}, savedAt: 0 })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toBe(presetRowId('ch1'))
    expect(a.channelId).toBe('ch1')
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

  /**
   * ★ 记的模型**不属于本次要的类别** → 不能原样沿用（用户 2026-09-27 实测暴露）。
   *
   * 图片 → 视频切类别时，配方里记的还是上次那张图用的生图模型。
   * 只判「渠道还提供它吗」会把它判成有效 ⇒ 面板又把生图模型填回视频模式，
   * 界面看着换过来了、请求却带着图片模型。有 `category` 时必须按类别过滤。
   */
  it('★ 记录里的模型属于别类 → 不沿用，改取该类第一个（G46 实测场景）', () => {
    const mixed: PresetChannelLike[] = [
      {
        id: 'ch1',
        models: [
          { id: 'img-1', category: 'image' },
          { id: 'vid-1', category: 'video' },
        ],
      },
    ]
    const r = resolveRecipe(
      { channelId: 'ch1', model: 'img-1', params: { mode: 'image' }, savedAt: 0 },
      mixed,
      'video',
    )
    expect(r?.model).toBe('vid-1')
    expect(r?.substituted).toBe(true)
  })

  it('记录里的模型就是目标类别 → 仍原样沿用', () => {
    const mixed: PresetChannelLike[] = [
      {
        id: 'ch1',
        models: [
          { id: 'img-1', category: 'image' },
          { id: 'vid-1', category: 'video' },
        ],
      },
    ]
    const r = resolveRecipe(
      { channelId: 'ch1', model: 'vid-1', params: {}, savedAt: 0 },
      mixed,
      'video',
    )
    expect(r).toEqual({ channelId: 'ch1', model: 'vid-1', params: {}, substituted: false })
  })

  it('渠道被删 / 渠道没勾模型 → 解析不出（交由上层落回「第一个可用渠道」）', () => {
    expect(resolveRecipe({ channelId: 'gone', model: 'm1', params: {}, savedAt: 0 }, channels)).toBeNull()
    expect(resolveRecipe({ channelId: 'ch2', model: 'm1', params: {}, savedAt: 0 }, channels)).toBeNull()
    expect(resolveRecipe(NO_RECIPE, channels)).toBeNull()
  })

  /**
   * ★ `resolveForNode` 是**统一入口**：创建路径与面板兜底都调它。
   *
   * 这组用例锁的是「节点是空的也能解析出默认值」——正是那个用户反复报的
   * bug（明明配了渠道，新建节点还是空的）。
   */
  describe('resolveForNode（解析链）', () => {
    const noRecipes = () => NO_RECIPE

    it('★ 节点什么都没有 → 取第一个可用渠道的首模型', () => {
      expect(resolveForNode({}, channels, noRecipes)).toEqual({
        channelId: 'ch1',
        model: 'm1',
        params: {},
        substituted: true,
      })
    })

    it('★ 节点带渠道但没模型 → 该渠道首模型（面板兜底的关键一档）', () => {
      expect(resolveForNode({ channelId: 'ch1' }, channels, noRecipes)).toEqual({
        channelId: 'ch1',
        model: 'm1',
        params: {},
        substituted: true,
      })
    })

    it('★ 节点带渠道 + 模型且都可用 → 原样保留，不替换', () => {
      expect(resolveForNode({ channelId: 'ch1', model: 'm2' }, channels, noRecipes)).toEqual({
        channelId: 'ch1',
        model: 'm2',
        params: {},
        substituted: false,
      })
    })

    it('★ 节点模型已失效 → 落到该渠道的记录，参数一并沿用', () => {
      const recipes = (channelId: string) =>
        channelId === 'ch1'
          ? { channelId: 'ch1', model: 'm2', params: { ratio: '16:9' }, savedAt: 1 }
          : NO_RECIPE
      expect(resolveForNode({ channelId: 'ch1', model: 'gone' }, channels, recipes)).toEqual({
        channelId: 'ch1',
        model: 'm2',
        params: { ratio: '16:9' },
        substituted: false,
      })
    })

    it('★ 节点带齐但渠道已失效 → 落到第一个可用渠道', () => {
      expect(resolveForNode({ channelId: 'gone', model: 'm1' }, channels, noRecipes)).toEqual({
        channelId: 'ch1',
        model: 'm1',
        params: {},
        substituted: true,
      })
    })

    /**
     * ★ category=chat 时默认取**固定显示名的第一个**，不是渠道里的第一条。
     *
     * 用户 2026-09-27 第 8 轮实测报「提示词节点模型显示 advanced-voice」——
     * 因为渠道勾选顺序是上游给的，`advanced-voice` 这类与创作无关的条目
     * 恰好排在前面。固定清单是用户拍板的那几行，第一项才是合适的默认值。
     */
    it('★ category=chat → 默认是固定清单第一个（GPT-6 Astra），不是渠道首条', () => {
      const withChat = [
        { id: 'img', models: [{ id: 'i1' }] },
        { id: 'chat', models: [{ id: 'advanced-voice', category: 'chat' }] },
      ] as unknown as PresetChannelLike[]
      expect(resolveForNode({}, withChat, noRecipes, 'chat')).toEqual({
        channelId: 'chat',
        model: 'GPT-6 Astra',
        params: {},
        substituted: true,
      })
    })

    /**
     * ★ 生图 / 视频**不受**这条影响：默认仍是该渠道的第一个模型。
     *
     * 「修提示词默认值」不该顺手改掉生成节点的默认值 —— 那是另一次行为变更，
     * 用户没要求，也会让 G46 / G69 这些既有断言莫名其妙地红。
     */
    it('★ category=image → 仍是渠道第一个模型（不被固定清单顶替）', () => {
      const channels = [
        { id: 'ch1', models: [{ id: 'weird-model-1', category: 'image' }] },
      ] as unknown as PresetChannelLike[]
      expect(resolveForNode({}, channels, noRecipes, 'image')).toEqual({
        channelId: 'ch1',
        model: 'weird-model-1',
        params: {},
        substituted: true,
      })
    })

    /** 只有生图模型的渠道，不该因为一个固定对话名而被选成对话节点的默认渠道 */
    it('★ 渠道没有对话模型 → 不硬塞固定对话名（返回 null）', () => {
      const channels = [
        { id: 'ch1', models: [{ id: 'img-1', category: 'image' }] },
      ] as unknown as PresetChannelLike[]
      expect(resolveForNode({}, channels, noRecipes, 'chat')).toBeNull()
    })

    it('全都没有可用模型 → null（调用方给可诊断的解释，不留空白下拉）', () => {
      expect(resolveForNode({}, [{ id: 'ch2', models: [] }], noRecipes)).toBeNull()
    })

    /**
     * ★ 节点是空的、但该渠道记过配方 → 必须捡回记录（含参数）。
     *
     * 这条是「创建路径」的核心：新建节点自身什么都没有，若解析链直接跳到
     * 「第一个可用渠道的首模型」，就会把上次生成用的参数（比例 / 数量）丢掉，
     * 「按渠道记忆」这条规则在创建路径上等于失效。
     */
    it('★ 空节点 + 有记录 → 捡回记录（含参数），不退化成首模型', () => {
      const recipes = (channelId: string) =>
        channelId === 'ch1'
          ? { channelId: 'ch1', model: 'm2', params: { ratio: '16:9', count: 4 }, savedAt: 1 }
          : NO_RECIPE
      expect(resolveForNode({}, channels, recipes)).toEqual({
        channelId: 'ch1',
        model: 'm2',
        params: { ratio: '16:9', count: 4 },
        substituted: false,
      })
    })
  })
})
/**
 * 「改了参数就记住」——记录时机修订（用户 2026-09-23）。
 *
 * 原口径是「生成成功那一刻才记」，用户明确否掉：
 * 「只要我改了参数，他也给我记住……后面每次新建的节点参数就来自于上个新建节点时候的参数」。
 *
 * 于是新增 `isRecipeEdit`：它是「哪些面板改动算改了配方」的**唯一判据**。
 * 这一组把它钉住——加新参数时忘了登记，用户就会遇到「改了这一项、新建节点却没记住」。
 */
describe('isRecipeEdit · 哪些改动算「改了配方」', () => {
  it('参数类事件都算（模型 / 比例 / 画质 / 质量 / 张数 / 尺寸 / 时长 / 参考模式）', () => {
    for (const ev of [
      'setModel',
      'setRatio',
      'setResolution',
      'setQuality',
      'setCount',
      'setSize',
      'setDurationSec',
      'setRefMode',
    ]) {
      expect(isRecipeEdit(ev), `${ev} 应当算配方改动`).toBe(true)
    }
  })

  it('切换图片 / 视频类别算（模型与参数集会跟着换）', () => {
    expect(isRecipeEdit('setMode')).toBe(true)
  })

  it('换渠道算（但落库侧要求同时有模型，半份配方不记）', () => {
    expect(isRecipeEdit('setChannel')).toBe(true)
  })

  it('★ 内容类改动**不算**：提示词与素材不该继承给下一个节点', () => {
    for (const ev of ['setPrompt', 'toggleThumb', 'removeThumb', 'removeOwnAsset']) {
      expect(isRecipeEdit(ev), `${ev} 不该算配方改动`).toBe(false)
    }
  })

  it('★ 执行类事件不算（跑一次生成 / 取消，本身不改变参数）', () => {
    for (const ev of ['run', 'cancel', 'openSettings']) {
      expect(isRecipeEdit(ev), `${ev} 不该算配方改动`).toBe(false)
    }
  })
})
