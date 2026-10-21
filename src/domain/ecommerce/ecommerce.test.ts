import { describe, expect, it } from 'vitest'
import {
  ECOMMERCE_PLATFORM_ORDER,
  ECOMMERCE_PLATFORMS,
  GENERIC_SOURCE,
  platformById,
  platformRuleSummary,
} from './platforms'
import {
  ECOMMERCE_NOTE_MAX,
  buildEcommercePrompt,
  updateEcommerceShot,
} from './prompt'
import {
  ECOMMERCE_DEFAULT_COUNT,
  EcommerceRequestError,
  buildEcommercePlan,
} from './plan'
import {
  ECOMMERCE_COUNT_MAX,
  ECOMMERCE_FORM_USAGES,
  ECOMMERCE_USAGES,
  ecommerceAspectRatio,
  ecommerceLanguageOptions,
  ecommerceRatioOptions,
  type EcommerceRequest,
} from './types'

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
  it('平台目录覆盖参考图 19 个平台，id 唯一、名字不重复', () => {
    expect(ECOMMERCE_PLATFORMS).toHaveLength(19)
    expect(new Set(ECOMMERCE_PLATFORMS.map((p) => p.id)).size).toBe(19)
    expect(new Set(ECOMMERCE_PLATFORMS.map((p) => p.name)).size).toBe(19)
    expect(ECOMMERCE_PLATFORM_ORDER).toHaveLength(19)
    expect(ECOMMERCE_PLATFORM_ORDER.every((id) => ECOMMERCE_PLATFORMS.some((p) => p.id === id))).toBe(
      true,
    )
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
    expect(platformById('amazon')?.name).toBe('亚马逊')
    expect(platformById('nope')).toBeNull()
    expect(platformById(undefined)).toBeNull()
    expect(platformRuleSummary(null)).toContain('未指定平台')
  })
})

describe('工具独立选项', () => {
  it('商品套图与爆款复刻使用各自的语言集合和顺序', () => {
    expect(ecommerceLanguageOptions('set').map((item) => item.label)).toEqual([
      '英文',
      '中文',
      '日文',
      '韩文',
      '西班牙文',
      '俄语',
      '泰语',
      '马来语',
    ])
    expect(ecommerceLanguageOptions('recreate').map((item) => item.label)).toEqual([
      '英文',
      '中文',
      '日文',
      '韩文',
      '俄语',
      '德语',
      '法语',
      '西班牙语',
      '葡萄牙语',
      '泰语',
      '马来语',
    ])
  })

  it('A+ 详情页提供版面类型，并映射成真实生成宽高比', () => {
    expect(ecommerceRatioOptions('detail')).toEqual([
      { value: 'aplus-premium-web', label: '高级A+（Web端）' },
      { value: 'aplus-premium-mobile', label: '高级A+（移动端）' },
      { value: 'aplus-standard', label: '普通A+' },
      { value: '1:1', label: '1:1' },
      { value: '4:3', label: '4:3' },
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
    ])
    expect(ecommerceAspectRatio('aplus-premium-web')).toBe('16:9')
    expect(ecommerceAspectRatio('aplus-premium-mobile')).toBe('9:16')
    expect(ecommerceAspectRatio('aplus-standard')).toBe('4:3')
    expect(ecommerceAspectRatio('3:4')).toBe('3:4')
  })

  it('A+ 版面进入提示词时写人话，执行计划保留用户原选择', () => {
    const plan = buildEcommercePlan({
      ...base,
      usage: 'detail',
      count: 4,
      ratio: 'aplus-premium-web',
    })
    expect(plan.ratio).toBe('aplus-premium-web')
    expect(plan.prompt).toContain('高级A+（Web端）')
  })
})

