import { describe, expect, it } from 'vitest'
import {
  BREAKDOWN_MARKER,
  MAX_SHOT_DRAFTS,
  breakdownGuard,
  breakdownText,
  buildBreakdownResult,
  buildBreakdownSystem,
  extractJsonBlock,
  parseBreakdownReply,
  replaceEpisodeShots,
  resolveChatTarget,
  shotsFromDraft,
} from './breakdown'
import { emptyStoryboard, addEpisode, addShot, shotsOf } from './storyboard'
import type { Channel } from '../project/channel'
import type { ModelCapability } from '../shared/capability'

const cap = (id: string, category: ModelCapability['category']): ModelCapability => ({
  id,
  category,
  inputTypes: ['text'],
})

function ch(patch: Partial<Channel> & { id: string }): Channel {
  return {
    name: patch.id,
    icon: null,
    protocol: 'mock',
    baseUrl: '',
    credentialRef: null,
    tokenTail: null,
    altCredentialRef: null,
    altTokenTail: null,
    enabled: true,
    models: [],
    modelCache: [],
    modelMap: {},
    priority: 0,
    weight: 1,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  } as Channel
}

describe('resolveChatTarget', () => {
  it('取第一条「已启用 + 有对话模型」的渠道（列表顺序就是优先顺序）', () => {
    const target = resolveChatTarget([
      ch({ id: 'a', models: [cap('img-1', 'image')] }),
      ch({ id: 'b', models: [cap('chat-1', 'chat'), cap('chat-2', 'chat')] }),
      ch({ id: 'c', models: [cap('chat-9', 'chat')] }),
    ])
    expect(target).toEqual({ channelId: 'b', model: 'chat-1', label: 'b · chat-1' })
  })

  it('未启用的渠道不参与（用户关掉的渠道不该被拿去发请求）', () => {
    const target = resolveChatTarget([
      ch({ id: 'off', enabled: false, models: [cap('chat-1', 'chat')] }),
      ch({ id: 'on', models: [cap('chat-2', 'chat')] }),
    ])
    expect(target?.channelId).toBe('on')
  })

  it('只有生图模型 / 一个都没有 → null（不拿预设名兜底）', () => {
    expect(resolveChatTarget([ch({ id: 'a', models: [cap('img-1', 'image')] })])).toBeNull()
    expect(resolveChatTarget([ch({ id: 'a' })])).toBeNull()
    expect(resolveChatTarget([])).toBeNull()
  })

  it('标签用前端显示名（裸 ID 不进界面，对账 #371 同一口径）', () => {
    /* 真实形态：渠道行上存的是**上游 ID**，显示名在 modelMap 里（'显示名 → 上游 ID'） */
    const target = resolveChatTarget([
      ch({
        id: 'mock',
        models: [cap('mock-chat-1', 'chat')],
        modelMap: { 'GPT-6 Astra': 'mock-chat-1' },
      }),
    ])
    expect(target?.model).toBe('mock-chat-1')
    expect(target?.label).toContain('GPT-6 Astra')
  })
})

describe('buildBreakdownSystem', () => {
  it('技能正文在前、契约在后，契约里带识别标记', () => {
    const system = buildBreakdownSystem('你是一名短片分镜导演。')
    expect(system.startsWith('你是一名短片分镜导演。')).toBe(true)
    expect(system).toContain(BREAKDOWN_MARKER)
    expect(system).toContain('"shots"')
    expect(system.indexOf('"shots"')).toBeGreaterThan(system.indexOf('你是一名短片分镜导演。'))
  })

  it('技能缺失（没加载出来）也要有可用的系统指令', () => {
    const system = buildBreakdownSystem(undefined)
    expect(system).toContain('分镜导演')
    expect(system).toContain(BREAKDOWN_MARKER)
  })
})

describe('breakdownGuard / breakdownText', () => {
  it('没内容可拆时给出可行动的理由', () => {
    const doc = emptyStoryboard('p1')
    const withEp = addEpisode(doc, 1)
    expect(breakdownGuard(withEp, null)).toMatch(/先加一集/)
    expect(breakdownGuard(withEp, withEp.episodes[0]!)).toMatch(/还没有内容可拆/)
  })

  it('有梗概（没正文）也能拆', () => {
    const doc = emptyStoryboard('p1')
    const ep = { id: 'ep1', title: '第一集', summary: '雨夜送最后一单' }
    expect(breakdownGuard(doc, ep)).toBeNull()
    expect(breakdownText(doc, ep)).toContain('本集梗概：雨夜送最后一单')
    expect(breakdownText(doc, ep)).toContain('这一集：第一集')
  })

  it('正文进用户消息（模型只看得到这一集）', () => {
    const doc = { ...emptyStoryboard('p1'), script: { title: 'x', logline: '', body: '雨。十五楼。' } }
    const text = breakdownText(doc, { id: 'ep1', title: '第一集', summary: '' })
    expect(text).toContain('剧本：\n雨。十五楼。')
  })
})

