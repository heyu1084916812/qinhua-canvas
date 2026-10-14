import { describe, expect, it } from 'vitest'
import { filterCases, parseInspirationCases, tagCounts } from './cases'
import type { InspirationSource } from './sources'

const SOURCE: InspirationSource = {
  id: 'demo',
  name: 'Demo 源',
  repo: 'https://github.com/example/demo',
  dataUrl: 'https://raw.githubusercontent.com/example/demo/main/data/cases.json',
  imageBase: 'https://raw.githubusercontent.com/example/demo/main',
  note: '测试用',
}

describe('parseInspirationCases', () => {
  it('★★ 解析真实结构：相对图片路径要拼成 raw 外链（媒体不下载到本地）', () => {
    const out = parseInspirationCases(
      {
        cases: [
          {
            id: 544,
            title: '幼儿词汇拆解学习卡',
            image: '/images/case544.jpg',
            prompt: 'Create a clean poster…',
            promptPreview: 'Create a clean…',
            sourceLabel: '@Naiknelofar788',
            sourceUrl: 'https://x.com/a/1',
            category: 'Charts',
            styles: ['UI', 'Poster'],
            scenes: ['Education'],
            githubUrl: 'https://github.com/example/demo/blob/main/x.md#case-544',
          },
        ],
      },
      SOURCE,
    )
    expect(out).toHaveLength(1)
    const c = out[0]!
    expect(c.id).toBe('demo:544')
    expect(c.imageUrl).toBe(
      'https://raw.githubusercontent.com/example/demo/main/images/case544.jpg',
    )
    expect(c.prompt).toContain('Create a clean poster')
    /** 分类 + 风格 + 场景合成一列，去重保序 */
    expect(c.tags).toEqual(['Charts', 'UI', 'Poster', 'Education'])
    expect(c.credit).toBe('@Naiknelofar788')
  })

  it('★ 没有 prompt 原文时退回 promptPreview（老数据只有预览）', () => {
    const out = parseInspirationCases(
      { cases: [{ id: 1, title: 't', image: '', promptPreview: '预览用' }] },
      SOURCE,
    )
    expect(out[0]!.prompt).toBe('预览用')
  })

  it('★ 标题与提示词都没有的行是脏数据，跳过（不占位、不报错）', () => {
    const out = parseInspirationCases({ cases: [{ id: 1 }, { id: 2, title: 'ok' }] }, SOURCE)
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('ok')
  })

  it('★ 结构不对（不是 cases 数组）返回空数组，不抛 —— 一个来源挂了不该让整页打不开', () => {
    expect(parseInspirationCases(null, SOURCE)).toEqual([])
    expect(parseInspirationCases({ items: [] }, SOURCE)).toEqual([])
    expect(parseInspirationCases('boom', SOURCE)).toEqual([])
  })

  it('★ 已经是完整地址的图片原样用（来源把图托管在别处时）', () => {
    const out = parseInspirationCases(
      { cases: [{ id: 1, title: 'x', image: 'https://cdn.example.com/a.png' }] },
      SOURCE,
    )
    expect(out[0]!.imageUrl).toBe('https://cdn.example.com/a.png')
  })
})

describe('filterCases / tagCounts', () => {
  const cases = parseInspirationCases(
    {
      cases: [
        { id: 1, title: '奶龙插画', prompt: 'cute dragon', category: 'Illustration' },
        { id: 2, title: '产品主图', prompt: 'product shot', category: 'Product', styles: ['3D'] },
        { id: 3, title: '海报', prompt: 'poster', category: 'Poster', styles: ['3D'] },
      ],
    },
    SOURCE,
  )

  it('★★ 关键字同时扫标题 / 提示词 / 标签 / 署名（不让用户先想"这词属于哪个字段"）', () => {
    expect(filterCases(cases, { query: '奶龙' }).map((c) => c.id)).toEqual(['demo:1'])
    expect(filterCases(cases, { query: 'cute' }).map((c) => c.id)).toEqual(['demo:1'])
    expect(filterCases(cases, { query: '3D' }).map((c) => c.id)).toEqual(['demo:2', 'demo:3'])
  })

  it('★ 来源 / 标签筛选各自生效，且可与关键字叠加', () => {
    expect(filterCases(cases, { sourceId: 'nope' })).toEqual([])
    expect(filterCases(cases, { sourceId: 'demo' })).toHaveLength(3)
    expect(filterCases(cases, { tag: '3D' })).toHaveLength(2)
    expect(filterCases(cases, { tag: '3D', query: '海报' }).map((c) => c.id)).toEqual(['demo:3'])
  })

  it('★ 标签按出现次数降序（顶部那排筛选的排序口径）', () => {
    const counts = tagCounts(cases)
    expect(counts[0]).toEqual({ tag: '3D', count: 2 })
  })
})
