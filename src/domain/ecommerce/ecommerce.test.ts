import { describe, expect, it } from 'vitest'
import { ECOMMERCE_PLATFORMS, GENERIC_SOURCE, platformById, platformRuleSummary } from './platforms'
import { ECOMMERCE_HARD_RULES, ECOMMERCE_NOTE_MAX, buildEcommercePrompt } from './prompt'
import {
  ECOMMERCE_DEFAULT_COUNT,
  EcommerceRequestError,
  buildEcommercePlan,
} from './plan'
import { ECOMMERCE_COUNT_MAX, type EcommerceRequest } from './types'

/**
 * 电商 A 版的领域层（对账 #384 / #380a）。
 *
 * 这里的判据全是**纯函数可穷举**的那几条：平台数据自洽、提示词该有的都在、
 * 非法输入当场抛错（不静默兜底）。
 */
const base: EcommerceRequest = {
  usage: 'main',
  platformId: 'amazon',
  language: 'en',
  count: 1,
  ratio: '1:1',
  productNodeId: 'node-product',
  referenceNodeIds: [],
}

describe('电商平台规则库', () => {
  it('首批 6 个平台，id 唯一、名字不重复', () => {
    expect(ECOMMERCE_PLATFORMS).toHaveLength(6)
    expect(new Set(ECOMMERCE_PLATFORMS.map((p) => p.id)).size).toBe(6)
    expect(new Set(ECOMMERCE_PLATFORMS.map((p) => p.name)).size).toBe(6)
  })

  it('★ 每条都带更新日期与来源 —— 未核实就如实写「通用建议」', () => {
    for (const p of ECOMMERCE_PLATFORMS) {
      expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(p.sourceNote.length).toBeGreaterThan(0)
      expect(p.rules.length).toBeGreaterThan(10)
      expect(p.ratios.length).toBeGreaterThan(0)
    }
    expect(ECOMMERCE_PLATFORMS.every((p) => p.sourceNote === GENERIC_SOURCE)).toBe(true)
  })

  it('★★ 不许出现「符合平台审核」这类假承诺（本轮六条都未核实）', () => {
    /*
     * 禁的是**承诺式说法**，不是"官方规则"这四个字本身 ——
     * sourceNote 里那句"未核实官方规则"正是诚实的免责声明，不能被误伤。
     */
    const banned = ['符合平台', '符合审核', '通过审核', '保证通过', '官方规则要求', '官方标准']
    for (const p of ECOMMERCE_PLATFORMS) {
      const text = `${p.rules}${p.sourceNote}`
      for (const phrase of banned) expect(text.includes(phrase)).toBe(false)
    }
  })

  it('platformById：找不到给 null（白底图不选平台是合法输入）', () => {
    expect(platformById('amazon')?.name).toBe('Amazon')
    expect(platformById('nope')).toBeNull()
    expect(platformById(undefined)).toBeNull()
    expect(platformRuleSummary(null)).toContain('未指定平台')
  })
})

describe('提示词拼装', () => {
  it('★ 六段都在：note / 用途 / 平台（含来源与日期）/ 语言 / 张数比例 / 硬约束', () => {
    const text = buildEcommercePrompt({ ...base, note: '突出防水材质' })
    expect(text.split('\n')[0]).toBe('突出防水材质')
    expect(text).toContain('用途：主图')
    expect(text).toContain('目标平台：Amazon')
    expect(text).toContain('通用建议')
    expect(text).toContain('2026-10-09')
    expect(text).toContain('文案语言：English')
    expect(text).toContain('输出：1 张，比例 1:1')
    for (const rule of ECOMMERCE_HARD_RULES) expect(text).toContain(rule)
  })

  it('★ 没选平台时如实写「未指定平台」，不编一个平台名', () => {
    const text = buildEcommercePrompt({ ...base, platformId: undefined, usage: 'white-bg' })
    expect(text).toContain('未指定平台')
    expect(text).not.toContain('Amazon')
  })

  it('note 超长自动截断（表单之外的长文应当写进提示词节点）', () => {
    const long = '甲'.repeat(ECOMMERCE_NOTE_MAX + 200)
    const text = buildEcommercePrompt({ ...base, note: long })
    const first = text.split('\n')[0]!
    expect(first).toHaveLength(ECOMMERCE_NOTE_MAX)
  })
})

describe('执行计划与校验', () => {
  it('默认张数：主图 1 / 白底 1 / 详情 4 / 套图 8', () => {
    expect(ECOMMERCE_DEFAULT_COUNT).toEqual({ main: 1, 'white-bg': 1, detail: 4, set: 8 })
  })

  it('★ 参考图去重，并去掉与产品图相同的那个', () => {
    const plan = buildEcommercePlan({
      ...base,
      productNodeId: 'p1',
      referenceNodeIds: ['r1', 'r1', 'p1', 'r2'],
    })
    expect(plan.referenceNodeIds).toEqual(['r1', 'r2'])
  })

  it('★★ 非法输入逐条抛错 —— 不静默兜底', () => {
    const cases: [string, EcommerceRequest][] = [
      ['空产品图', { ...base, productNodeId: '' }],
      ['张数 0', { ...base, count: 0 }],
      ['张数超上限', { ...base, count: ECOMMERCE_COUNT_MAX + 1 }],
      ['张数不是整数', { ...base, count: 1.5 }],
      ['比例不认识', { ...base, ratio: '2:3' }],
      ['平台不存在', { ...base, platformId: 'nope' }],
      ['语言不认识', { ...base, language: 'fr' as never }],
    ]
    for (const [label, request] of cases) {
      expect(() => buildEcommercePlan(request), label).toThrow(EcommerceRequestError)
    }
  })

  it('平台清单可以注入（测试 / 以后接扩展包都用同一份契约）', () => {
    const fake = [{ ...ECOMMERCE_PLATFORMS[0]!, id: 'fake', name: 'Fake' }]
    const plan = buildEcommercePlan({ ...base, platformId: 'fake' }, { platforms: fake })
    expect(plan.platform?.name).toBe('Fake')
    // 注入的清单里没有 amazon ⇒ 要如实报错，而不是悄悄回落内置清单
    expect(() => buildEcommercePlan(base, { platforms: fake })).toThrow(/平台清单里没有这条/)
  })
})
