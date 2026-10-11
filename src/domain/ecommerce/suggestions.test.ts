import { describe, expect, it } from 'vitest'
import { buildSuggestions } from './suggestions'
import { planSummaryOf } from './sessions'

/**
 * 电商「为您推荐」+ 方案缩略说明（对账 #434）。
 *
 * 这两件都是**确定性**的（不调模型、不看历史）：推荐句跟着表单里选的平台 / 语言走，
 * 缩略说明与确认卡**同源**。所以断言的都是"给定输入必得这个字符串"。
 */
describe('电商为您推荐', () => {
  it('★ 三条起手式：主图 1 / 详情页 4 / 套图 6，平台名与语言跟着参数走', () => {
    const list = buildSuggestions({ platformId: 'amazon', language: 'en' })
    expect(list.map((s) => s.usage)).toEqual(['main', 'detail', 'set'])
    expect(list.map((s) => s.label)).toEqual(['主图 · 1 张', '详情页 · 4 张', '套图 · 6 张'])
    /* 语言用 `languageLabel` 那一份（`English` 而不是另写一个"英文"）——
       与确认卡上的「文案语言」同源，不许出现第二张语言标签表 */
    expect(list[1]!.text).toBe('给我做一套 Amazon English详情页，4 张')
  })

  it('★★ 换平台 / 换语言就换句子（用户改表单，推荐当场跟着改）', () => {
    const list = buildSuggestions({ platformId: 'temu', language: 'ru' })
    expect(list[0]!.text).toBe('给我做一套 Temu Русский主图，1 张')
  })

  it('★★ 平台拿不到名字时不写它、也不留双空格（双空格会一路带进提示词）', () => {
    const nameless = buildSuggestions({ platformId: '', language: 'zh-CN' })
    expect(nameless[0]!.text).toBe('给我做一套 中文简体主图，1 张')
    expect(nameless[0]!.text).not.toContain('  ')
    /* 清单里没有的 id：用 id 本身（不编一个好听的平台名） */
    const unknown = buildSuggestions({ platformId: 'my-shop', language: 'en' })
    expect(unknown[0]!.text).toBe('给我做一套 my-shop English主图，1 张')
  })
})

describe('方案缩略说明', () => {
  it('★★ 只写确定性事实（用途 · 平台 · 张数），**不写补充要求**（它可能很长，列表要一眼扫过去）', () => {
    const summary = planSummaryOf({
      usage: 'detail',
      platformId: 'amazon',
      language: 'en',
      count: 4,
      ratio: '3:4',
      note: '突出防水材质，还要出现模特手持场景，画面里不要出现文字',
    })
    expect(summary).toBe('详情页 · Amazon · 4 张')
    expect(summary).not.toContain('防水')
  })

  it('★ 只有一句补充要求时缩略说明是空串（那一行只显示标题，不摆一行空的）', () => {
    expect(planSummaryOf({ note: '随便来一张' })).toBe('')
  })
})
