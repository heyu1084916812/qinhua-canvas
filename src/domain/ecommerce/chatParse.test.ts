import { describe, expect, it } from 'vitest'
import { ECOMMERCE_NOTE_MAX } from './prompt'
import { ECOMMERCE_PLATFORMS } from './platforms'
import {
  buildIntentSystem,
  buildIntentText,
  ECOMMERCE_INTENT_MARKER,
  intentRows,
  parseEcommerceIntent,
} from './chatParse'

const okOf = (raw: string, options?: Parameters<typeof parseEcommerceIntent>[1]) => {
  const out = parseEcommerceIntent(raw, options)
  if (!out.ok) throw new Error(`本该解析成功，却失败了：${out.error}`)
  return out
}

describe('parseEcommerceIntent：只认白名单，一个都不许猜', () => {
  it('★ 完整的一句：六项全部对上（平台 id → 显示名）', () => {
    const out = okOf(
      JSON.stringify({
        usage: '详情页',
        platformId: 'amazon',
        language: 'en',
        count: 4,
        ratio: '3:4',
        note: '突出防水材质',
      }),
    )
    expect(out.draft).toEqual({
      usage: 'detail',
      platformId: 'amazon',
      language: 'en',
      count: 4,
      ratio: '3:4',
      note: '突出防水材质',
    })
    expect(out.rows).toEqual([
      { label: '用途', value: '详情页' },
      { label: '平台', value: 'Amazon' },
      { label: '文案语言', value: 'English' },
      { label: '张数', value: '4 张' },
      { label: '比例', value: '3:4' },
      { label: '补充要求', value: '突出防水材质' },
    ])
  })

  it('★ 模型用代码块包住也能解析（现实里它就这么回）', () => {
    const out = okOf('好的，我读到的参数是：\n```json\n{"usage":"套图","count":8}\n```\n还需要别的吗？')
    expect(out.draft.usage).toBe('set')
    expect(out.draft.count).toBe(8)
  })

  it('★★ 编造的取值一律丢弃：认不出的宁可不要，也不替用户填', () => {
    /* 五项全不认 ⇒ 没有可用项 ⇒ 整条判失败（不是"空草案"） */
    expect(parseEcommerceIntent(
      JSON.stringify({ usage: '海报', platformId: 'shopify', language: 'fr', count: 99, ratio: '2:3' }),
    )).toEqual({
      ok: false,
      error:
        '没解析出参数：这句话里没有能对上表单的项（用途 / 平台 / 语言 / 张数 / 比例）。直接填表单更快。',
    })
  })

  it('★★ 一半认识一半编：认识的留下、编的丢掉（不因为有一项错就整条作废）', () => {
    const out = okOf(
      JSON.stringify({ usage: '主图', platformId: 'shopify', ratio: '16:9', count: 1 }),
      { fallbackNote: '' },
    )
    expect(out.draft).toEqual({ usage: 'main', ratio: '16:9', count: 1 })
    expect(out.draft).not.toHaveProperty('platformId')
  })

  it('平台写**显示名**也认（模型常把 Amazon 原样抄回来）', () => {
    const out = okOf(JSON.stringify({ platformId: 'Amazon', usage: 'main' }), { fallbackNote: '' })
    expect(out.draft.platformId).toBe('amazon')
  })

  it('比例接受全角冒号，但只认表单那五档', () => {
    expect(okOf(JSON.stringify({ ratio: '3：4' }), { fallbackNote: '' }).draft.ratio).toBe('3:4')
    expect(okOf(JSON.stringify({ ratio: ' 1:1 ' }), { fallbackNote: '' }).draft.ratio).toBe('1:1')
    expect(parseEcommerceIntent(JSON.stringify({ ratio: '2:3' })).ok).toBe(false)
  })

  it('张数：整数 1..12；小数四舍五入、0 与 99 都不收', () => {
    expect(okOf(JSON.stringify({ count: 8 }), { fallbackNote: '' }).draft.count).toBe(8)
    /* 模型偶尔把数字包成字符串 */
    expect(okOf(JSON.stringify({ count: '6' }), { fallbackNote: '' }).draft.count).toBe(6)
    expect(parseEcommerceIntent(JSON.stringify({ count: 0 })).ok).toBe(false)
    expect(parseEcommerceIntent(JSON.stringify({ count: 99 })).ok).toBe(false)
  })

  it('★ 不是 JSON / 是数组 / 是空串：三种都如实失败，且说的不是同一句话', () => {
    const notJson = parseEcommerceIntent('好的，我帮你做一套（这一段故意不是 JSON）。')
    expect(notJson.ok).toBe(false)
    if (!notJson.ok) expect(notJson.error).toContain('不是一个 JSON 对象')

    /* 裸数组形状不对：这份契约要的是一个对象 */
    expect(parseEcommerceIntent('[{"usage":"main"}]').ok).toBe(false)
    expect(parseEcommerceIntent('').ok).toBe(false)
  })

  it('★ 用户原话兜底进 note：模型没给 note 时，那句话原样带过去（表单里还能改）', () => {
    const out = okOf(JSON.stringify({ usage: 'detail', count: 4 }), {
      fallbackNote: '给我做一套亚马逊英文详情页，4 张，3:4',
    })
    expect(out.draft.note).toBe('给我做一套亚马逊英文详情页，4 张，3:4')
  })

  it('模型给了 note 就用模型的（它更短、更像补充要求）；超长按表单上限截断', () => {
    const out = okOf(JSON.stringify({ usage: 'set', note: '模特手持场景' }), {
      fallbackNote: '这一段不该被用上',
    })
    expect(out.draft.note).toBe('模特手持场景')

    const long = okOf(JSON.stringify({ usage: 'set', note: '甲'.repeat(ECOMMERCE_NOTE_MAX + 50) }))
    expect(long.draft.note).toHaveLength(ECOMMERCE_NOTE_MAX)
  })

  it('★★ 只有 note 认出来不算听懂（否则会弹出一张什么都没写的确认卡）', () => {
    const out = parseEcommerceIntent(JSON.stringify({ note: '随便写一句' }), {
      fallbackNote: '随便写一句',
    })
    expect(out.ok).toBe(false)
  })
})

