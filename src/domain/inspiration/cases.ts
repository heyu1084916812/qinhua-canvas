import type { InspirationMediaKind, InspirationSource, ReadmeStyle } from './sources'

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
  /** 模型分类（来源级；搜索框旁那一档筛选用） */
  modelCategory?: string
  /** 图 / 视频。缓存里可能没有，界面按 image 兜底。 */
  kind?: InspirationMediaKind
  /** 视频外链；有它时详情页用 `<video>` 播放，封面仍用 `imageUrl`。 */
  videoUrl?: string
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

const VIDEO_EXT = /\.(?:mp4|webm|mov)(?:\?[^"'\s<>]*)?$/i

function videoUrlOf(...values: unknown[]): string {
  for (const value of values) {
    const candidates = [str(value), ...(Array.isArray(value) ? value.map(str) : [])]
    const hit = candidates.find(
      (candidate) => /^https?:\/\//i.test(candidate) && VIDEO_EXT.test(candidate),
    )
    if (hit) return hit
  }
  return ''
}

/**
 * **保证 id 唯一**（对账 #508 的真 bug）。
 *
 * README 型来源的编号会在不同分区里重来（YouMind 那份 README 有多个
 * `### No. N:` 分组，每组从 1 开始），直接拿编号当 id 会产生重复 key：
 * React 的 reconciliation 遇到重复 key 会把旧卡片留在 DOM 里、再把新卡片接在后面，
 * 表现成「点了来源、计数变了，右侧卡片不换」（实测 grid children 24 → 33 → 39）。
 *
 * 规则：**首次出现的 id 原样保留，重复的追加 `-2` / `-3`** —— 既有单测/收藏记录的
 * 主键（如 `gpt-image-2:544`）不动，只给撞车的后续条目一个稳定后缀。
 */
export function dedupeIds(cases: InspirationCase[]): InspirationCase[] {
  const seen = new Map<string, number>()
  return cases.map((c) => {
    const n = (seen.get(c.id) ?? 0) + 1
    seen.set(c.id, n)
    return n === 1 ? c : { ...c, id: `${c.id}-${n}` }
  })
}

/**
 * 把来源的数据文件解析成统一案例。
 *
 * JSON 型来源目前认两种顶层形状：`{ cases: [...] }` 与**顶层数组**（见下方分派）。
 * **解析不出来就返回空数组，不抛** —— 一个来源挂了不该让整页打不开，
 * 界面按"这个来源这次没取到"如实说明。
 */
export function parseInspirationCases(
  raw: unknown,
  source: InspirationSource,
): InspirationCase[] {
  /**
   * JSON 型来源其实有**两种顶层形状**，都由 `format: 'json'` 走到这里：
   *
   * - `{ cases: [...] }` —— freestylefly 那家；
   * - **顶层就是一个数组** —— `banana-prompt-quicker` 的 `prompts.json`
   *   （323 条，字段是 `title` / `prompt` / `preview` / `author` / `category`）。
   *
   * 判据取**形状**而不是来源名：以后再有同形状的仓库，加一条配置就能用。
   */
  if (Array.isArray(raw)) return dedupeIds(parseFlatJsonCases(raw, source))

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
    const videoUrl = videoUrlOf(r.video, r.videoUrl, r.video_url, r.previewVideo)
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
      ...(videoUrl ? { videoUrl } : {}),
      modelCategory: source.modelCategory,
      kind: source.kind,
    })
  }
  return dedupeIds(out)
}

/**
 * 顶层数组形状的 JSON（`banana-prompt-quicker` 那种）。
 *
 * 与 `{ cases }` 那条的区别只有字段名：这里标题叫 `title`、图叫 `preview`、
 * 作者叫 `author`、标签来自 `category` / `sub_category`。**没有 id 就用出现顺序补** ——
 * 与 README 那条同一口径。
 */
function parseFlatJsonCases(
  rows: readonly unknown[],
  source: InspirationSource,
): InspirationCase[] {
  const out: InspirationCase[] = []
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>
    const prompt = str(r.prompt)
    const title = str(r.title) || prompt.slice(0, 40)
    if (!prompt && !title) continue

    /** 预览图优先；没有预览就退回第一张参考图（有图总比空着强） */
    const refs = strList(r.reference_image_urls)
    const image = str(r.preview) || refs[0] || ''
    const author = str(r.author)
    const videoUrl = videoUrlOf(r.video, r.videoUrl, r.video_url, r.previewVideo)

    out.push({
      id: `${source.id}:${str(r.id) || out.length + 1}`,
      sourceId: source.id,
      sourceName: source.name,
      title,
      prompt,
      imageUrl: image,
      tags: [...new Set([str(r.category), str(r.sub_category)].filter(Boolean))],
      ...(author ? { credit: author } : {}),
      docUrl: source.repo,
      modelCategory: source.modelCategory,
      kind: source.kind,
      ...(videoUrl ? { videoUrl } : {}),
    })
  }
  return dedupeIds(out)
}