describe('extractJsonBlock / parseBreakdownReply', () => {
  it('裸 JSON / 代码块 / 前后夹解释都能挖出来', () => {
    const body = '{"shots":[{"scene":"雨夜的街道"}]}'
    expect(extractJsonBlock(body)).toEqual({ shots: [{ scene: '雨夜的街道' }] })
    expect(extractJsonBlock('好的，这是分镜：\n```json\n' + body + '\n```\n希望有用')).toEqual({
      shots: [{ scene: '雨夜的街道' }],
    })
    expect(extractJsonBlock('说明\n' + body)).toEqual({ shots: [{ scene: '雨夜的街道' }] })
  })

  it('scene 里带 } 或引号也不会把 JSON 切坏', () => {
    const raw = '{"shots":[{"scene":"门牌写着 {1502}","dialogue":"他说\\"到了\\""}]}'
    const parsed = parseBreakdownReply(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.shots[0]).toMatchObject({ scene: '门牌写着 {1502}', dialogue: '他说"到了"' })
  })

  it('裸数组也认（有些渠道会去掉外层对象）', () => {
    const parsed = parseBreakdownReply('[{"scene":"一镜"}]')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.shots).toHaveLength(1)
  })

  it('不是 JSON / 没有 shots / 全都没画面 → 三种失败，各自说清楚', () => {
    const a = parseBreakdownReply('好的，我帮你拆好了')
    const b = parseBreakdownReply('{"list":[]}')
    const c = parseBreakdownReply('{"shots":[{"dialogue":"只有台词"}]}')
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    expect(c.ok).toBe(false)
    if (!a.ok) expect(a.error).toMatch(/JSON/)
    if (!b.ok) expect(b.error).toMatch(/shots/)
    if (!c.ok) expect(c.error).toMatch(/没有可用/)
  })

  it('空回复如实报错（不是"成功但没有镜头"）', () => {
    const parsed = parseBreakdownReply('   ')
    expect(parsed.ok).toBe(false)
  })

  it('单条坏镜头只丢那一条；时长被夹进 1-15 且取整', () => {
    const parsed = parseBreakdownReply(
      JSON.stringify({
        shots: [
          { scene: ' 一 ', durationSec: 0 },
          { dialogue: '没有画面', durationSec: 5 },
          { scene: '二', durationSec: 99.6 },
          { scene: '三', durationSec: '4.4' },
        ],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.shots.map((s) => s.scene)).toEqual(['一', '二', '三'])
    expect(parsed.shots.map((s) => s.durationSec)).toEqual([1, 15, 4])
  })

  it('缺省字段有确定值（时长走默认、台词与提示词为空串）', () => {
    const parsed = parseBreakdownReply('{"shots":[{"scene":"一镜"}]}')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.shots[0]).toEqual({ scene: '一镜', dialogue: '', durationSec: 3, prompt: '' })
  })

  it('超过上限只收前 N 条（一次误回复不能把项目塞爆）', () => {
    const many = Array.from({ length: MAX_SHOT_DRAFTS + 5 }, (_, i) => ({ scene: `镜 ${i}` }))
    const parsed = parseBreakdownReply(JSON.stringify({ shots: many }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.shots).toHaveLength(MAX_SHOT_DRAFTS)
  })

  it('★ 资产也跟着回：characters / scenes 的 name / aliases / description 都读得到', () => {
    const parsed = parseBreakdownReply(
      JSON.stringify({
        characters: [
          { name: '林轩', aliases: ['林公子', '林轩', '  '], description: '二十岁骑手' },
          { name: '', aliases: ['没人'] },
          'bad',
        ],
        scenes: [{ name: '雨夜街道' }],
        shots: [{ scene: '一镜' }],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.characters).toEqual([
      { name: '林轩', aliases: ['林公子'], description: '二十岁骑手' },
    ])
    expect(parsed.scenes).toEqual([{ name: '雨夜街道' }])
  })

  it('★ 镜头上的名字数组容错：去重、丢掉空串与非字符串；老键名也认', () => {
    const parsed = parseBreakdownReply(
      JSON.stringify({
        shots: [
          { scene: '一镜', characterNames: ['林轩', '林轩', '', 42], locationNames: ['雨夜街道'] },
          /* 老写法：characters / locations —— 只回 shots 的模型不该因为键名不同就丢绑定 */
          { scene: '二镜', characters: ['王叔'], locations: ['十五楼'] },
        ],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.shots[0]!.characterNames).toEqual(['林轩'])
    expect(parsed.shots[0]!.locationNames).toEqual(['雨夜街道'])
    expect(parsed.shots[1]!.characterNames).toEqual(['王叔'])
    expect(parsed.shots[1]!.locationNames).toEqual(['十五楼'])
  })

  it('只回 shots（没有资产清单）照样能用：资产库这一轮就空着', () => {
    const parsed = parseBreakdownReply('{"shots":[{"scene":"一镜"}]}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.characters).toEqual([])
      expect(parsed.scenes).toEqual([])
    }
  })
})

describe('shotsFromDraft / replaceEpisodeShots', () => {
  it('补 id 与 episodeId（每镜一个独立 id）', () => {
    const shots = shotsFromDraft([{ scene: 'a', dialogue: '', durationSec: 3, prompt: '' }], 'ep1')
    expect(shots[0]!.episodeId).toBe('ep1')
    expect(shots[0]!.id).toMatch(/^shot_/)
  })

  it('只换这一集：别的集的镜头与顺序都不动，updatedAt 更新', () => {
    let doc = emptyStoryboard('p1', 1)
    doc = addEpisode(doc, 1)
    doc = addEpisode(doc, 1)
    const [ep1, ep2] = doc.episodes
    doc = addShot(doc, ep1!.id, 1)
    doc = addShot(doc, ep2!.id, 1)
    const next = replaceEpisodeShots(doc, ep1!.id, shotsFromDraft([{ scene: '新一镜', dialogue: '', durationSec: 3, prompt: '' }], ep1!.id), 9)
    expect(shotsOf(next, ep1!.id).map((s) => s.scene)).toEqual(['新一镜'])
    expect(shotsOf(next, ep2!.id)).toHaveLength(1)
    expect(next.updatedAt).toBe(9)
  })

  it('空数组 = 清掉这一集的镜头（其余照旧）', () => {
    let doc = emptyStoryboard('p1')
    doc = addEpisode(doc, 1)
    const ep1 = doc.episodes[0]!
    doc = addShot(doc, ep1.id, 1)
    const next = replaceEpisodeShots(doc, ep1.id, [], 2)
    expect(shotsOf(next, ep1.id)).toHaveLength(0)
  })

  it('★★ 带资产库时把名字翻成 id：一镜一个场景（取第一个地点）+ 去重后的角色', () => {
    const characters = [{ id: 'c1', name: '林轩', description: '', aliases: ['林公子'] }]
    const scenes = [{ id: 's1', name: '雨夜街道', description: '', aliases: [] }]
    const shots = shotsFromDraft(
      [
        {
          scene: '一镜',
          dialogue: '',
          durationSec: 3,
          prompt: '',
          characterNames: ['林公子', '林轩', '路人甲'],
          locationNames: ['雨夜街道', '十五楼'],
        },
      ],
      'ep1',
      { characters, scenes },
    )
    expect(shots[0]!.sceneId).toBe('s1')
    /* 别名命中的是同一个 id，去重后只剩一个；认不出来的「路人甲」不硬编 id */
    expect(shots[0]!.characterIds).toEqual(['c1'])
  })
})

describe('buildBreakdownResult（拆镜 + 资产提取一次做完）', () => {
  it('★★ 资产并进文档（已有只增不减），镜头按别名绑定到 id', () => {
    let base = emptyStoryboard('p1', 1)
    base = addEpisode(base, 1)
    base = { ...base, characters: [{ id: 'c1', name: '林轩', description: '用户确认过的', aliases: [] }] }
    const { doc, shots } = buildBreakdownResult(base, base.episodes[0]!.id, {
      shots: [
        {
          scene: '雨夜的街道',
          dialogue: '',
          durationSec: 4,
          prompt: '',
          characterNames: ['林公子'],
          locationNames: ['雨夜街道'],
        },
      ],
      characters: [
        { name: '林轩', aliases: ['林公子'], description: '模型写的' },
        { name: '王叔', description: '楼下保安' },
      ],
      scenes: [{ name: '雨夜街道', description: '霓虹、积水' }],
    })
    expect(doc.characters.map((c) => c.name)).toEqual(['林轩', '王叔'])
    expect(doc.characters[0]!.description).toBe('用户确认过的')
    expect(doc.characters[0]!.aliases).toEqual(['林公子'])
    expect(doc.scenes.map((s) => s.name)).toEqual(['雨夜街道'])
    expect(shots[0]!.characterIds).toEqual(['c1'])
    expect(shots[0]!.sceneId).toBe(doc.scenes[0]!.id)
  })
})
