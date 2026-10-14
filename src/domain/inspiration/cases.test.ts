import { describe, expect, it } from 'vitest'
import { filterCases, parseInspirationCases, parseReadmeCases, tagCounts } from './cases'
import type { InspirationSource } from './sources'

const SOURCE: InspirationSource = {
  id: 'demo',
  name: 'Demo 源',
  repo: 'https://github.com/example/demo',
  dataUrl: 'https://raw.githubusercontent.com/example/demo/main/data/cases.json',
  imageBase: 'https://raw.githubusercontent.com/example/demo/main',
  note: '测试用',
  format: 'json',
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

  it('★★ 顶层数组形状的 JSON 也认（banana-prompt-quicker 的字段口径）', () => {
    const out = parseInspirationCases(
      [
        {
          title: '电商产品图',
          prompt: 'a clean product shot',
          preview: 'https://cdn.example.com/p.jpg',
          author: 'glidea',
          category: '电商',
          sub_category: '产品图',
        },
        {
          prompt: '没有标题时用提示词开头兜底',
          reference_image_urls: ['https://cdn.example.com/r.jpg'],
        },
        {},
      ],
      SOURCE,
    )
    expect(out).toHaveLength(2)
    expect(out[0]!.id).toBe('demo:1')
    expect(out[0]!.imageUrl).toBe('https://cdn.example.com/p.jpg')
    expect(out[0]!.tags).toEqual(['电商', '产品图'])
    expect(out[0]!.credit).toBe('glidea')
    /** 第二条没标题就截提示词开头；没 preview 就退回第一张参考图 */
    expect(out[1]!.title).toBe('没有标题时用提示词开头兜底')
    expect(out[1]!.imageUrl).toBe('https://cdn.example.com/r.jpg')
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

/**
 * README 型来源（PicoTrex 那种分节结构）。
 *
 * 版式实测口径写在 `parseReadmeCases` 的注释里 —— 这几条测试就是那份口径的钉子。
 */
describe('parseReadmeCases', () => {
  const md = [
    '## 📑 Menu',
    '- [例 1](#x)',
    '',
    '### 例 1: [浮世绘闪卡](https://x.com/a/status/1)（by [@MANISH1027512](https://x.com/a)）',
    '',
    '| 输出 |',
    '| --- |',
    '| <img src="images/pro_case1/output.jpg" width="300" alt="输出结果"> |',
    '',
    '**提示词:**',
    '',
    '```',
    '核心指令：一张日式浮世绘风格的卡牌',
    '```',
    '',
    '### 例 2: [生成对应坐标的图片](https://x.com/b/status/2)（by [@TechieBySA](https://x.com/b)）',
    '',
    '<img src="images/pro_case2/output.jpg" width="300">',
    '',
    '**提示词:**',
    '',
    '```',
    '创建一张在北纬 40.7128° 的图像',
    '```',
  ].join('\n')

  it('★★ 从 README 分节里提出标题 / 图片外链 / 提示词 / 作者 / 原推文', () => {
    const out = parseReadmeCases(md, SOURCE)
    expect(out).toHaveLength(2)
    const c = out[0]!
    expect(c.id).toBe('demo:1')
    expect(c.title).toBe('浮世绘闪卡')
    expect(c.prompt).toContain('浮世绘风格的卡牌')
    /** README 里的图片是仓库根相对路径 ⇒ 拼成 raw 外链（与 JSON 源同一口径） */
    expect(c.imageUrl).toBe(
      'https://raw.githubusercontent.com/example/demo/main/images/pro_case1/output.jpg',
    )
    expect(c.credit).toBe('@MANISH1027512')
    expect(c.creditUrl).toBe('https://x.com/a/status/1')
  })

  it('★★ 提示词取「**提示词**」之后的代码块（正文里先出现别的代码块也不取错）', () => {
    const withExtra = [
      '### 例 7: [标题](https://x.com/c/status/3)（by [@who](https://x.com/who)）',
      '',
      '先来一段示例命令：',
      '```',
      '这是不该被当成提示词的内容',
      '```',
      '',
      '**提示词:**',
      '```',
      '这才是提示词',
      '```',
    ].join('\n')
    const out = parseReadmeCases(withExtra, SOURCE)
    expect(out[0]!.prompt).toBe('这才是提示词')
  })

  it('★ 不是「例 N」的分节（Menu / News）跳过，空输入返回空数组', () => {
    expect(parseReadmeCases(md, SOURCE).some((c) => c.title.includes('Menu'))).toBe(false)
    expect(parseReadmeCases('', SOURCE)).toEqual([])
    expect(parseReadmeCases('## 只有标题\n没有案例', SOURCE)).toEqual([])
  })

  it('★ README 型来源没有结构化标签，如实留空（不拿标题硬凑）', () => {
    expect(parseReadmeCases(md, SOURCE)[0]!.tags).toEqual([])
  })
})

/**
 * 第二种版式（YouMind 三家共用）。
 *
 * 这条测试的重点是**图从哪个分区取**：那三家在正文开头挂了一排 shields.io 徽章图，
 * 取整段第一张 `<img>` 会拿到徽章而不是作品图。
 */
describe('parseReadmeCases · YouMind 版式', () => {
  const YOU_MIND: InspirationSource = {
    ...SOURCE,
    id: 'ym',
    name: 'YouMind',
    format: 'readme',
    readmeStyle: 'youmind',
    /** 那三家的图托管在自家 CMS 上（绝对地址），所以没有"图片基址" */
    imageBase: '',
  }

  const md = [
    '### No. 1: Wide quote card',
    '',
    '![Language-ZH](https://img.shields.io/badge/Language-ZH-blue)',
    '![Featured](https://img.shields.io/badge/Featured-gold)',
    '',
    '#### 📖 Description',
    '',
    'A prompt for generating a wide quote card.',
    '',
    '#### 📝 Prompt',
    '',
    '```',
    'A wide quote card featuring a famous person.',
    '```',
    '',
    '#### 🖼️ Generated Images',
    '',
    '##### Image 1',
    '',
    '<div align="center">',
    '<img src="https://cms-assets.youmind.com/media/abc.jpg" width="700" alt="x">',
    '</div>',
  ].join('\n')

  it('★★ 图片取「生成图」分区里那张，不是开头那排徽章', () => {
    const out = parseReadmeCases(md, YOU_MIND)
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('Wide quote card')
    expect(out[0]!.prompt).toContain('A wide quote card featuring')
    expect(out[0]!.imageUrl).toBe('https://cms-assets.youmind.com/media/abc.jpg')
  })

  it('★ 没有图片基址时不去拼相对路径（拼了就是死链）', () => {
    const withRelative = md.replace(
      'https://cms-assets.youmind.com/media/abc.jpg',
      'images/local.jpg',
    )
    expect(parseReadmeCases(withRelative, YOU_MIND)[0]!.imageUrl).toBe('')
  })
})

/**
 * 第三种版式（Seedance 那家）：同一份文件里**两段格式并存** ——
 * 前几条带 `No. N:`（Featured），后面一大段是纯标题（All Prompts）。
 * 只认 `No.` 时那家 384 KB 的 README 只出 6 条（实测踩到）。
 */
describe('parseReadmeCases · 两段并存（Seedance）', () => {
  const SEED: InspirationSource = {
    ...SOURCE,
    id: 'seed',
    name: 'Seedance',
    format: 'readme',
    readmeStyle: 'youmindAll',
    imageBase: '',
  }

  const md = [
    '## 🔥 Featured Prompts',
    '',
    '### No. 1: 电影感短片',
    '',
    '#### 📝 Prompt',
    '```',
    'cinematic short film',
    '```',
    '',
    '## 🎬 All Prompts',
    '',
    '### 森林骑行',
    '',
    '#### 📝 Prompt',
    '```',
    'archer riding through misty forest',
    '```',
  ].join('\n')

  it('★★ 带编号与不带编号的两种分节都算案例', () => {
    const out = parseReadmeCases(md, SEED)
    expect(out).toHaveLength(2)
    expect(out[0]!.id).toBe('seed:1')
    expect(out[0]!.title).toBe('电影感短片')
    /** 没有编号的那条按**出现顺序**补号 */
    expect(out[1]!.id).toBe('seed:2')
    expect(out[1]!.title).toBe('森林骑行')
    expect(out[1]!.prompt).toContain('archer riding')
  })
})
