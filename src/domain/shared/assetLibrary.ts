/**
 * 素材库（`/assets`）的领域口径。
 *
 * `assets` 表是**内容仓库**：内容哈希为主键，保存字节与真实尺寸。
 * `/assets` 则是**用户手动收藏**：只有被用户从生成节点里主动保存过的素材才会出现。
 * 收藏关系与保存当时冻结的元数据存独立的 `assetLibrary` 表，绝不混进 `assets`
 * 的语义，也不随节点改动回写。
 *
 * 纯函数：不读时间、不查库，全部由调用方注入（可单测）。
 */

/** 缺失字段的统一显示值（`auto` / 空串也按缺失处理） */
export const MISSING = '—'

/**
 * 标签的两个上限（对账 #303）。
 *
 * 为什么要上限：标签是**给人扫的**，不是给人堆的 —— 一个素材挂 40 个标签，
 * 它在筛选栏里就变成噪音，最后谁也不用。上限到了就**如实拒绝**（返回 `full`），
 * 不静默丢弃用户刚输入的那个词（那等于"我打了没反应"）。
 */
export const MAX_TAGS = 12
/** 单个标签的字符上限（够写"客户A-春季款"，不至于把一句话塞进去） */
export const MAX_TAG_LEN = 16

/** 归一：去首尾空白、把连续空白压成一个空格、截到上限 */
export function normalizeTag(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN)
}

/**
 * 两个标签是不是同一个。
 *
 * **忽略大小写、不忽略重音**（localeCompare 的 `accent` 档）：`客户A` 与 `客户a`
 * 是同一个标签（否则筛选栏里会并排站两条看着一样的），而 `Café` 与 `Cafe` 是两条。
 */
export function sameTag(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

/** 一串原始值 → 干净、去重（按 `sameTag`）、有序的标签数组 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const tag = normalizeTag(item)
    if (!tag || out.some((t) => sameTag(t, tag))) continue
    out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export type AddTagResult =
  | { ok: true; tags: string[] }
  | { ok: false; reason: 'empty' | 'duplicate' | 'full'; tags: string[] }

/**
 * 加一个标签。三种"加不上"各有自己的理由（空 / 已经有了 / 满了）——
 * 调用方据此说一句人话，而不是一律"添加失败"。
 */
export function addTag(tags: readonly string[] | undefined, raw: string): AddTagResult {
  const current = normalizeTags(tags)
  const tag = normalizeTag(raw)
  if (!tag) return { ok: false, reason: 'empty', tags: current }
  if (current.some((t) => sameTag(t, tag))) return { ok: false, reason: 'duplicate', tags: current }
  if (current.length >= MAX_TAGS) return { ok: false, reason: 'full', tags: current }
  return { ok: true, tags: [...current, tag] }
}

/** 删一个标签（按 `sameTag` 匹配；删不存在的标签是空操作） */
export function removeTag(tags: readonly string[] | undefined, raw: string): string[] {
  const tag = normalizeTag(raw)
  const current = normalizeTags(tags)
  if (!tag) return current
  return current.filter((t) => !sameTag(t, tag))
}

export interface TagCount {
  tag: string
  count: number
}

/**
 * 素材库里出现过的标签 + 各自的数量（筛选栏那一栏读它）。
 *
 * 计数按**忽略大小写**归并，显示名取**第一次出现的写法**（与 `sameTag` 同一条口径）；
 * 排序：多的在前，同数量按**字符序**（不用 `localeCompare`：那会跟着语言环境变，
 * 同一份数据在不同机器上排出来的顺序不一样）—— 顺序稳定，用户认得出来"我上次点的那个还在原位"。
 */
export function tagCounts(assets: readonly LibraryAsset[]): TagCount[] {
  const map = new Map<string, TagCount>()
  for (const asset of assets) {
    for (const tag of normalizeTags(asset.tags)) {
      const key = tag.toLocaleLowerCase()
      const hit = map.get(key)
      if (hit) hit.count += 1
      else map.set(key, { tag, count: 1 })
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
  )
}

/** 素材库里的一张卡片所需的信息（字节除外——字节只在预览 / 下载时按需取） */
export interface LibraryAsset {
  /** 素材 hash，也是收藏记录的主键 */
  hash: string
  mime: string
  bytes: number
  width?: number
  height?: number
  /** 用户保存的时间戳；收藏列表按它倒序 */
  savedAt: number
  /** 保存时所属项目 id（仅作展示，不参与筛选） */
  projectId?: string
  /** 以下为保存时冻结的生成元数据 */
  prompt?: string
  model?: string
  quality?: string
  ratio?: string
  resolution?: string
  channelId?: string
  /**
   * 用户给的**标签**（对账 #303）。
   *
   * 为什么挂在**收藏关系**（`assetLibrary` 行）而不是内容仓库（`assets` 行）：
   * 标签是"我对这条素材的整理"，与"这份字节是什么"不是一回事 —— 同一份字节被两个项目
   * 收藏两次，两边各自打标签是合理的；写进 `assets` 会让两边互相覆盖。
   * 代价也说清：**没收藏的素材不能打标签**（界面上如实指出去收藏，而不是假装存下了）。
   */
  tags?: string[]
}

/** `assetLibrary` 表的一行（只取本模块关心的字段，其余原样透传） */
export interface LibraryAssetRowLike {
  id?: string
  hash?: string
  mime?: string
  bytes?: unknown
  width?: number
  height?: number
  savedAt?: number
  projectId?: string
  prompt?: string
  model?: string
  quality?: string
  ratio?: string
  resolution?: string
  channelId?: string
  tags?: unknown
}

/** 生成记录里与素材快照有关的最小结构（避免领域共享层反向依赖画布模型） */
export interface SnapshotRunRecordLike {
  status?: unknown
  projectId?: unknown
  createdAt?: unknown
  version?: unknown
  params?: unknown
  outputHashes?: unknown
  sentChannelId?: unknown
  sentModel?: unknown
  outputWidth?: unknown
  outputHeight?: unknown
}

/** 持有素材的节点里与快照有关的最小结构 */
export interface SnapshotNodeLike {
  projectId?: unknown
  data?: unknown
}

export interface BuildLibraryAssetSnapshotArgs {
  hash: string
  /** `assets` 表里的内容行；缺失时返回 null，不伪造一份没有字节的收藏 */
  asset?: LibraryAssetRowLike | null
  /** 用户触发“保存到素材库”时所在的节点 */
  node?: SnapshotNodeLike | null
  /** 当前项目可见的运行记录，用作保存时冻结的生成参数来源 */
  runRecords?: readonly SnapshotRunRecordLike[]
  /** 保存时刻由调用方注入，保证纯函数可测 */
  savedAt: number
}

/** 素材是图片还是视频（素材库只收录这两类，其余不进库） */
export type AssetKind = 'image' | 'video' | 'other'

export function assetKindOf(mime: string | undefined | null): AssetKind {
  const m = mime ?? ''
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  return 'other'
}

/** 字节数（兼容 Uint8Array / ArrayBuffer / 普通数组三种落库形态） */
export function byteLengthOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (value instanceof Uint8Array) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (Array.isArray(value)) return value.length
  return 0
}

/** 把「语义上的没填」统一成 undefined：空串、纯空白、`auto` 都按缺失算 */
export function normalizeMetaString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.toLowerCase() === 'auto') return undefined
  return text
}