export interface InspirationFilter {
  /** 关键字：命中标题 / 提示词 / 标签 / 署名，大小写不敏感 */
  query?: string
  /** 来源筛选（null / 不传 = 全部来源） */
  sourceId?: string | null
  /** 模型分类筛选（null / 不传 = 全部模型） */
  modelCategory?: string | null
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
interface ReadmeRules {
  /** 案例分节：**必须捕获序号**（用它当 id 后缀，也是"这是不是一个案例"的判据） */
  section: RegExp
  /** 从分节里取标题：**第一个捕获组**是标题，可选的第二个是原出处链接 */
  title: RegExp
  /** 提示词分区标记：取它**之后**的第一个代码块 */
  promptAt: RegExp
  /**
   * 图片分区标记。**不给就在整段里找第一个图** ——
   * YouMind 那种必须给：它在正文开头挂了一排 shields.io 的徽章图，
   * 取整段第一个会拿到徽章（本轮实测踩到）。
   */
  imageAt?: RegExp
  /** 署名（如 `@someone`） */
  credit?: RegExp
}

const README_RULES: Record<ReadmeStyle, ReadmeRules> = {
  /**
   * PicoTrex：`### 例 1: [标题](原推文)（by [@作者](主页)）`
   * + `**提示词:**` + 表格里的一张 `<img>`。
   */
  pico: {
    section: /^###\s+例\s*(\d+)\s*[:：]\s*/m,
    title: /^###\s+例\s*\d+\s*[:：]\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)/m,
    promptAt: /\*\*提示词\s*[:：]?\s*\*\*/,
    credit: /by\s*\[?(@[^\]\s]+)\]?/,
  },
  /**
   * YouMind 三家共用：`### No. 1: 标题` + `#### 📝 Prompt`（代码块）
   * + `#### 🖼️ Generated Images` 下的 `<img>`（**绝对地址，托管在 cms-assets**）。
   */
  youmind: {
    /**
     * ⚠️ 层级放宽到 `##`–`####`：这三家的版式**并不完全一致** ——
     * Seedance 那家用的是 `## No. N:`（比另外两家浅一层）。
     * 只认 `###` 时那家 384 KB 的 README 只解析出 6 条（实测踩到）。
     */
    section: /^#{2,4}\s+No\.\s*(\d+)\s*[:：]\s*/m,
    title: /^#{2,4}\s+No\.\s*\d+\s*[:：]\s*(.+)$/m,
    promptAt: /####\s*📝\s*Prompt/,
    imageAt: /####\s*🖼/,
  },
  /**
   * Seedance 那家：**两段格式并存**。前 6 条是 `### No. N:`（Featured），
   * 后面 `## 🎬 All Prompts` 下还有一百多条**纯 `### 标题`**（没有编号）。
   *
   * 所以规则是「**三级标题都算一条案例**」，编号交给解析器按出现顺序补 ——
   * 分别写两条规则反而要在同一份文件里跑两遍、再去重，得不偿失。
   */
  youmindAll: {
    section: /^###\s+(.+)$/m,
    /** 标题里的 `No. N: ` 前缀有就剥掉、没有就用整行 */
    title: /^###\s+(?:No\.\s*\d+\s*[:：]\s*)?(.+)$/m,
    promptAt: /####\s*📝\s*Prompt/,
  },
}

export function parseReadmeCases(
  md: string,
  source: InspirationSource,
  style: ReadmeStyle = source.readmeStyle ?? 'pico',
): InspirationCase[] {
  if (typeof md !== 'string' || !md) return []
  const rules = README_RULES[style]
  const out: InspirationCase[] = []

  /**
   * 按**规则里的分节头**切开（第一个前言块没有分节头，自然跳过）。
   *
   * 不能写死 `\n(?=### )`：层级宽松的版式（YouMind 那三家）用 `##` 开头，
   * 写死就切不开、一条都提不出来。带上 `m` 让 `^` 在 `(?=)` 里按行首匹配。
   */
  const splitter = new RegExp(`\\n(?=${rules.section.source})`, 'm')
  for (const block of md.split(splitter)) {
    const head = rules.section.exec(block)
    /** 不是案例分节（Menu / Statistics / 更新日志那类）不要 —— 它们没有案例内容 */
    if (!head) continue
    /**
     * 编号：有的版式写在标题里（`例 1` / `No. 1`），有的完全没有（Seedance 的 All Prompts）。
     * 后者按**出现顺序**补一个 —— id 只要在同一来源里稳定且唯一就够了。
     */
    const raw = (head[1] ?? '').trim()
    const num = /^\d+$/.test(raw) ? raw : String(out.length + 1)

    const titleMatch = rules.title.exec(block)
    const title = (titleMatch?.[1] ?? '').trim()
    const creditUrl = titleMatch?.[2]
    const credit = rules.credit?.exec(block)?.[1].trim()

    const promptSection = block.split(rules.promptAt)[1] ?? block
    const prompt = /```[a-zA-Z]*\r?\n([\s\S]*?)```/.exec(promptSection)?.[1]?.trim() ?? ''

    const imageSection = rules.imageAt ? (block.split(rules.imageAt)[1] ?? '') : block
    const image = /<img\s+[^>]*src="([^"]+)"/i.exec(imageSection)?.[1] ?? ''
    const videoHref = /href=["']([^"']+\.(?:mp4|webm|mov)(?:\?[^"']*)?)["']/i.exec(block)?.[1] ?? ''

    if (!title && !prompt) continue

    out.push({
      id: `${source.id}:${num}`,
      sourceId: source.id,
      sourceName: source.name,
      title,
      prompt,
      imageUrl: !image
        ? ''
        : image.startsWith('http')
          ? image
          : /** 没有基址就**别拼**：拼出来是一条死链（YouMind 的图全在自家 CMS 上，走绝对地址） */
            source.imageBase
            ? `${source.imageBase}/${image.replace(/^\.?\//, '')}`
            : '',
      /** README 型来源没有结构化的标签，如实留空（不拿标题硬凑几个） */
      tags: [],
      ...(credit ? { credit } : {}),
      ...(creditUrl ? { creditUrl } : {}),
      /** README 里没有"仓库内位置"这种锚点，给仓库首页即可 */
      docUrl: source.repo,
      modelCategory: source.modelCategory,
      kind: source.kind,
      ...(videoHref ? { videoUrl: videoHref } : {}),
    })
  }
  return dedupeIds(out)
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
    if (filter.modelCategory && c.modelCategory !== filter.modelCategory) return false
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
