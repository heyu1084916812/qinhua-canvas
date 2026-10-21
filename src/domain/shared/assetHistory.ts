import {
  assetKindOf,
  byteLengthOf,
  normalizeMetaString,
  normalizeTag,
  sameTag,
  type LibraryAssetRowLike,
  type SnapshotRunRecordLike,
} from './assetLibrary'

/**
 * 「我的素材」页的**全部生成历史**（用户 2026-10-06 第 8 条 + 同日答复）。
 *
 * ## 与素材库的分工
 *
 * - `assetLibrary` = 用户**手动收藏**过的（他点头留下的）；
 * - **生成历史** = `runRecords` 里所有跑过的：**含未收藏**（用户原话如此），
 *   也含**失败的**（参考图左侧"生成失败 3"那一档）。
 *
 * 两者在同一个页面里以两个页签并排（参考图五），筛选条件共用一份。
 *
 * ## 为什么失败记录也算"一条历史"
 *
 * 失败没有产物、没有 hash，但它**占用了用户一次等待**，而且原因常常是他要看的
 * （提示词被拦、渠道超时、余额不足）。把它从列表里抹掉，用户只会看到"我明明点了八次，
 * 历史里只有五张"。所以失败单独成一种条目（`kind: 'failed'`），
 * 卡片上给提示词与时间，没有图就不摆图。
 */

/** 历史里一条**有产物**的记录 */
export interface HistoryOutput {
  kind: 'output'
  hash: string
  mime: string
  bytes: number
  width?: number
  height?: number
  /** 产出时间（运行记录的 `createdAt`）—— 历史按它倒序，收藏时间不参与 */
  createdAt: number
  /** 这张有没有被收藏（决定卡片上的收藏态与"收藏内容"筛选） */
  saved: boolean
  prompt?: string
  model?: string
  channelId?: string
  ratio?: string
  quality?: string
  projectId?: string
  /** 来源项目名（参考图里卡片下方那个小标签，如"画布"） */
  projectName?: string
  /**
   * 用户给这张打的标签（对账 #303）。
   *
   * 历史条目本身**不存**标签 —— 标签挂在收藏关系（`assetLibrary` 行）上，
   * 这里是调用方按 hash 拼进来的**镜像**（见 `assetLibraryStore.load`）。
   * 没收藏的条目永远没有标签，这是对的：先收藏才能整理。
   */
  tags?: string[]
}

/** 历史里一条**失败**的记录（没有产物） */
export interface HistoryFailure {
  kind: 'failed'
  /** 主键用运行记录 id —— 失败没有素材 hash 可用 */
  id: string
  createdAt: number
  prompt?: string
  model?: string
  ratio?: string
  quality?: string
  projectId?: string
  projectName?: string
}

export type HistoryItem = HistoryOutput | HistoryFailure

/** 素材类型分档（参考图顶部那排：全部 / 图 / 视频 / 音频） */
export type HistoryKind = 'all' | 'image' | 'video' | 'audio'

/** 左侧"快速筛选"（参考图那一栏） */
export type QuickFilter = 'all' | 'saved' | 'recent' | 'failed'

/** 「最近 7 天」的天数（参考图左侧那一档） */
export const RECENT_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sizePair(w: unknown, h: unknown): { width: number; height: number } | undefined {
  const width = asNumber(w)
  const height = asNumber(h)
  return width && height ? { width, height } : undefined
}

/** 音频也算一类（参考图里"音频 0"就在那排里）；`assetKindOf` 只认图/视频，故这里另开一档 */
export function historyKindOf(mime: string | undefined | null): HistoryKind {
  const m = mime ?? ''
  if (m.startsWith('audio/')) return 'audio'
  const kind = assetKindOf(m)
  return kind === 'image' || kind === 'video' ? kind : 'audio'
}

export interface BuildHistoryArgs {
  /** `runRecords` 表的全部行（画布 + 任何工作台的都算） */
  runs: readonly SnapshotRunRecordLike[]
  /** `assets` 内容行 —— 提供 mime / 字节 / 真实像素 */
  assets: readonly LibraryAssetRowLike[]
  /** `assetLibrary` 里已收藏的 hash（只用来打 `saved` 标记，不参与增删） */
  savedHashes: readonly string[]
  /** `projects` 行，用来把 projectId 翻成名字 */
  projects: readonly { id?: unknown; name?: unknown }[]
  /** 注入"现在"，保证纯函数可测 */
  now?: number
  /**
   * 是否为素材页生成失败条目。底层 RunRecord 始终保留；素材页按用户确认只展示
   * 有产物的历史，默认值仍为 true，避免影响其他调用方与既有领域测试。
   */
  includeFailures?: boolean
}

