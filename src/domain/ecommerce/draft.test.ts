import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ECOMMERCE_FORM_DRAFT,
  cleanEcommerceDraftRefs,
  normalizeEcommerceFormDraft,
  readEcommerceFormDraft,
  withEcommerceFormDraft,
} from './draft'

describe('电商左侧草稿纯数据', () => {
  it('完整草稿逐项读回，不对字段做多余转换', () => {
    const draft = {
      modeLabel: 'A+ 详情页',
      mediaKind: 'image',
      videoDuration: 5,
      usage: 'detail',
      platformId: 'amazon',
      language: 'en',
      count: 4,
      ratio: '3:4',
      resolution: '4K',
      quality: 'high',
      note: '突出防水材质',
      model: 'GPT Image 2.5 Flare',
      modeOptions: {
        detailHighlights: ['hero', 'coreSelling'],
      },
      modeStates: {},
      productNodeId: 'node_product',
      productNodeIds: ['node_product'],
      referenceNodeIds: ['node_ref_1', 'node_ref_2'],
    } as const
    expect(normalizeEcommerceFormDraft(draft)).toEqual(draft)
  })

  it('脏值逐项回落：白名单 / 张数夹取 / 文字截断', () => {
    const out = normalizeEcommerceFormDraft({
      usage: 'wrong',
      language: 'wrong',
      count: 99,
      ratio: '2:3',
      note: '甲'.repeat(999),
      model: 'm'.repeat(999),
      referenceNodeIds: ['a', '', 'a', 'b', 'c', 'd', 'e'],
    })
    expect(out.usage).toBe('set')
    expect(out.language).toBe('en')
    expect(out.count).toBe(14)
    expect(out.ratio).toBe('smart')
    expect(out.note.length).toBe(500)
    expect(out.model.length).toBe(200)
    expect(out.referenceNodeIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('张数非法时按该用途默认值，不从别的用途借数', () => {
    expect(normalizeEcommerceFormDraft({ usage: 'set', count: Number.NaN }).count).toBe(8)
    expect(normalizeEcommerceFormDraft({ usage: 'detail' }).count).toBe(4)
  })

  it('每个顶部工具的平台、语言、比例与要求独立回读', () => {
    const out = normalizeEcommerceFormDraft({
      modeStates: {
        'product-set': {
          platformId: 'amazon',
          language: 'en',
          ratio: '1:1',
          note: '套图要求',
        },
        'product-detail': {
          platformId: 'taobao',
          language: 'zh-CN',
          ratio: 'aplus-premium-web',
          note: '详情页要求',
        },
        broken: {
          platformId: 'x',
          language: 'xx',
          ratio: 'bad',
          note: 9,
        },
      },
    })
    expect(out.modeStates['product-set']).toEqual({
      platformId: 'amazon',
      language: 'en',
      ratio: '1:1',
      resolution: 'auto',
      quality: 'auto',
      note: '套图要求',
    })
    expect(out.modeStates['product-detail']).toEqual({
      platformId: 'taobao',
      language: 'zh-CN',
      ratio: 'aplus-premium-web',
      resolution: 'auto',
      quality: 'auto',
      note: '详情页要求',
    })
    expect(out.modeStates.broken).toEqual({
      platformId: 'x',
      language: 'en',
      ratio: '1:1',
      resolution: 'auto',
      quality: 'auto',
      note: '',
    })
  })

  it('结果图后续动作 edit 不允许写回左侧新建表单', () => {
    expect(normalizeEcommerceFormDraft({ usage: 'edit' }).usage).toBe('set')
  })

  it('多产品图去重并限制 3 张，第一张同步为主产品图', () => {
    const out = normalizeEcommerceFormDraft({
      productNodeId: 'p1',
      productNodeIds: ['p1', 'p1', 'p2', 'p3', 'p4'],
    })
    expect(out.productNodeIds).toEqual(['p1', 'p2', 'p3'])
    expect(out.productNodeId).toBe('p1')
  })

  it('旧草稿只有 productNodeId 时归一成单元素产品图数组', () => {
    const out = normalizeEcommerceFormDraft({ productNodeId: 'legacy' })
    expect(out.productNodeIds).toEqual(['legacy'])
    expect(out.productNodeId).toBe('legacy')
  })

  it('with/read 是同一份往返，且不吞掉 ecommerce.batchId 与 extra 其它键', () => {
    const next = withEcommerceFormDraft(
      { cover: { hash: 'h1' }, ecommerce: { batchId: 'ecb_1' } },
      { ...DEFAULT_ECOMMERCE_FORM_DRAFT, usage: 'set', note: '一套图' },
    )
    expect((next.cover as { hash: string }).hash).toBe('h1')
    expect((next.ecommerce as { batchId: string }).batchId).toBe('ecb_1')
    expect(readEcommerceFormDraft(next)).toEqual({
      ...DEFAULT_ECOMMERCE_FORM_DRAFT,
      usage: 'set',
      note: '一套图',
    })
  })

  it('没有草稿 / 草稿不是对象时返回 null，不凭空造一份', () => {
    expect(readEcommerceFormDraft(undefined)).toBeNull()
    expect(readEcommerceFormDraft({ ecommerce: {} })).toBeNull()
    expect(readEcommerceFormDraft({ ecommerce: { draft: 'bad' } })).toBeNull()
  })

  it('悬空上传引用会被清掉：产品图置空、参考图逐张过滤', () => {
    const cleaned = cleanEcommerceDraftRefs(
      {
        ...DEFAULT_ECOMMERCE_FORM_DRAFT,
        productNodeId: 'gone_product',
        referenceNodeIds: ['keep_ref', 'gone_ref'],
      },
      new Set(['keep_ref']),
    )
    expect(cleaned.productNodeId).toBeNull()
    expect(cleaned.referenceNodeIds).toEqual(['keep_ref'])
  })
})
