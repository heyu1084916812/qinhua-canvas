import { createId } from '../../shared/id'
import { extractJsonBlock } from './jsonBlock'
import type { StoryboardDoc, StoryboardEpisode } from './storyboard'

/**
 * **小说 → 集**（对账 #417；调研稿 §3.1 / M7-2）。
 *
 * 分工是刻意的：**切分点由结构决定，模型只负责起名与写梗概**。
 *
 * - 为什么不让模型切分：让它回"第几段到第几段"等于让它数字符 —— 它数不准，
 *   而错一位就是"这一集的原文范围从中间断了"，溯源全废。切分用确定性规则，
 *   错了能重算、能单测。
 * - 模型的价值在 `title` / `summary` / 两个钩子（调研稿 §3.1：「合理的集」的可操作定义）。
 *   它不听话（条数不对、不是 JSON）时**回落结构标题**，而不是把坏数据写进库。
 *
 * 三层降级抄的是 novelcut（调研稿 §3.1 的 ⭐ 那条）：**章节标记 → 字数兜底 → 分批防超时**。
 */

/** 无标记时每集的目标字数（novelcut 的 3000 / 1500 兜底档，这里取 1500） */
export const DEFAULT_EPISODE_CHARS = 1500
/** 一次交给模型多少集（§3.1：>5 集分批，防长上下文超时） */
export const SPLIT_BATCH_SIZE = 5
/** 拆集用的识别标记（进的是**真实提示词**，离线 mock 也按它认路） */
export const SPLIT_MARKER = '【拆集】'
/** 一次最多切多少集（防一篇 30 万字的小说切出 200+ 集把界面塞死） */
export const MAX_EPISODES = 200
/** 每段送给模型看的开头字数（起名 / 写梗概不必读全文） */
const ENRICH_EXCERPT_CHARS = 400
/** 第一个标题之前的文字超过这么多字就单列「开篇」 */
const PREAMBLE_MIN_CHARS = 50
/** 标题行长度上限：超过就当正文（避免把「第 1 章讲的是……」这种长句当标题） */
const HEADING_MAX_CHARS = 60

/**
 * 章节标记（调研稿 §3.1 说的 10+ 模式）。只认**整行**、且行不太长。
 * 中文数字与阿拉伯数字都要认：「第一章」「第 12 章」「第十二回」「楔子」「序章」「Chapter 3」。
 */
const HEADING =
  /^(?:#{1,3}\s+|第\s*[0-9一二三四五六七八九十百千零两]+\s*[章节回话卷篇幕]|楔子|序章|序言|前言|引子|尾声|后记|Chapter\s+[0-9IVXLC]+|[0-9]{1,4}[、.．]\s*)/i

export interface SourceChunk {
  /** 结构切分给的默认标题（章节标题本身，或「第 N 集」） */
  title: string
  /** 原文里的字符区间（左闭右开） */
  from: number
  to: number
  /** 送给模型看的开头摘录（不进库） */
  excerpt: string
}

function excerptOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, ENRICH_EXCERPT_CHARS)
}

/** 句末标点：按长度切时优先落在这里，别把一句话劈成两半 */
const BOUNDARY = /[。！？!?；;\n]/g

/** 第二层：无标记时按目标字数切（切点尽量落在句末标点上） */
function splitByLength(source: string, target: number): SourceChunk[] {
  const chunks: SourceChunk[] = []
  let start = 0
  while (start < source.length && chunks.length < MAX_EPISODES) {
    let end = Math.min(source.length, start + target)
    if (end < source.length) {
      const floor = start + Math.floor(target * 0.5)
      const window = source.slice(floor, end)
      let cut = -1
      for (const m of window.matchAll(BOUNDARY)) {
        if (typeof m.index === 'number') cut = m.index
      }
      if (cut >= 0) end = floor + cut + 1
    }
    if (end <= start) end = Math.min(source.length, start + target)
    chunks.push({
      title: `第 ${chunks.length + 1} 集`,
      from: start,
      to: end,
      excerpt: excerptOf(source.slice(start, end)),
    })
    start = end
  }
  /** 到上限还没切完：把剩下的并进最后一集（宁可长一点，也不产生第 201 集） */
  const last = chunks[chunks.length - 1]
  if (last && last.to < source.length) {
    chunks[chunks.length - 1] = {
      ...last,
      to: source.length,
      excerpt: excerptOf(source.slice(last.from)),
    }
  }
  return chunks.filter((c) => source.slice(c.from, c.to).trim().length > 0)
}

