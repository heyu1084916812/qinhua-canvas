import { describe, expect, it } from 'vitest'
import {
  buildShotsSystem,
  buildShotsText,
  ECOMMERCE_SHOTS_MARKER,
  parseShotsReply,
  SHOT_BRIEF_MAX,
  shouldExpandShots,
} from './chatShots'
import { buildEcommercePrompts } from './prompt'
import { ECOMMERCE_PLATFORMS } from './platforms'
import type { EcommerceRequest } from './types'

const requestOf = (over: Partial<EcommerceRequest> = {}): EcommerceRequest => ({
  usage: 'detail',
  platformId: 'amazon',
  language: 'en',
  count: 4,
  ratio: '3:4',
  productNodeId: 'p1',
  referenceNodeIds: [],
  note: '突出防水材质，模特手持场景',
  ...over,
})

describe('shouldExpandShots：值不值得问模型', () => {
  it('★ 多张 + 非白底 + 用户真写了要求 ⇒ 问', () => {
    expect(shouldExpandShots(requestOf())).toBe(true)
    expect(shouldExpandShots(requestOf({ usage: 'set', count: 8 }))).toBe(true)
    expect(shouldExpandShots(requestOf({ usage: 'main', count: 3 }))).toBe(true)
  })

  it('★★ 三条缺一不可：单张不问 / 白底不问 / 没写要求不问', () => {
    expect(shouldExpandShots(requestOf({ count: 1 }))).toBe(false)
    expect(shouldExpandShots(requestOf({ usage: 'white-bg', count: 6 }))).toBe(false)
    expect(shouldExpandShots(requestOf({ note: '' }))).toBe(false)
    /* 只有空白字符也算没写 —— 否则会为一句空格多花一次对话额度 */
    expect(shouldExpandShots(requestOf({ note: '   ' }))).toBe(false)
  })
})

describe('parseShotsReply：条数必须严格对得上', () => {
  it('★ 正常四条第 1 条 title 为空时用「第 N 张」补上（brief 是实质）', () => {
    const out = parseShotsReply(
      JSON.stringify({
        shots: [
          { title: '', brief: '正面全身，突出防水涂层' },
          { title: '手持场景', brief: '模特手持，浴室环境' },
          { title: '细节', brief: '贴拍杯口与密封圈' },
          { title: '对比', brief: '与旧款并置说明密封差别' },
        ],
      }),
      4,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.shots.map((s) => s.title)).toEqual(['第 1 张', '手持场景', '细节', '对比'])
    expect(out.shots[0]!.brief).toBe('正面全身，突出防水涂层')
  })

  it('代码块包住也认；裸数组也认', () => {
    const wrapped = parseShotsReply(
      '好，我排好了：\n```json\n{"shots":[{"title":"A","brief":"一"},{"title":"B","brief":"二"}]}\n```',
      2,
    )
    expect(wrapped.ok).toBe(true)
    expect(parseShotsReply('[{"title":"A","brief":"一"}]', 1).ok).toBe(true)
  })

  it('★★ 少一条 / 多一条：整批回落，且错误里写清"要几条、回了几条"', () => {
    const short = parseShotsReply(
      JSON.stringify({ shots: [{ title: 'A', brief: '一' }, { title: 'B', brief: '二' }] }),
      4,
    )
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.error).toContain('要 4 条，模型回了 2 条')

    const long = parseShotsReply(
      JSON.stringify({
        shots: [
          { title: 'A', brief: '一' },
          { title: 'B', brief: '二' },
        ],
      }),
      1,
    )
    expect(long.ok).toBe(false)
  })

  it('★★ 某一条没写 brief ⇒ 整批回落（不许拿 title 顶上，也不许留个空壳）', () => {
    const out = parseShotsReply(
      JSON.stringify({
        shots: [
          { title: 'A', brief: '一' },
          { title: 'B', brief: '   ' },
        ],
      }),
      2,
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('第 2 条')
  })

  it('不是 JSON / 结构不对 ⇒ 失败，且两句话说的不是同一件事', () => {
    const notJson = parseShotsReply('我帮你排好了（这一段故意不是 JSON）。', 3)
    expect(notJson.ok).toBe(false)
    if (!notJson.ok) expect(notJson.error).toContain('不是 {"shots":[…]}')

    const wrongShape = parseShotsReply(JSON.stringify({ shots: '不是数组' }), 3)
    expect(wrongShape.ok).toBe(false)
  })

  it('超长的 title / brief 截断到上限（提示词别被一条长句撑爆）', () => {
    const out = parseShotsReply(
      JSON.stringify({
        shots: [{ title: '甲'.repeat(80), brief: '乙'.repeat(SHOT_BRIEF_MAX + 120) }],
      }),
      1,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.shots[0]!.brief).toHaveLength(SHOT_BRIEF_MAX)
  })
})

describe('提示词与逐张拼装', () => {
  it('用户消息里带着那句话、张数、平台规则与默认脚本（模型是"改"结构而不是从零编）', () => {
    const text = buildShotsText(requestOf(), ECOMMERCE_PLATFORMS)
    expect(text).toContain('用户的要求：突出防水材质，模特手持场景')
    expect(text).toContain('要求张数：4')
    expect(text).toContain('比例：3:4')
    expect(text).toContain('Amazon')
    expect(text).toContain('默认镜头脚本')
    /* 默认脚本的条目也要在（第 1 条对应第 1 张） */
    expect(text).toContain('- 首图：全貌 + 卖点主张')
  })

  it('系统指令带识别标记、"条数必须等于张数"与"不许编造"', () => {
    const system = buildShotsSystem()
    expect(system).toContain(ECOMMERCE_SHOTS_MARKER)
    expect(system).toContain('条数必须等于要求的张数')
    expect(system).toContain('不许编造材质、参数、认证、功效与价格')
  })

  it('★★ 传了分镜就逐张用它 —— 第 i 张的提示词里是第 i 条 brief', () => {
    const prompts = buildEcommercePrompts(requestOf({ count: 2 }), {
      platforms: ECOMMERCE_PLATFORMS,
      shots: [
        { title: '镜一', brief: '正面全身，突出防水涂层' },
        { title: '镜二', brief: '模特手持，浴室环境' },
      ],
    })
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('这一张只做：镜一 —— 正面全身，突出防水涂层')
    expect(prompts[1]).toContain('这一张只做：镜二 —— 模特手持，浴室环境')
    /* 逐张不同是真的不同，不是同一个意思换个词 */
    expect(prompts[0]).not.toBe(prompts[1])
  })

  it('★★ 分镜条数与张数对不上 ⇒ 直接抛错（不许悄悄补齐或截断）', () => {
    expect(() =>
      buildEcommercePrompts(requestOf({ count: 4 }), {
        platforms: ECOMMERCE_PLATFORMS,
        shots: [{ title: '只有一条', brief: 'x' }],
      }),
    ).toThrow(/对不上/)
  })
})