describe('提示词拼装', () => {
  it('★ 输出可直接执行的画面描述，不夹带策划字段', () => {
    const text = buildEcommercePrompt({ ...base, note: '突出防水材质' })
    expect(text.split('\n')[0]).toBe('突出防水材质')
    expect(text).toContain('专业电商商品摄影')
    expect(text).toContain('亚马逊常见商品图做法')
    expect(text).toContain('English')
    expect(text).toContain('1:1 画幅')
    expect(text).toContain('严格参照输入商品图')
    expect(text).not.toContain('套图结构：')
    expect(text).not.toContain('目标平台：')
    expect(text).not.toContain('输出：1 张')
  })

  it('★ 没选平台时用通用商品图要求，不编一个平台名', () => {
    const text = buildEcommercePrompt({ ...base, platformId: undefined, usage: 'white-bg' })
    expect(text).toContain('通用电商商品图要求')
    expect(text).not.toContain('亚马逊')
  })

  it('note 超长自动截断（表单之外的长文应当写进提示词节点）', () => {
    const long = '甲'.repeat(ECOMMERCE_NOTE_MAX + 200)
    const text = buildEcommercePrompt({ ...base, note: long })
    const first = text.split('\n')[0]!
    expect(first).toHaveLength(ECOMMERCE_NOTE_MAX)
  })
})