/**
 * **切分**（第一、二层）：有 ≥2 个章节标记就按标记切，否则按字数兜底。
 *
 * 返回的 `from` / `to` 是**原文的字符偏移**，不是行号 —— 下游要拿它去 `slice` 原文。
 */
export function splitSource(text: string, opts: { targetChars?: number } = {}): SourceChunk[] {
  const source = (text ?? '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return []
  const target = Math.max(200, Math.floor(opts.targetChars ?? DEFAULT_EPISODE_CHARS))
  const lines = source.split('\n')
  const offsets: number[] = []
  let at = 0
  for (const line of lines) {
    offsets.push(at)
    at += line.length + 1
  }
  const heads: number[] = []
  lines.forEach((line, i) => {
    const t = line.trim()
    if (!t || t.length > HEADING_MAX_CHARS) return
    if (HEADING.test(t)) heads.push(i)
  })
  /* 只有 0 或 1 个标记行：不足以当目录，走字数兜底（1 个也可能是正文里的「第一章」引用） */
  if (heads.length < 2) return splitByLength(source, target)
  const chunks: SourceChunk[] = []
  heads.forEach((lineIdx, i) => {
    const next = i + 1 < heads.length ? heads[i + 1]! : lines.length
    const from = offsets[lineIdx]!
    /**
     * `to` 取**下一个标题行的起点**（含两个标题之间的那个换行）。
     *
     * 少取这一个字符，各集的范围就不再是"恰好拼回全文"：中间会留下没人认领的换行。
     * 溯源的东西要能一眼验证（份额相加 = 全文），差一个字符就得让每个消费方各写一遍
     * 容差判断 —— 而 `slice` 出来的那点尾换行，消费方 `trim()` 一下就没了。
     */
    const to = next >= lines.length ? source.length : offsets[next]!
    if (to <= from) return
    const title = lines[lineIdx]!.trim().replace(/^#{1,3}\s*/, '').slice(0, 40)
    chunks.push({
      title: title || `第 ${i + 1} 集`,
      from,
      to,
      excerpt: excerptOf(source.slice(from, to)),
    })
  })
  /**
   * 第一个标题之前那段：够长就单列「开篇」（很多小说前面就是楔子 / 设定），
   * 只有一两行就并进第一集 —— 不值得为它单开一集。
   */
  const preEnd = offsets[heads[0]!]!
  const pre = source.slice(0, preEnd)
  const first = chunks[0]
  if (first && pre.trim()) {
    if (pre.trim().length >= PREAMBLE_MIN_CHARS) {
      chunks.unshift({ title: '开篇', from: 0, to: preEnd, excerpt: excerptOf(pre) })
    } else {
      chunks[0] = { ...first, from: 0, excerpt: excerptOf(source.slice(0, first.to)) }
    }
  }
  return chunks
}

/**
 * **第三层：分批**（§3.1：>5 集每批 5 集）。
 *
 * 纯函数、单独可测：批次怎么分决定了模型看到什么上下文，
 * 而"一次 60 集"正是长上下文超时的来源。
 */
export function planSplitBatches(
  chunks: readonly SourceChunk[],
  size = SPLIT_BATCH_SIZE,
): SourceChunk[][] {
  const step = Math.max(1, Math.floor(size))
  const out: SourceChunk[][] = []
  for (let i = 0; i < chunks.length; i += step) out.push(chunks.slice(i, i + step))
  return out
}

/** 拆集的系统指令（含契约）。技能正文与它拼在一起由页面决定（本函数只管契约） */
export function buildSplitSystem(): string {
  return `你是一名短剧策划，负责把小说原文切成"集"，并给每一集写标题与钩子。

${SPLIT_MARKER}输出契约（必须严格遵守）
1. 只输出一个 JSON 对象，不要解释、不要客套；可以用 \`\`\`json 代码块包住。
2. 结构固定为：{"episodes":[{"title":"集名","summary":"本集梗概","hookOpen":"开场钩子","hookEnd":"结尾钩子"}]}
3. **条数与顺序必须与用户给的段落完全一致**：不许合并、不许拆分、不许漏、不许改顺序。
4. title 不超过 20 字；summary 40–120 字；两个钩子各一句话，看不出来就留空字符串。
5. 不要编造原文里没有的人物与事件。`
}

/** 一批段落 → 用户消息（带编号，模型才知道"一共几段、现在第几批"） */
export function buildSplitText(
  batch: readonly SourceChunk[],
  batchIndex = 0,
  totalBatches = 1,
): string {
  const lines = [
    `这是第 ${batchIndex + 1}/${totalBatches} 批，共 ${batch.length} 段。请按顺序给每一段写标题、梗概与两个钩子。`,
  ]
  batch.forEach((c, i) => {
    lines.push(`【第 ${i + 1} 段】结构标题：${c.title}`)
    lines.push(c.excerpt)
  })
  return lines.join('\n')
}

/** 每一集的富化结果（模型给的；空串 = 这一项回落结构值） */
export interface EpisodeEnrichment {
  title: string
  summary: string
  hookOpen: string
  hookEnd: string
}

/**
 * 解析一批的富化结果。
 *
 * **条数必须完全对得上**（契约第 3 条）：少一条就整批回落 ——
 * 硬把 5 条对到 6 段上，会让标题从某一集开始**整体错位**，那比没有标题坏得多。
 */
export function parseSplitReply(raw: string, expected: number): EpisodeEnrichment[] | null {
  if (expected <= 0) return null
  const json = extractJsonBlock(raw)
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { episodes?: unknown }).episodes)
      ? (json as { episodes: unknown[] }).episodes
      : null
  if (!list || list.length !== expected) return null
  const out: EpisodeEnrichment[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
    out.push({
      title: str(row.title),
      summary: str(row.summary),
      hookOpen: str(row.hookOpen),
      hookEnd: str(row.hookEnd),
    })
  }
  /* 一整批全是空的：当失败处理（免得"看起来富化过了"，其实一个字没来） */
  return out.some((e) => e.title || e.summary || e.hookOpen || e.hookEnd) ? out : null
}