/**
 * 把三张表拼成"全部生成历史"。
 *
 * 三条刻意的口径：
 * 1. **按产物展开**：一条记录产出 4 张就是 4 条历史（用户看的是图，不是"一次任务"）；
 * 2. **同 hash 只留最新**：渠道重试 / 重复保存会得到同一份字节，列两遍只会让人以为生成过两次；
 * 3. **缺素材行也照样列出**（带 `bytes: 0` / 缺尺寸）：记录在、字节没了，这本身是要让用户看见的事实
 *    —— 悄悄跳过等于"我生成过的图凭空消失了"。
 */
export function buildHistory(args: BuildHistoryArgs): HistoryItem[] {
  const assetByHash = new Map<string, LibraryAssetRowLike>()
  for (const row of args.assets) {
    const hash = normalizeMetaString(row.hash ?? row.id)
    if (hash) assetByHash.set(hash, row)
  }
  const saved = new Set(args.savedHashes)
  const projectNameOf = new Map<string, string>()
  for (const p of args.projects) {
    const id = normalizeMetaString(p.id)
    const name = normalizeMetaString(p.name)
    if (id && name) projectNameOf.set(id, name)
  }

  const outputs = new Map<string, HistoryOutput>()
  const failures: HistoryFailure[] = []

  for (const run of args.runs) {
    const createdAt = asNumber(run.createdAt) ?? 0
    const projectId = normalizeMetaString(run.projectId)
    const params = asRecord(run.params)
    const prompt = normalizeMetaString(params?.prompt)
    const model = normalizeMetaString(run.sentModel) ?? normalizeMetaString(params?.model)
    const ratio = normalizeMetaString(params?.ratio)
    const quality = normalizeMetaString(params?.quality)
    const channelId = normalizeMetaString(run.sentChannelId) ?? normalizeMetaString(params?.channelId)
    const projectName = projectId ? projectNameOf.get(projectId) : undefined
    const hashes = Array.isArray(run.outputHashes)
      ? run.outputHashes.filter((h): h is string => typeof h === 'string' && h.length > 0)
      : []

    if (hashes.length === 0) {
      if (args.includeFailures === false) continue
      /** 没有产物 = 失败（或还没回来的排队记录；两者对用户是同一件事：这次没出图） */
      failures.push({
        kind: 'failed',
        id: normalizeMetaString(asRecord(run)?.id) ?? `${createdAt}`,
        createdAt,
        prompt,
        model,
        ratio,
        quality,
        projectId,
        projectName,
      })
      continue
    }

    for (const hash of hashes) {
      const row = assetByHash.get(hash)
      const size = sizePair(run.outputWidth, run.outputHeight) ?? sizePair(row?.width, row?.height)
      const item: HistoryOutput = {
        kind: 'output',
        hash,
        mime: normalizeMetaString(row?.mime) ?? 'application/octet-stream',
        bytes: byteLengthOf(row?.bytes),
        width: size?.width,
        height: size?.height,
        createdAt,
        saved: saved.has(hash),
        prompt,
        model,
        channelId,
        ratio,
        quality,
        projectId,
        projectName,
      }
      const prev = outputs.get(hash)
      if (!prev || item.createdAt >= prev.createdAt) outputs.set(hash, item)
    }
  }

  /** 失败条目也去重：同一条记录反复写库（重试 / 补写）时只留最新那次 */
  const uniqueFailures = new Map<string, HistoryFailure>()
  for (const f of failures) {
    const prev = uniqueFailures.get(f.id)
    if (!prev || f.createdAt >= prev.createdAt) uniqueFailures.set(f.id, f)
  }

  return [...outputs.values(), ...uniqueFailures.values()].sort(
    (a, b) => b.createdAt - a.createdAt || itemKey(a).localeCompare(itemKey(b)),
  )
}

function itemKey(item: HistoryItem): string {
  return item.kind === 'output' ? item.hash : item.id
}