/** 元数据展示文案：缺失统一显示 `—` */
export function displayMeta(value: unknown): string {
  const text = normalizeMetaString(value)
  return text ?? MISSING
}

/** 排序：新保存的在前。时间相同的按 hash 稳定排序（否则每次渲染顺序都在跳） */
export function sortLibraryAssets(assets: readonly LibraryAsset[]): LibraryAsset[] {
  return [...assets].sort((a, b) => b.savedAt - a.savedAt || a.hash.localeCompare(b.hash))
}

/**
 * 按关键字 / 类型过滤素材库。
 *
 * 可搜的字段是用户能认出来的那几类：提示词、模型、质量、比例、mime、像素尺寸。
 * **刻意不搜 hash**：那串十六进制对用户没有意义，搜到也说不清为什么命中。
 */
export function filterLibraryAssets(
  assets: readonly LibraryAsset[],
  query: string,
  kind: AssetKind | 'all',
  /** 只看带这个标签的（`null` / 空 = 不限）；按 `sameTag` 匹配，忽略大小写 */
  tag?: string | null,
): LibraryAsset[] {
  const q = query.trim().toLowerCase()
  const wanted = normalizeTag(tag)
  return assets.filter((a) => {
    if (kind !== 'all' && assetKindOf(a.mime) !== kind) return false
    const tags = normalizeTags(a.tags)
    if (wanted && !tags.some((t) => sameTag(t, wanted))) return false
    if (!q) return true
    const haystack = [
      a.prompt,
      a.model,
      a.quality,
      a.ratio,
      a.resolution,
      a.mime,
      /* 标签也参与搜索：记得"我给它打过『客户A』"却记不住图长什么样，是最常见的一种找法 */
      tags.join(' '),
      a.width && a.height ? `${a.width}×${a.height}` : '',
    ]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}

/**
 * 把 `assetLibrary` 表的原始行整理成素材库卡片。
 *
 * 收藏记录存的就是保存当时的快照，这里不再回落节点 / 运行记录——
 * 「冻结元数据」是刻意的产品口径：用户保存后改画布节点，收藏记录不能被跟着改。
 */
export function toLibraryAssets(rows: readonly LibraryAssetRowLike[]): LibraryAsset[] {
  const out: LibraryAsset[] = []
  for (const row of rows) {
    const hash = row.hash ?? row.id
    if (!hash) continue
    const tags = normalizeTags(row.tags)
    out.push({
      hash,
      mime: row.mime ?? 'application/octet-stream',
      bytes: byteLengthOf(row.bytes),
      width: asNumber(row.width),
      height: asNumber(row.height),
      savedAt: asNumber(row.savedAt) ?? 0,
      projectId: normalizeMetaString(row.projectId),
      prompt: normalizeMetaString(row.prompt),
      model: normalizeMetaString(row.model),
      quality: normalizeMetaString(row.quality),
      ratio: normalizeMetaString(row.ratio),
      resolution: normalizeMetaString(row.resolution),
      channelId: normalizeMetaString(row.channelId),
      /* 标签：一行都没有时**不落空数组**（"没有这个字段"与"有但为空"在库里是同一件事） */
      ...(tags.length > 0 ? { tags } : {}),
    })
  }
  return sortLibraryAssets(out)
}

/**
 * 从当前节点、最近一次成功产出该素材的记录、以及 `assets` 内容行组装收藏快照。
 *
 * 优先级刻意固定为「实际发出的运行记录 → 节点当前值 → 素材行的真实尺寸」：
 * - 记录里的 `sentChannelId` / `sentModel` 才是真正服务本次产出的渠道与上游模型；
 * - 节点值兜住老记录缺少 sent 字段的情况；
 * - 像素必须以成对数字为准，只有单边时不猜，继续向下回落。
 *
 * 纯函数且全程防御脏数据：缺素材行返回 null，其余字段缺失只留空，
 * 不抛异常、不制造 `0` / `0×0` 这类看似有值的假数据。
 */
export function buildLibraryAssetSnapshot(
  args: BuildLibraryAssetSnapshotArgs,
): LibraryAsset | null {
  const hash = normalizeMetaString(args.hash)
  const asset = args.asset
  if (!hash || !asset) return null

  const rowHash = normalizeMetaString(asset.hash ?? asset.id)
  if (rowHash && rowHash !== hash) return null

  const record = latestSucceededRecordFor(args.runRecords ?? [], hash)
  const params = asRecord(record?.params)
  const data = asRecord(args.node?.data)
  const naturalSize = asRecord(data?.naturalSize)
  const recordSize = sizePair(record?.outputWidth, record?.outputHeight)
  const nodeSize = sizePair(naturalSize?.width, naturalSize?.height)
  const assetSize = sizePair(asset.width, asset.height)
  const size = recordSize ?? nodeSize ?? assetSize

  return {
    hash,
    mime: normalizeMetaString(asset.mime) ?? 'application/octet-stream',
    bytes: byteLengthOf(asset.bytes),
    width: size?.width,
    height: size?.height,
    savedAt: Math.max(0, Math.floor(args.savedAt)),
    projectId: normalizeMetaString(args.node?.projectId),
    prompt: pickString(params?.prompt) ?? pickString(data?.prompt),
    model: pickString(record?.sentModel) ?? pickString(data?.model),
    quality: pickString(params?.quality) ?? pickString(data?.quality),
    ratio: pickString(params?.ratio) ?? pickString(data?.ratio),
    resolution:
      pickString(params?.resolution) ??
      pickString(data?.resolution) ??
      pickString(data?.size),
    channelId: pickString(record?.sentChannelId) ?? pickString(data?.channelId),
  }
}

function latestSucceededRecordFor(
  records: readonly SnapshotRunRecordLike[],
  hash: string,
): SnapshotRunRecordLike | undefined {
  let best: SnapshotRunRecordLike | undefined
  let bestAt = -1
  let bestVersion = -1
  for (const record of records) {
    if (record.status !== 'succeeded') continue
    const hashes = Array.isArray(record.outputHashes) ? record.outputHashes : []
    if (!hashes.includes(hash)) continue
    const at = asFiniteNumber(record.createdAt) ?? 0
    const version = asFiniteNumber(record.version) ?? 0
    if (at > bestAt || (at === bestAt && version > bestVersion)) {
      best = record
      bestAt = at
      bestVersion = version
    }
  }
  return best
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function pickString(value: unknown): string | undefined {
  return normalizeMetaString(value)
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sizePair(width: unknown, height: unknown): { width: number; height: number } | undefined {
  const w = asNumber(width)
  const h = asNumber(height)
  return w && h ? { width: w, height: h } : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/** 素材体积文案：`1.2 MB` / `860 KB` / `—`（未知就是未知，不显示 0 B 冒充） */
export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return MISSING
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** 尺寸文案：`1024 × 1024`；未知返回 null（由调用方决定要不要显示这一行） */
export function formatAssetSize(asset: { width?: number; height?: number }): string | null {
  const w = asset.width
  const h = asset.height
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return null
  return `${w} × ${h}`
}

/**
 * 完整展示素材时的容器比例（宽 : 高）。
 *
 * 用户要求「显示完整的图片，不裁切」，所以这里只负责给容器一个稳定的占位比例：
 * - 素材有真实尺寸 → 直接用真实比例，卡片按原图比例完整显示；
 * - 尺寸未知 → 用 4:3 兜底，避免加载前容器塌成一条线；加载完成后由真实宽高纠正。
 *
 * **不再夹取极端比例**：夹取是上一版 cover 封面瀑布流的需要，会主动裁掉长图边缘；
 * 现在的目标是把原图完整摆出来，长图就应该长。
 */
export function masonryAspectOf(asset: { width?: number; height?: number }): number {
  const w = asset.width
  const h = asset.height
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return 4 / 3
  return w / h
}
