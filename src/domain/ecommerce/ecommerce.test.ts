import { describe, expect, it } from 'vitest'
import { ECOMMERCE_PLATFORMS, GENERIC_SOURCE, platformById, platformRuleSummary } from './platforms'
import {
  ECOMMERCE_HARD_RULES,
  ECOMMERCE_NOTE_MAX,
  buildEcommercePrompt,
  updateEcommerceShot,
} from './prompt'
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

/**
 * 逐张镜头脚本（对账 #405，用户 2026-10-10 #10：
 * 「套图和详情页…每张图片都需要不一样，现在好像是出的图片的提示词都是一致的」）。
 *
 * 判据全部落在**提示词本身**上（纯函数，能穷举）：
 * 主图 / 详情页 / 套图逐张不同，白底图保持抽卡（N 条相同）。
 */
describe('逐张镜头脚本', () => {
  /** 从提示词里取出「这一张只做：<标题>」的标题 */
  const shotTitleOf = (text: string): string =>
    (text.match(/这一张只做：([^—]+)/) ?? [])[1]?.trim() ?? ''

  it('★★ 套图 8 张 = 8 条互不相同的提示词，且每条都带镜头标题与硬约束', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'set', count: 8 })
    expect(plan.prompts).toHaveLength(8)
    expect(new Set(plan.prompts).size).toBe(8)
    for (const p of plan.prompts) {
      expect(p).toContain('这一张只做：')
      for (const rule of ECOMMERCE_HARD_RULES) expect(p).toContain(rule)
    }
    expect(plan.prompts.map(shotTitleOf)).toEqual([
      '白底主图',
      '氛围主图',
      '45° 侧视',
      '细节特写',
      '卖点图',
      '包装展示',
      '尺寸示意',
      '组合搭配',
    ])
  })

  it('★★ 详情页 4 张按脚本走：全貌 / 材质 / 场景 / 尺寸', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'detail', count: 4 })
    expect(plan.prompts.map(shotTitleOf)).toEqual([
      '首图：全貌 + 卖点主张',
      '材质与工艺',
      '使用场景',
      '尺寸与规格',
    ])
    expect(new Set(plan.prompts).size).toBe(4)
  })

  it('★★ 白底图是**抽卡**：N 张的提示词完全相同（用户明确说这样没问题）', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'white-bg', count: 3 })
    expect(plan.prompts).toHaveLength(3)
    expect(new Set(plan.prompts).size).toBe(1)
    expect(plan.prompts[0]).toContain('纯白背景')
    // 抽卡不该带"每张都不一样"那句 —— 那会把用户想要的多试几次变成"必须换构图"
    expect(plan.prompts[0]).not.toContain('每张的镜头都不一样')
  })

  it('★★ 多张时提示词里明确"每张的镜头都不一样"（修的就是"同一张画 N 遍"）', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'detail', count: 4 })
    for (const p of plan.prompts) expect(p).toContain('每张的镜头都不一样')
  })

  it('★ 张数超过脚本长度也不重复：第 9 张起给"换构图"的通用项', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'set', count: 10 })
    expect(plan.prompts).toHaveLength(10)
    expect(new Set(plan.prompts).size).toBe(10)
    expect(plan.prompts[9]).toContain('不重复')
  })

  it('★ 单张主图仍是「正面全身」，且 plan.prompt 与 prompts[0] 同值', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'main', count: 1 })
    expect(plan.prompts).toHaveLength(1)
    expect(plan.prompts[0]).toContain('正面全身')
    expect(plan.prompt).toBe(plan.prompts[0])
    // 单张不该出现"同批"那句（它只在多张时有意义）
    expect(plan.prompts[0]).not.toContain('同批：')
  })
})

/**
 * 逐行改方案（对账 #514）：方案是草稿，用户确认的应该是**改过的**那份。
 */
describe('逐行改方案', () => {
  const shots = [
    { title: '正面全身', brief: '产品正对镜头' },
    { title: '细节特写', brief: '贴近拍材质' },
  ] as const

  it('★★ 改一行只动那一行，其余行保持原引用', () => {
    const next = updateEcommerceShot(shots, 1, { brief: '改成俯拍接口处' })
    expect(next).not.toBe(shots)
    expect(next[0]).toBe(shots[0])
    expect(next[1]).toEqual({ title: '细节特写', brief: '改成俯拍接口处' })
  })

  it('★ 只改标题、只改要点都成立，另一项原样保留', () => {
    const onlyTitle = updateEcommerceShot(shots, 0, { title: '正面平视' })
    expect(onlyTitle[0]).toEqual({ title: '正面平视', brief: '产品正对镜头' })
    const onlyBrief = updateEcommerceShot(shots, 0, { brief: '改成白底平视' })
    expect(onlyBrief[0]).toEqual({ title: '正面全身', brief: '改成白底平视' })
  })

  it('★ 越界 / 空 patch / 同值都返回原引用（不触发无谓重渲染）', () => {
    expect(updateEcommerceShot(shots, 9, { title: 'x' })).toBe(shots)
    expect(updateEcommerceShot(shots, -1, { title: 'x' })).toBe(shots)
    expect(updateEcommerceShot(shots, 0, {})).toBe(shots)
    expect(updateEcommerceShot(shots, 0, { title: '正面全身' })).toBe(shots)
  })

  it('★ 允许清空（"空行"由生成前的界面校验拦截，数据层不替用户改）', () => {
    const next = updateEcommerceShot(shots, 0, { title: '', brief: '' })
    expect(next[0]).toEqual({ title: '', brief: '' })
  })
})