export interface HistoryQuery {
  query: string
  kind: HistoryKind
  quick: QuickFilter
  /** 模型分组里点中的那一档；`null` = 不限 */
  model: string | null
  /** 只看带这个标签的（`null` / 空 = 不限）。对账 #303：与素材库同一套筛选条件 */
  tag?: string | null
  now: number
}

/**
 * 关键字 + 类型 + 快捷 + 模型，四者**同时生效**（参考图里它们是并排的控件，
 * 不是一个替换另一个）。可搜字段与素材库同口径：提示词 / 模型 / 质量 / 比例 / mime / 像素 / 项目名。
 */
export function filterHistory(items: readonly HistoryItem[], q: HistoryQuery): HistoryItem[] {
  const text = q.query.trim().toLowerCase()
  const recentFrom = q.now - RECENT_DAYS * DAY_MS
  const wantedTag = normalizeTag(q.tag)
  return items.filter((item) => {
    if (q.quick === 'saved' && !(item.kind === 'output' && item.saved)) return false
    if (q.quick === 'failed' && item.kind !== 'failed') return false
    if (q.quick === 'recent' && item.createdAt < recentFrom) return false
    if (q.kind !== 'all') {
      /** 失败条目没有素材类型 —— 只在"全部"那一档里出现（按类型筛图时它不该混进来） */
      if (item.kind !== 'output' || historyKindOf(item.mime) !== q.kind) return false
    }
    if (q.model && (item.model ?? '') !== q.model) return false
    /**
     * 标签筛选：**失败条目永远不匹配**（它没有产物、更没收藏，也就没有标签）。
     * 这一条与"按类型筛图时失败条目不该混进来"同一条口径。
     */
    if (wantedTag) {
      if (item.kind !== 'output') return false
      if (!(item.tags ?? []).some((t) => sameTag(t, wantedTag))) return false
    }
    if (!text) return true
    const haystack = [
      item.prompt,
      item.model,
      item.ratio,
      item.quality,
      item.projectName,
      item.kind === 'output' ? (item.tags ?? []).join(' ') : '',
      item.kind === 'output' ? item.mime : '',
      item.kind === 'output' && item.width && item.height ? `${item.width}×${item.height}` : '',
    ]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase()
    return haystack.includes(text)
  })
}

export interface HistoryCounts {
  all: number
  image: number
  video: number
  audio: number
  saved: number
  recent: number
  failed: number
}

/** 顶部那排数字与左侧"快速筛选"的计数 —— 都是**对全量**算的（不受当前筛选影响） */
export function countHistory(items: readonly HistoryItem[], now: number): HistoryCounts {
  const recentFrom = now - RECENT_DAYS * DAY_MS
  const counts: HistoryCounts = { all: items.length, image: 0, video: 0, audio: 0, saved: 0, recent: 0, failed: 0 }
  for (const item of items) {
    if (item.createdAt >= recentFrom) counts.recent += 1
    if (item.kind === 'failed') {
      counts.failed += 1
      continue
    }
    counts[historyKindOf(item.mime)] += 1
    if (item.saved) counts.saved += 1
  }
  return counts
}

/** 素材库里那一行，计数时只用到这几个字段（故意宽松：`assetLibrary` 的行结构可能演进） */
export interface LibraryCountRow {
  hash?: unknown
  id?: unknown
  mime?: unknown
  savedAt?: unknown
  createdAt?: unknown
}

/**
 * **整个库**的计数：生成历史 ∪ 素材库，按素材 hash 去重（用户 2026-10-06 第 11 批第 5 条）。
 *
 * ## 为什么不再只用 `countHistory`
 *
 * 用户报的是「明明有图，但是有些数字还是 0」：图里**素材库有 1 张、全部历史 0**，
 * 于是顶部"全部 / 图 / 视频 / 音频"和左侧"全部素材 / 收藏内容 / 最近 7 天"**全是 0**。
 * 根因是那些数字**只统计生成历史**（`runRecords`），而素材库里那些
 * 「手动收藏的」和「上传/导入保存进来的」是另一份列表 —— 它们没有生成记录，
 * 于是一张都没被算上。
 *
 * 用户确认的口径：**「生成历史没用收藏的算全部素材，整个库的全量」**。于是：
 *
 * - `all` / `image` / `video` / `audio` = 两份列表的**并集**（同 hash 只算一次，
 *   取更晚的那个时间 —— 它决定这条算不算"最近 7 天"）；
 * - `saved` = 素材库里去重后的条数（"收藏内容"就是它）；
 * - `failed` = 失败的生成记录数（素材库里没有这一档）；
 * - `recent` = 并集里 7 天内的。
 *
 * 仍然是"**不随当前筛选跳**"的全量口径（那是 #264 定下的，没变）。
 */
