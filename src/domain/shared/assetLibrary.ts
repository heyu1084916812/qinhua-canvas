/**
 * 素材库（`/assets`）的**领域口径**（产品文档 §2.1 #6）。
 *
 * 素材本体一直都在 `assets` 表里（内容哈希为主键），但那张表只有字节与尺寸 ——
 * 「什么时候来的」「属于哪个项目」都不在上面。素材库要按时间排序、
 * 要显示来源项目，就必须在这一层把两件事定死：
 *
 *  1. **时间**：优先取素材行自己的 `createdAt`（新写入的都带）；
 *     老行没有 → 回落到「最早一次产出它的生成记录」，再没有才用 0。
 *  2. **来源项目**：优先取素材行的 `projectId`（新写入的都带）；
 *     老行没有 → 从**当前持有它的节点**反查（节点上有 `projectId`）。
 *
 * 回落到「当前持有者」而不是「历史产出者」是刻意的：素材被复制进别的项目后，
 * 「它现在在哪儿」才是用户要的答案；说它属于三年前那个项目只会让人找不到。
 *
 * 纯函数：不读时间、不查库，全部由调用方注入（可单测）。
 */

/** 素材库里的一张卡片所需的最小信息（字节除外——字节只在预览时按需取） */
export interface LibraryAsset {
  hash: string
  mime: string
  bytes: number
  width?: number
  height?: number
  /** 排序用时间戳；0 表示未知（排在最后，不冒充「很早以前」） */
  createdAt: number
  /** 来源项目 id；未知为 null（界面显示「—」而不是猜一个） */
  projectId: string | null
}

/** assets 表的一行（只取本模块关心的字段，其余原样透传） */
export interface AssetRowLike {
  id?: string
  hash?: string
  mime?: string
  bytes?: unknown
  width?: number
  height?: number
  createdAt?: number
  projectId?: string
}

/** 生成记录里「哪次产出过哪个 hash」（用于老素材的时间回落） */
export interface RunProvenance {
  createdAt: number
  projectId?: string
  outputHashes?: string[]
}

/** 节点持有关系：`hash → 该节点所属项目`（用于老素材的来源回落） */
export interface NodeProvenance {
  hash: string
  projectId: string
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
  if (value instanceof Uint8Array) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (Array.isArray(value)) return value.length
  return 0
}

/** 排序：新的在前。时间相同的按 hash 稳定排序（否则每次渲染顺序都在跳） */
export function sortLibraryAssets(assets: readonly LibraryAsset[]): LibraryAsset[] {
  return [...assets].sort((a, b) => b.createdAt - a.createdAt || a.hash.localeCompare(b.hash))
}

/**
 * 按关键字 / 类型过滤素材库。
 *
 * 可搜的字段只有三类：来源项目名、mime、尺寸文案（如 `1024×1024`）。
 * **刻意不搜 hash**：那串 16 位十六进制对用户没有意义，搜到也说不清为什么命中。
 */
export function filterLibraryAssets(
  assets: readonly LibraryAsset[],
  query: string,
  kind: AssetKind | 'all',
  projectNameOf: (id: string | null) => string,
): LibraryAsset[] {
  const q = query.trim().toLowerCase()
  return assets.filter((a) => {
    if (kind !== 'all' && assetKindOf(a.mime) !== kind) return false
    if (!q) return true
    const haystack = [
      projectNameOf(a.projectId),
      a.mime,
      a.width && a.height ? `${a.width}×${a.height}` : '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}

/**
 * 把 assets 表的原始行整理成素材库卡片。
 *
 * 时间与来源的回落都在这里发生一次，界面不再各写一套（否则两处口径
 * 迟早不一致：一处显示「未知」、另一处显示某个项目）。
 */
export function toLibraryAssets(
  rows: readonly AssetRowLike[],
  provenance: {
    runRecords?: readonly RunProvenance[]
    nodes?: readonly NodeProvenance[]
  } = {},
): LibraryAsset[] {
  /** hash → 最早一次产出它的时间 */
  const firstProduced = new Map<string, number>()
  for (const r of provenance.runRecords ?? []) {
    for (const h of r.outputHashes ?? []) {
      const prev = firstProduced.get(h)
      // 取**最早**：一张图被反复用，「第一次出现」才接近它的创建时间
      if (prev === undefined || r.createdAt < prev) firstProduced.set(h, r.createdAt)
    }
  }
  /** hash → 当前持有它的节点所属项目 */
  const ownerOf = new Map<string, string>()
  for (const n of provenance.nodes ?? []) {
    // 多个项目都持有同一张图时保留第一个：内容寻址下这是同一份字节，
    // 显示哪一个都对，但整库必须稳定（否则刷新一次来源就变一次）
    if (!ownerOf.has(n.hash)) ownerOf.set(n.hash, n.projectId)
  }

  const out: LibraryAsset[] = []
  for (const row of rows) {
    const hash = row.hash ?? row.id
    if (!hash) continue
    const createdAt = asNumber(row.createdAt) ?? firstProduced.get(hash) ?? 0
    const projectId = row.projectId ?? ownerOf.get(hash) ?? null
    out.push({
      hash,
      mime: row.mime ?? 'application/octet-stream',
      bytes: byteLengthOf(row.bytes),
      width: asNumber(row.width),
      height: asNumber(row.height),
      createdAt,
      projectId,
    })
  }
  return sortLibraryAssets(out)
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/** 素材体积文案：`1.2 MB` / `860 KB` / `—`（未知就是未知，不显示 0 B 冒充） */
export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '—'
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
 * 瀑布流卡片的高度比例（宽 : 高）。
 *
 * 瀑布流要成立，每张卡片必须**按素材自己的比例**占高度 ——
 * 统一一个容器比例（如 4:3）就退化成等高网格，瀑布流也就没有意义了。
 *
 * 比例夹在 `[1/2, 2]` 之间：极端细长的图（如 1:10 的长图）不夹会让
 * 那一列被单张图撑成一根面条，整版排版失控。夹住之后它按上下限显示，
 * 封面仍用 `object-fit: cover` 裁切 —— 宁可裁一点，也不要一列失控。
 *
 * **尺寸未知时返回一个稳妥的默认（4:3）**：封面容器必须有确定高度
 * 才能撑开卡片（否则卡片塌成一条线），而「未知」不能是零。
 */
export function masonryAspectOf(asset: { width?: number; height?: number }): number {
  const w = asset.width
  const h = asset.height
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return 4 / 3
  const ratio = w / h
  return Math.min(2, Math.max(1 / 2, ratio))
}
