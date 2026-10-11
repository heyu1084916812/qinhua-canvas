import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../shared/execution/types'
import {
  PLAN_HISTORY_LIMIT,
  PLAN_TITLE_MAX,
  draftFromMessages,
  planTitleOf,
  recentPlanSessions,
  toPlanMessages,
  toPlanSession,
  type EcommercePlanSession,
} from './sessions'

/**
 * 电商「历史方案」（对账 #433）。
 *
 * 这一层的价值在"读回来还能不能认出是一条方案"上，所以每条断言都对着一个会让人白点的情形：
 * 点了没反应（读不出草稿的行混进列表）、标题是一串空白、旧方案排到了新方案前面。
 */
describe('电商历史方案', () => {
  it('★ 标题：压平换行与多余空格、超长截断、空则「未命名方案」', () => {
    expect(planTitleOf('  给我做一套\n亚马逊   详情页  ')).toBe('给我做一套 亚马逊 详情页')
    const long = '阿'.repeat(50)
    const title = planTitleOf(long)
    expect(title.length).toBe(PLAN_TITLE_MAX + 1)
    expect(title.endsWith('…')).toBe(true)
    expect(planTitleOf('   ')).toBe('未命名方案')
    expect(planTitleOf('')).toBe('未命名方案')
  })

  it('★★★ 写进去再读回来是同一份草稿（消息 → JSON → 草稿）', () => {
    const draft = {
      usage: 'detail' as const,
      platformId: 'amazon',
      language: 'en' as const,
      count: 4,
      ratio: '3:4',
      note: '突出防水材质',
    }
    const messages = toPlanMessages('给我做一套亚马逊英文详情页，4 张', draft)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(draftFromMessages(messages)).toEqual(draft)
  })

  it('★★ 读回时只认白名单里的字段与合法取值（认不出的一个字都不猜）', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: JSON.stringify({
          usage: '不存在的用途',
          platformId: 'amazon',
          language: 'xx',
          count: -3,
          ratio: ' 3:4 ',
          note: '   ',
          乱入的键: '别信我',
        }),
      },
    ]
    expect(draftFromMessages(messages)).toEqual({ platformId: 'amazon', ratio: '3:4' })
  })

  it('★★ 一个字段都认不出来 ⇒ 不是方案（返回 null，不塞一条点了没反应的记录）', () => {
    expect(draftFromMessages([{ role: 'assistant', content: '好的，我来帮你做' }])).toBeNull()
    expect(draftFromMessages([{ role: 'assistant', content: '{}' }])).toBeNull()
    expect(draftFromMessages([])).toBeNull()
    /* 只有 user 消息（比如画布 agent 的普通对话）也没有草稿 */
    expect(draftFromMessages([{ role: 'user', content: '你好' }])).toBeNull()
  })

  it('★★ 同一个会话里有多次 assistant 消息时，取**最后一条**（那是这次解析的结果）', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: JSON.stringify({ usage: 'main' }) },
      { role: 'user', content: '改成详情页' },
      { role: 'assistant', content: JSON.stringify({ usage: 'detail', count: 4 }) },
    ]
    expect(draftFromMessages(messages)).toEqual({ usage: 'detail', count: 4 })
  })

  it('★★★ 会话行 → 列表条目：标题取行里的；读不出草稿的行**返回 null**（画布 agent 的会话就靠这条滤掉）', () => {
    const ok = toPlanSession({
      id: 's1',
      title: '亚马逊详情页',
      messages: toPlanMessages('给我做一套详情页', { usage: 'detail' }),
      createdAt: 10,
      updatedAt: 20,
    })
    expect(ok).toEqual({
      id: 's1',
      title: '亚马逊详情页',
      draft: { usage: 'detail' },
      createdAt: 10,
      updatedAt: 20,
    })

    /* 画布 agent 那种会话：有 id 有标题，正文却是普通问答 ⇒ 不进电商的历史列表 */
    expect(
      toPlanSession({
        id: 's2',
        title: '画布对话',
        messages: [{ role: 'assistant', content: '已经帮你建好节点了' }],
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toBeNull()
    expect(toPlanSession({ title: '没有 id', messages: [] })).toBeNull()
  })

  it('★ 行里没有标题时，用最后一条 user 消息兜底（空标题在列表里等于没有信息）', () => {
    const session = toPlanSession({
      id: 's3',
      messages: toPlanMessages('  给我做一套淘宝主图  ', { usage: 'main' }),
      createdAt: 5,
      updatedAt: 5,
    })
    expect(session?.title).toBe('给我做一套淘宝主图')
  })

  it('★★ 最近几条：新的在前、条数封顶、同一时刻顺序稳定', () => {
    const make = (id: string, updatedAt: number): EcommercePlanSession => ({
      id,
      title: id,
      draft: { usage: 'main' },
      createdAt: updatedAt,
      updatedAt,
    })
    const list = [make('a', 1), make('c', 3), make('b', 2), make('d', 4)]
    expect(recentPlanSessions(list).map((s) => s.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(recentPlanSessions(list, 2).map((s) => s.id)).toEqual(['d', 'c'])
    /* 同一时刻按 id 排：两次调用顺序一样（列表每渲染一次就换位置会让人点错） */
    const same = [make('b', 7), make('a', 7)]
    expect(recentPlanSessions(same).map((s) => s.id)).toEqual(['a', 'b'])
    expect(recentPlanSessions(list).length).toBeLessThanOrEqual(PLAN_HISTORY_LIMIT)
  })
})