export function countAssets(
  items: readonly HistoryItem[],
  library: readonly LibraryCountRow[],
  now: number,
): HistoryCounts {
  const recentFrom = now - RECENT_DAYS * DAY_MS
  /** hash → { 类型, 时间 }。时间取两份来源里**更晚**的那个 */
  const seen = new Map<string, { kind: HistoryKind; at: number }>()
  const savedHashes = new Set<string>()
  let failed = 0

  for (const item of items) {
    if (item.kind === 'failed') {
      failed += 1
      continue
    }
    const prev = seen.get(item.hash)
    seen.set(item.hash, {
      kind: historyKindOf(item.mime),
      at: Math.max(prev?.at ?? 0, item.createdAt),
    })
  }

  for (const row of library) {
    const hash = normalizeMetaString(row.hash ?? row.id)
    if (!hash) continue
    savedHashes.add(hash)
    const at = asNumber(row.savedAt) ?? asNumber(row.createdAt) ?? 0
    const prev = seen.get(hash)
    if (!prev) {
      seen.set(hash, { kind: historyKindOf(normalizeMetaString(row.mime)), at })
      continue
    }
    /* 两边都有：兜底换类型（同一份字节被标成别类型的极端情况），时间取更晚的 */
    seen.set(hash, {
      kind: prev.kind === 'audio' ? prev.kind : historyKindOf(normalizeMetaString(row.mime)),
      at: Math.max(prev.at, at),
    })
  }

  const counts: HistoryCounts = {
    all: seen.size,
    image: 0,
    video: 0,
    audio: 0,
    saved: savedHashes.size,
    recent: 0,
    failed,
  }
  for (const { kind, at } of seen.values()) {
    counts[kind] += 1
    if (at >= recentFrom) counts.recent += 1
  }
  return counts
}

export interface HistoryGroup {
  key: string
  label: string
  items: HistoryItem[]
}

/**
 * 分组方式。
 *
 * ⚠️ 原有的 `'model'` 档已按用户口径**移除**（2026-10-14：「分组方式砍成两档」）——
 * 它与左侧「模型生成分组」那一栏是同一个入口的两种形态，同时摆着只是让用户多想一步。
 * **要恢复的话改三处**：把 `'model'` 加回这里、恢复 `groupHistory` 的 model 分支、
 * 再把 `AssetsPage.GROUP_MODES` 那一档加回来。
 */
export type GroupMode = 'date' | 'none'

/** 日期分组的标题（参考图那种：今天 / 昨天 / 具体日期） */
export function dateLabelOf(at: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  }
  const diffDays = Math.round((day(now) - day(at)) / DAY_MS)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  const d = new Date(at)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * 分组：日期，或不分组。
 *
 * - **日期**按时间倒序，组内也倒序（用户找的是"刚才那张"）；
 * - **不分组**（`none`）把整份列表放进一个匿名组 —— 调用方靠 `label === ''` 不画组标题。
 */
export function groupHistory(items: readonly HistoryItem[], mode: GroupMode, now: number): HistoryGroup[] {
  if (mode === 'none') return items.length > 0 ? [{ key: 'all', label: '', items: [...items] }] : []

  const groups = new Map<string, HistoryItem[]>()
  for (const item of items) {
    const key = dateLabelOf(item.createdAt, now)
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }

  const out = [...groups.entries()].map(([key, groupItems]) => ({
    key,
    label: key,
    items: groupItems,
  }))

  /** 日期组按最新那张的时间排（组内已按 createdAt 倒序） */
  return out.sort((a, b) => (b.items[0]?.createdAt ?? 0) - (a.items[0]?.createdAt ?? 0))
}

/** "模型生成分组"那一栏：模型 → 张数（只统计有产物的） */
export function modelCounts(items: readonly HistoryItem[]): { model: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.kind !== 'output') continue
    const model = item.model ?? '未知模型'
    counts.set(model, (counts.get(model) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
}