describe('执行计划与校验', () => {
  it('表单只给五个用途；edit 只作为结果图的后续动作存在', () => {
    expect(ECOMMERCE_FORM_USAGES).toEqual(['main', 'white-bg', 'detail', 'set', 'recreate'])
    expect(ECOMMERCE_USAGES).toContain('edit')
    expect(ECOMMERCE_FORM_USAGES).not.toContain('edit')
  })

  it('默认张数：主图 1 / 白底 1 / 详情 4 / 套图 8 / 爆款复刻 4', () => {
    expect(ECOMMERCE_DEFAULT_COUNT).toEqual({
      main: 1,
      'white-bg': 1,
      detail: 4,
      set: 8,
      recreate: 4,
      edit: 1,
    })
  })

  it('★ 参考图去重，并去掉与产品图相同的那个', () => {
    const plan = buildEcommercePlan({
      ...base,
      productNodeId: 'p1',
      referenceNodeIds: ['r1', 'r1', 'p1', 'r2'],
    })
    expect(plan.referenceNodeIds).toEqual(['r1', 'r2'])
  })

  it('★★ 多张产品图全部保留，并从参考图里全部排除', () => {
    const plan = buildEcommercePlan({
      ...base,
      productNodeId: 'p1',
      productNodeIds: ['p1', 'p2', 'p2', 'p3'],
      referenceNodeIds: ['p2', 'p3', 'r1'],
    })
    expect(plan.productNodeIds).toEqual(['p1', 'p2', 'p3'])
    expect(plan.referenceNodeIds).toEqual(['r1'])
  })

  it('★ 视频任务只能出一条，并生成视频提示词', () => {
    expect(() =>
      buildEcommercePlan({
        ...base,
        mediaKind: 'video',
        modeLabel: '带货视频',
        count: 2,
      }),
    ).toThrow('视频一次只能生成 1 条')

    const plan = buildEcommercePlan({
      ...base,
      mediaKind: 'video',
      modeLabel: '带货视频',
      count: 1,
      durationSec: 10,
      note: '展示防水',
    })
    expect(plan.prompts[0]).toContain('带货视频')
    expect(plan.prompts[0]).toContain('10 秒')
    expect(plan.prompts[0]).toContain('展示防水')
  })

  it('★★ 非法输入逐条抛错 —— 不静默兜底', () => {
    const cases: [string, EcommerceRequest][] = [
      ['空产品图', { ...base, productNodeId: '' }],
      ['张数 0', { ...base, count: 0 }],
      ['张数超上限', { ...base, count: ECOMMERCE_COUNT_MAX + 1 }],
      ['张数不是整数', { ...base, count: 1.5 }],
      ['比例不认识', { ...base, ratio: '2:3' }],
      ['平台不存在', { ...base, platformId: 'nope' }],
      ['语言不认识', { ...base, language: 'xx' as never }],
      ['爆款复刻没上传参考图', { ...base, usage: 'recreate', referenceNodeIds: [] }],
      ['AI 编辑空指令', { ...base, usage: 'edit', note: '  ' }],
      ['AI 编辑多张', { ...base, usage: 'edit', count: 2, note: '把背景换掉' }],
      ['AI 超清非法倍数', { ...base, usage: 'edit', note: 'AI 超清', scale: '8x' as never }],
      ['AI 超清误用于主图', { ...base, usage: 'main', scale: '4x' }],
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
  /** 从最终提示词首句里取出镜头标题 */
  const shotTitleOf = (text: string): string =>
    (text.match(/镜头「([^」]+)」/) ?? [])[1]?.trim() ?? ''

  it('★★ 套图 8 张 = 8 条互不相同的最终提示词，且首句明确镜头', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'set', count: 8 })
    expect(plan.prompts).toHaveLength(8)
    expect(new Set(plan.prompts).size).toBe(8)
    for (const p of plan.prompts) {
      expect(p).toContain('专业电商商品摄影')
      expect(p).toContain('严格参照输入商品图')
      expect(p).not.toContain('这一张只做：')
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

  it('白底图按所选角度逐张生成，不同角度对应不同提示词', () => {
    const plan = buildEcommercePlan({
      ...base,
      usage: 'white-bg',
      count: 3,
      modeOptions: { whiteBgCounts: { front: 1, left45: 1, right45: 1 } },
    })
    expect(plan.prompts).toHaveLength(3)
    expect(new Set(plan.prompts).size).toBe(3)
    expect(plan.prompts[0]).toContain('纯白背景')
    expect(plan.prompts[0]).toContain('正面')
    expect(plan.prompts[1]).toContain('左45°')
    expect(plan.prompts[2]).toContain('右45°')
    // 抽卡不该带"每张都不一样"那句 —— 那会把用户想要的多试几次变成"必须换构图"
    expect(plan.prompts[0]).not.toContain('每张的镜头都不一样')
  })

  it('同一角度选 2 张时仍是同角度抽卡', () => {
    const plan = buildEcommercePlan({
      ...base,
      usage: 'white-bg',
      count: 2,
      modeOptions: { whiteBgCounts: { front: 2 } },
    })
    expect(new Set(plan.prompts).size).toBe(1)
  })

  it('★★ 多张时提示词里明确"每张的镜头都不一样"（修的就是"同一张画 N 遍"）', () => {
    const plan = buildEcommercePlan({ ...base, usage: 'detail', count: 4 })
    for (const p of plan.prompts) expect(p).toContain('必须与同批其他图片不同')
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
    // 单张不该出现"同批其他图片"这句（它只在多张时有意义）
    expect(plan.prompts[0]).not.toContain('同批其他图片')
  })

  it('★★ 爆款复刻用参考图，但明确不复制品牌与文案，产品外观仍以产品图为准', () => {
    const plan = buildEcommercePlan({
      ...base,
      usage: 'recreate',
      count: 4,
      referenceNodeIds: ['viral-ref'],
    })
    expect(plan.referenceNodeIds).toEqual(['viral-ref'])
    expect(plan.prompts).toHaveLength(4)
    expect(new Set(plan.prompts).size).toBe(4)
    expect(plan.prompts.map(shotTitleOf)).toEqual([
      '同构图复刻',
      '同风格换背景',
      '近景质感版',
      '生活场景版',
    ])
    for (const prompt of plan.prompts) {
      expect(prompt).toContain('只借鉴参考图的构图')
      expect(prompt).toContain('不要复制参考图的品牌 Logo')
      expect(prompt).toContain('产品外观、颜色、材质、结构仍以商品原图为准')
    }
  })

  it('★★ 定向 AI 编辑只改用户点名项，未点名内容保持不变', () => {
    const plan = buildEcommercePlan({
      ...base,
      usage: 'edit',
      count: 1,
      note: '把背景换成海边日落，产品不要动',
    })
    expect(plan.prompts).toHaveLength(1)
    expect(plan.prompts[0]).toContain('把背景换成海边日落，产品不要动')
    expect(plan.prompts[0]).toContain('只执行用户明确点名的修改')
    expect(plan.prompts[0]).toContain('未点名的产品、人物、构图、光影、文字与背景保持不变')
    expect(plan.prompts[0]).toContain('镜头「定向编辑」')
    expect(plan.prompts[0]).toContain('不要新增品牌 Logo、水印、认证、价格')
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

  it('★★ 改策划后旧最终提示词作废，避免标题与画面错位', () => {
    const withPrompt = [
      { title: '正面', brief: '产品正对镜头', prompt: '旧最终提示词' },
      { title: '细节', brief: '贴近拍材质', prompt: '另一条最终提示词' },
    ]
    const next = updateEcommerceShot(withPrompt, 0, { brief: '改成俯拍' })
    expect(next[0]).toEqual({ title: '正面', brief: '改成俯拍' })
    expect(next[1]).toBe(withPrompt[1])
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