/**
 * 把切好的段落落成**分集表**。
 *
 * ⚠️ 这是**替换**：集换了，旧镜头就没了归属 —— 所以 `shots` 一起清空。
 * 界面用两下确认把"会替换 N 集（含 M 个镜头）"说在前面（对账 #417）。
 */
export function applySplit(
  doc: StoryboardDoc,
  chunks: readonly SourceChunk[],
  enrichment?: readonly EpisodeEnrichment[] | null,
  now = 0,
): StoryboardDoc {
  const episodes: StoryboardEpisode[] = chunks.map((c, i) => {
    const e = enrichment?.[i]
    return {
      id: createId('ep'),
      title: e?.title || c.title,
      summary: e?.summary ?? '',
      sourceRange: { from: c.from, to: c.to },
      ...(e?.hookOpen ? { hookOpen: e.hookOpen } : {}),
      ...(e?.hookEnd ? { hookEnd: e.hookEnd } : {}),
    }
  })
  return { ...doc, episodes, shots: [], updatedAt: now }
}

/**
 * 这一集对应的原文片段（有范围才切；越界当空）。
 *
 * 拆镜（#414）优先喂它、而不是整份剧本正文：拆集之后，每一集只该看到自己那一段 ——
 * 拿全篇去拆某一集，模型会把别集的角色写进来（这正是"溯源"的用处）。
 */
export function episodeSourceText(doc: StoryboardDoc, episode: StoryboardEpisode): string {
  const range = episode.sourceRange
  if (!range) return ''
  if (range.from < 0 || range.to <= range.from || range.from >= doc.sourceText.length) return ''
  return doc.sourceText.slice(range.from, Math.min(range.to, doc.sourceText.length))
}
