import { describe, expect, it } from 'vitest'
import {
  buildShotsSystem,
  buildShotsText,
  ECOMMERCE_SHOTS_MARKER,
  looksLikePlanningPrompt,
  parseShotsReply,
  SHOT_BRIEF_MAX,
  SHOT_PROMPT_MAX,
  shotKeyOf,
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

const replyOf = (
  shots: readonly Record<string, unknown>[],
  analysis = '图中是一只蓝色户外宠物垫，边缘有提手。',
): string => JSON.stringify({ productAnalysis: { summary: analysis }, shots })

const shotOf = (index: number, over: Record<string, unknown> = {}) => ({
  title: `镜 ${index}`,
  brief: `第 ${index} 张的策划意图`,
  prompt:
    `专业电商摄影，第 ${index} 张采用不同构图。商品外观严格参照输入商品图，` +
    `柔和棚拍光线，背景简洁，画面文字使用指定语言且拼写正确。`,
  ...over,
})

describe('shouldExpandShots：值不值得问模型', () => {
  it('★ 非白底、非编辑的商品图都要先看原图', () => {
    expect(shouldExpandShots(requestOf())).toBe(true)
    expect(shouldExpandShots(requestOf({ usage: 'set', count: 8 }))).toBe(true)
    expect(shouldExpandShots(requestOf({ usage: 'main', count: 3 }))).toBe(true)
    expect(shouldExpandShots(requestOf({ usage: 'main', count: 1, note: '' }))).toBe(true)
  })

  it('★★ 只有白底抽卡、编辑指令和视频不需要先做商品策划', () => {
    expect(shouldExpandShots(requestOf({ usage: 'white-bg', count: 6 }))).toBe(false)
    expect(shouldExpandShots(requestOf({ usage: 'edit', count: 1 }))).toBe(false)
    expect(shouldExpandShots(requestOf({ mediaKind: 'video', count: 1 }))).toBe(false)
  })
})

describe('parseShotsReply：条数必须严格对得上', () => {
  it('★ 正常四条第 1 条 title 为空时用「第 N 张」补上（brief 是实质）', () => {
    const out = parseShotsReply(
      replyOf([
        shotOf(1, { title: '', brief: '正面全身，突出防水涂层' }),
        shotOf(2, { title: '手持场景', brief: '模特手持，浴室环境' }),
        shotOf(3, { title: '细节', brief: '贴拍杯口与密封圈' }),
        shotOf(4, { title: '对比', brief: '与旧款并置说明密封差别' }),
      ]),
      4,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.shots.map((s) => s.title)).toEqual(['第 1 张', '手持场景', '细节', '对比'])
    expect(out.shots[0]!.brief).toBe('正面全身，突出防水涂层')
    expect(out.analysis).toContain('蓝色户外宠物垫')
  })

  it('代码块包住也认；裸数组缺商品分析会被拒绝', () => {
    const wrapped = parseShotsReply(
      `好，我排好了：\n\`\`\`json\n${replyOf([shotOf(1), shotOf(2)])}\n\`\`\``,
      2,
    )
    expect(wrapped.ok).toBe(true)
    expect(parseShotsReply(JSON.stringify([shotOf(1)]), 1).ok).toBe(false)
  })

  it('★★ 少一条 / 多一条：整批回落，且错误里写清"要几条、回了几条"', () => {
    const short = parseShotsReply(
      replyOf([shotOf(1), shotOf(2)]),
      4,
    )
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.error).toContain('要 4 条，模型回了 2 条')

    const long = parseShotsReply(
      JSON.stringify({
        productAnalysis: { summary: '已看图' },
        shots: [
          shotOf(1),
          shotOf(2),
        ],
      }),
      1,
    )
    expect(long.ok).toBe(false)
  })

  it('★★ 某一条没写 brief ⇒ 整批回落（不许拿 title 顶上，也不许留个空壳）', () => {
    const out = parseShotsReply(
      JSON.stringify({
        productAnalysis: { summary: '已看图' },
        shots: [
          shotOf(1),
          shotOf(2, { brief: '   ' }),
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

  it('超长的 title / brief / prompt 截断到上限', () => {
    const out = parseShotsReply(
      replyOf([
        shotOf(1, {
          title: '甲'.repeat(80),
          brief: '乙'.repeat(SHOT_BRIEF_MAX + 120),
          prompt: '丙'.repeat(SHOT_PROMPT_MAX + 120),
        }),
      ]),
      1,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.shots[0]!.brief).toHaveLength(SHOT_BRIEF_MAX)
    expect(out.shots[0]!.prompt).toHaveLength(SHOT_PROMPT_MAX)
  })

  it('★★ 只有策划简报、没有最终 prompt ⇒ 停止', () => {
    const out = parseShotsReply(replyOf([{ title: 'A', brief: '一' }]), 1)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('没有最终生图提示词')
  })

  it('★★ 把策划字段塞进 prompt ⇒ 解析层拦截', () => {
    const planning = '套图结构：自定义配置\n输出：7 张，比例 1:1\n硬约束：不改产品外观'
    expect(looksLikePlanningPrompt(planning)).toBe(true)
    const out = parseShotsReply(replyOf([shotOf(1, { prompt: planning })]), 1)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('仍是策划字段')
  })

  it('★★ 多张最终 prompt 重复 ⇒ 整批停止', () => {
    const same = shotOf(1).prompt
    const out = parseShotsReply(replyOf([shotOf(1, { prompt: same }), shotOf(2, { prompt: same })]), 2)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('提示词有重复')
  })
})

describe('shotKeyOf：一份方案还算不算数', () => {
  const base = {
    usage: 'detail' as const,
    platformId: 'amazon',
    language: 'en' as const,
    count: 4,
    ratio: '3:4',
    note: '突出防水材质',
  }

  it('★ 同一组参数同一个键（每次拼出来一样）', () => {
    expect(shotKeyOf(base)).toBe(shotKeyOf({ ...base }))
  })

  it('★★ 影响分镜的每一项变了都要换键：用途 / 平台 / 语言 / 张数 / 比例 / 那句要求', () => {
    const keys = new Set([
      shotKeyOf(base),
      shotKeyOf({ ...base, usage: 'set' }),
      shotKeyOf({ ...base, platformId: 'temu' }),
      shotKeyOf({ ...base, language: 'ja' }),
      shotKeyOf({ ...base, count: 5 }),
      shotKeyOf({ ...base, ratio: '1:1' }),
      shotKeyOf({ ...base, note: '换个要求' }),
    ])
    expect(keys.size).toBe(7)
  })

  it('★ 只有空白差异不算变（别让一句多余的空格把方案作废）', () => {
    expect(shotKeyOf({ ...base, note: `  ${base.note}  ` })).toBe(shotKeyOf(base))
    expect(shotKeyOf({ ...base, platformId: undefined })).not.toBe(shotKeyOf(base))
  })
})

describe('提示词与逐张拼装', () => {
  it('用户消息里带着那句话、张数、平台规则与默认脚本（模型是"改"结构而不是从零编）', () => {
    const text = buildShotsText(requestOf(), ECOMMERCE_PLATFORMS, 2)
    expect(text).toContain('附带的视觉素材：2 张商品原图 / 参考图')
    expect(text).toContain('用户的要求：突出防水材质，模特手持场景')
    expect(text).toContain('要求张数：4')
    expect(text).toContain('比例：3:4')
    expect(text).toContain('亚马逊')
    expect(text).toContain('默认镜头脚本')
    /* 默认脚本的条目也要在（第 1 条对应第 1 张） */
    expect(text).toContain('- 首图：全貌 + 卖点主张')
  })

  it('系统指令带识别标记，要求先分析附图并输出最终 prompt，且不许编造', () => {
    const system = buildShotsSystem()
    expect(system).toContain(ECOMMERCE_SHOTS_MARKER)
    expect(system).toContain('productAnalysis')
    expect(system).toContain('最终视觉提示词')
    expect(system).toContain('条数必须等于要求的张数')
    expect(system).toContain('不许编造材质、参数、认证、功效、价格、品牌')
  })

  it('★★ 传了分镜就逐张用它 —— 第 i 张的提示词里是第 i 条 brief', () => {
    const prompts = buildEcommercePrompts(requestOf({ count: 2 }), {
      platforms: ECOMMERCE_PLATFORMS,
      shots: [
        {
          title: '镜一',
          brief: '正面全身，突出防水涂层',
          prompt: '正面商业棚拍，蓝色宠物垫完整入画，柔和光线，背景干净。',
        },
        {
          title: '镜二',
          brief: '模特手持，浴室环境',
          prompt: '浴室场景中模特手持宠物垫，中景构图，自然窗光，材质清晰。',
        },
      ],
    })
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('正面商业棚拍')
    expect(prompts[1]).toContain('浴室场景')
    expect(prompts[0]).not.toContain('这一张只做')
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
