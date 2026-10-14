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