describe('intentRows / buildIntentText / buildIntentSystem', () => {
  it('行只含有值的项，顺序固定（用途 → 平台 → 语言 → 张数 → 比例 → 补充要求）', () => {
    expect(
      intentRows({
        ratio: '1:1',
        usage: 'white-bg',
        note: '不要出现文字',
        platformId: 'temu',
      }),
    ).toEqual([
      { label: '用途', value: '白底图' },
      { label: '平台', value: 'Temu' },
      { label: '比例', value: '1:1' },
      { label: '补充要求', value: '不要出现文字' },
    ])
    expect(intentRows({})).toEqual([])
  })

  it('认不出的 platformId 原样显示（草稿里不该出现，但真出现时不静默成别的平台）', () => {
    expect(intentRows({ platformId: 'shopify' })).toEqual([{ label: '平台', value: 'shopify' }])
  })

  it('用户消息里带着平台白名单与语言白名单（模型才知道边界）', () => {
    const text = buildIntentText('做一套亚马逊英文详情页', ECOMMERCE_PLATFORMS)
    expect(text).toContain('做一套亚马逊英文详情页')
    expect(text).toContain('- amazon（Amazon）')
    expect(text).toContain('- jd（')
    expect(text).toContain('en（English）')
    expect(text).toContain('zh-CN（中文简体）')
  })

  it('系统指令带识别标记与"不许猜"这条硬口径', () => {
    const system = buildIntentSystem()
    expect(system).toContain(ECOMMERCE_INTENT_MARKER)
    expect(system).toContain('没听出来的键就不要写')
    expect(system).toContain('用户没说的，键就**不要出现**')
  })
})
