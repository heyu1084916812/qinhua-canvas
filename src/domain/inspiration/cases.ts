import type { InspirationSource } from './sources'

/**
 * 一条灵感案例（**统一模型**）。
 *
 * 来源各家字段名不同，解析完都收敛到这里 —— 界面只认这一份，
 * 以后加新来源只需要多写一个解析器，不用动页面。
 */
export interface InspirationCase {
  /** 全局唯一（`sourceId:来源内的 id`），收藏与去重都用它 */
  id: string
  sourceId: string
  /** 来源名（卡片上标出处用，避免每张卡再去查来源表） */
  sourceName: string
  title: string
  /** 提示词原文（"复制提示词"给的就是它） */
  prompt: string
  /** 预览图**外链**；没有图的案例给空串，界面画占位 */
  imageUrl: string
  tags: string[]
  /** 原作者署名（如 `@Naiknelofar788`） */
  credit?: string
  /** 原始出处链接（推文 / 帖子） */
  creditUrl?: string
  /** 仓库内的说明位置 */
  docUrl?: string
}

/**
 * 宽松取字符串。
 *
 * ⚠️ **数字也要认**：来源里的 `id` 常是数字（`"id": 544`）——早先只认 string，
 * 于是每条的 id 都退化成数组下标，整页的 id 全错位（单测当场抓到）。
 */
const str = (v: unknown): string => {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : []

/**
 * 把来源的数据文件解析成统一案例。
 *
 * 目前只认 `{ cases: [...] }` 这一种结构（`freestylefly/awesome-gpt-image-2` 的
 * `data/cases.json`）。**解析不出来就返回空数组，不抛** —— 一个来源挂了不该让整页打不开，
 * 界面按"这个来源这次没取到"如实说明。
 */
export function parseInspirationCases(
  raw: unknown,
  source: InspirationSource,
): InspirationCase[] {
  const rows = (raw as { cases?: unknown } | null)?.cases
  if (!Array.isArray(rows)) return []

  const out: InspirationCase[] = []
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>
    /** 提示词优先取原文，老数据只有 preview 时退回它 */
    const prompt = str(r.prompt) || str(r.promptPreview)
    const title = str(r.title) || prompt.slice(0, 40)
    /** 两样都没有的行是脏数据，跳过（不占位、不报错） */
    if (!prompt && !title) continue

    const image = str(r.image)
    const credit = str(r.sourceLabel)
    const creditUrl = str(r.sourceUrl)
    const docUrl = str(r.githubUrl)
    out.push({
      id: `${source.id}:${str(r.id) || out.length}`,
      sourceId: source.id,
      sourceName: source.name,
      title,
      prompt,
      /** 相对路径拼来源的图片基址；已经是完整地址就原样用 */
      imageUrl: image
        ? image.startsWith('http')
          ? image
          : `${source.imageBase}${image.startsWith('/') ? '' : '/'}${image}`
        : '',
      /** 分类 + 风格 + 场景合成一列标签，去重保序 */
      tags: [
        ...new Set([str(r.category), ...strList(r.styles), ...strList(r.scenes)].filter(Boolean)),
      ],
      ...(credit ? { credit } : {}),
      ...(creditUrl ? { creditUrl } : {}),
      ...(docUrl ? { docUrl } : {}),
    })
  }
  return out
}

export interface InspirationFilter {
  /** 关键字：命中标题 / 提示词 / 标签 / 署名，大小写不敏感 */
  query?: string
  /** 来源筛选（null / 不传 = 全部来源） */
  sourceId?: string | null
  /** 标签筛选（null / 不传 = 全部标签） */
  tag?: string | null
}

/**
 * **README 型来源**的解析器（PicoTrex 那种分节结构）。
 *
 * 版式（2026-10-14 实测，全文件统一）：
 *
 * ```md
 * ### 例 1: [浮世绘闪卡](https://x.com/.../status/123)（by [@MANISH1027512](https://x.com/...)）
 *
 * | 输出 |
 * | --- |
 * | <img src="images/pro_case1/output.jpg" width="300" alt="输出结果"> |
 *
 * **提示词:**
 *
 * ```
 * 提示词正文
 * ```
 * ```
 *
 * 三条口径与 JSON 那条一致：**解析不出来返回空数组、不抛**（由 `refresh` 决定怎么处理）、
 * 认不出的字段留空、绝不编造。提示词优先取「**提示词**」字样之后的**第一个代码块** ——
 * 直接取全段第一个代码块，遇到正文里先出现别的代码块就会取错。
 */
export function parseReadmeCases(md: string, source: InspirationSource): InspirationCase[] {
  if (typeof md !== 'string' || !md) return []
  const out: InspirationCase[] = []

  /** 按 `###` 切段（第一个前言块没有 `###` 开头，自然跳过） */
  for (const block of md.split(/\n(?=###\s)/)) {
    const head = /^###\s+(.+)$/m.exec(block)?.[1]
    if (!head) continue
    const num = /^例\s*(\d+)\s*[:：]/.exec(head)?.[1]
    /** 不是「例 N」的分节（Menu / 更新日志那类）不要 —— 它们没有案例内容 */
    if (!num) continue

    const titleLink = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(head)
    const authorLink = /by\s*\[?(@[^\]\s]+)\]?\((https?:\/\/[^)]+)\)/.exec(head)
    const image = /<img\s+[^>]*src="([^"]+)"/i.exec(block)?.[1] ?? ''
    const promptSection = block.split(/\*\*提示词\s*[:：]?\s*\*\*/)[1] ?? block
    const prompt = /```[a-zA-Z]*\r?\n([\s\S]*?)```/.exec(promptSection)?.[1]?.trim() ?? ''

    const title = (titleLink?.[1] ?? head.replace(/^例\s*\d+\s*[:：]\s*/, '')).trim()
    if (!title && !prompt) continue

    out.push({
      id: `${source.id}:${num}`,
      sourceId: source.id,
      sourceName: source.name,
      title,
      prompt,
      imageUrl: image
        ? image.startsWith('http')
          ? image
          : `${source.imageBase}/${image.replace(/^\.?\//, '')}`
        : '',
      /** README 型来源没有结构化的标签，如实留空（不拿标题硬凑几个） */
      tags: [],
      ...(authorLink?.[1] ? { credit: authorLink[1] } : {}),
      ...(titleLink?.[2] ? { creditUrl: titleLink[2] } : {}),
      /** README 里没有"仓库内位置"这种锚点，给仓库首页即可 */
      docUrl: source.repo,
    })
  }
  return out
}

/**
 * 筛选（纯函数，页面与单测共用一份口径）。
 *
 * 关键字**同时扫标题、提示词、标签、署名**：用户找"奶龙"时可能记的是标题，
 * 找"产品图"时记的是标签，找某位作者时记的是署名 —— 让他先想"这个词属于哪个字段"
 * 是没必要的负担。
 */
export function filterCases(
  cases: readonly InspirationCase[],
  filter: InspirationFilter = {},
): InspirationCase[] {
  const q = (filter.query ?? '').trim().toLowerCase()
  return cases.filter((c) => {
    if (filter.sourceId && c.sourceId !== filter.sourceId) return false
    if (filter.tag && !c.tags.includes(filter.tag)) return false
    if (!q) return true
    const hay = [c.title, c.prompt, c.sourceName, c.credit ?? '', ...c.tags]
      .join('\n')
      .toLowerCase()
    return hay.includes(q)
  })
}

/** 标签清单（按出现次数降序；页面顶部那排筛选用） */
export function tagCounts(cases: readonly InspirationCase[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const c of cases) {
    for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
