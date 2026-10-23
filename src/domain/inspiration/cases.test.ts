import { describe, expect, it } from 'vitest'
import {
  filterCases,
  parseInspirationCases,
  parseReadmeCases,
  parseTextCases,
  tagCounts,
} from './cases'
import type { InspirationSource } from './sources'

const SOURCE: InspirationSource = {
  id: 'demo',
  name: 'Demo 源',
  repo: 'https://github.com/example/demo',
  dataUrl: 'https://raw.githubusercontent.com/example/demo/main/data/cases.json',
  imageBase: 'https://raw.githubusercontent.com/example/demo/main',
  note: '测试用',
  format: 'json',
  modelCategory: 'GPT Image',
  kind: 'image',
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

  it('★★ id 撞车时自动加后缀（React key 必须唯一，否则切来源时卡片不换）', () => {
    const out = parseInspirationCases(
      { cases: [{ id: 7, title: 'a' }, { id: 7, title: 'b' }, { id: 7, title: 'c' }] },
      SOURCE,
    )
    expect(out.map((c) => c.id)).toEqual(['demo:7', 'demo:7-2', 'demo:7-3'])
  })

  it('★★ LearnPrompt 结构：promptFull / posterUrl / mediaUrl / creator 都能落到统一模型', () => {
    const out = parseInspirationCases(
      {
        cases: [
          {
            slug: 'diner-rewind',
            title: '餐厅倒放',
            promptFull: 'A cinematic diner scene',
            posterUrl: 'https://cdn.example.com/poster.jpg',
            mediaUrl: 'https://cdn.example.com/video.mp4',
            creator: '@techhalla',
            sourceUrl: 'https://x.com/a/1',
            tags: ['Diner'],
            models: ['Seedance 2.5'],
          },
        ],
      },
      { ...SOURCE, id: 'seed', kind: 'video' },
    )
    expect(out[0]).toMatchObject({
      id: 'seed:diner-rewind',
      prompt: 'A cinematic diner scene',
      imageUrl: 'https://cdn.example.com/poster.jpg',
      videoUrl: 'https://cdn.example.com/video.mp4',
      credit: '@techhalla',
      creditUrl: 'https://x.com/a/1',
      tags: ['Diner', 'Seedance 2.5'],
      kind: 'video',
    })
  })

  it('★ 顶层 prompts 数组也认（蓝叔视频工具包的字段口径）', () => {
    const out = parseInspirationCases(
      {
        prompts: [
          {
            id: 'kv-001',
            title: '霓虹雨夜',
            prompt: 'A woman walks through neon rain',
            tags: ['portrait', 'kling'],
            source: { url: 'https://example.com/kling' },
          },
        ],
      },
      { ...SOURCE, id: 'lanshu', kind: 'video' },
    )
    expect(out[0]).toMatchObject({
      id: 'lanshu:kv-001',
      title: '霓虹雨夜',
      creditUrl: 'https://example.com/kling',
      tags: ['portrait', 'kling'],
    })
  })

  it('★ 水仙分片：相对图片路径按 shuixian-unified 基址解析', () => {
    const out = parseInspirationCases(
      [
        {
          id: 14347,
          title: '镜头人像',
          prompt: '一张人像',
          image: 'images/originals/14347.jpg',
          category: '人像',
          styles: ['胶片'],
        },
      ],
      {
        ...SOURCE,
        id: 'shuixian',
        imageBase: 'https://cdn.jsdelivr.net/gh/BaYue-SYJ/shuixian-prompts@main/shuixian-unified/',
      },
    )
    expect(out[0]!.imageUrl).toBe(
      'https://cdn.jsdelivr.net/gh/BaYue-SYJ/shuixian-prompts@main/shuixian-unified/images/originals/14347.jpg',
    )
    expect(out[0]!.tags).toEqual(['人像', '胶片'])
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

  it('★★ README 编号在不同组里重来时，id 仍要唯一（两个「例 1」不能撞 key）', () => {
    const dup = [
      '### 例 1: [第一组第一条](https://x.com/a/status/1)',
      '',
      '<img src="images/a.jpg" width="300">',
      '',
      '**提示词:**',
      '',
      '```',
      'first',
      '```',
      '',
      '### 例 1: [第二组第一条](https://x.com/b/status/2)',
      '',
      '<img src="images/b.jpg" width="300">',
      '',
      '**提示词:**',
      '',
      '```',
      'second',
      '```',
    ].join('\n')
    const out = parseReadmeCases(dup, SOURCE)
    expect(out.map((c) => c.id)).toEqual(['demo:1', 'demo:1-2'])
    expect(out.map((c) => c.title)).toEqual(['第一组第一条', '第二组第一条'])
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
    modelCategory: 'Nano Banana',
    kind: 'image',
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
    modelCategory: 'Seedance',
    kind: 'video',
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
    '',
    '<a href="https://cdn.example.com/videos/forest.mp4">',
    '<img src="https://cdn.example.com/videos/forest.jpg" />',
    '</a>',
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
    expect(out[1]!.videoUrl).toBe('https://cdn.example.com/videos/forest.mp4')
    expect(out[1]!.kind).toBe('video')
  })
})

describe('parseReadmeCases · ZeroLu 版式', () => {
  const ZERO: InspirationSource = {
    ...SOURCE,
    id: 'zero',
    name: 'ZeroLu',
    format: 'readme',
    readmeStyle: 'zerolu',
    imageBase: 'https://cdn.jsdelivr.net/gh/ZeroLu/awesome-gpt-image@main',
  }

  it('★★ `### 标题` + `**提示词:**` + Markdown 图片可解析，资源段落会跳过', () => {
    const md = [
      '## 目录',
      '',
      '### 便利店夜景',
      '![示例](assets/store.jpg)',
      '',
      '**提示词:**',
      '```text',
      '夏夜便利店门口的街头抓拍',
      '```',
      '**来源:** [@author](https://x.com/a/1)',
      '',
      '### 资源',
      '- 只是链接，不是案例',
    ].join('\n')
    const out = parseReadmeCases(md, ZERO)
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('便利店夜景')
    expect(out[0]!.prompt).toBe('夏夜便利店门口的街头抓拍')
    expect(out[0]!.imageUrl).toBe(
      'https://cdn.jsdelivr.net/gh/ZeroLu/awesome-gpt-image@main/assets/store.jpg',
    )
    expect(out[0]!.credit).toBe('@author')
  })
})

describe('parseTextCases', () => {
  it('官方 TXT 提示词规范作为一条可复制案例，并按文件区分模式', () => {
    const base = parseTextCases(
      'integrated_multimodal_description: ...\noverall_soundscape: ...',
      {
        ...SOURCE,
        id: 'h3',
        name: 'MiniMax H3 官方提示词',
        format: 'text',
        kind: 'video',
        dataUrl: 'https://cdn.example.com/references/base-en.txt',
      },
    )
    const ref = parseTextCases(
      'subject_definitions: ...',
      {
        ...SOURCE,
        id: 'h3',
        name: 'MiniMax H3 官方提示词',
        format: 'text',
        kind: 'video',
        dataUrl: 'https://cdn.example.com/references/base-en.txt',
      },
      'https://cdn.example.com/references/ref-en.txt',
    )
    expect(base[0]!.title).toContain('基础与关键帧模式')
    expect(base[0]!.kind).toBe('video')
    expect(ref[0]!.title).toContain('全参考模式')
  })

  it('官方 SKILL.md 使用一级标题和文件路径生成稳定案例', () => {
    const out = parseTextCases(
      '---\nname: product-ad\n---\n\n# 极简产品广告生成器\n\n完整工作流',
      {
        ...SOURCE,
        id: 'h3',
        name: 'MiniMax H3 官方提示词',
        format: 'text',
        kind: 'video',
        dataUrl: 'https://cdn.example.com/base-en.txt',
      },
      'https://cdn.example.com/skills/minimalist-product-ad-generator/SKILL.cn.md',
    )
    expect(out[0]).toMatchObject({
      id: 'h3:minimalist-product-ad-generator/SKILL.cn.md',
      title: '极简产品广告生成器',
      kind: 'video',
    })
  })
})
