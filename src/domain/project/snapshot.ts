/**
 * 项目快照的**规则层**（用户 2026-10-09，对账 #378 A4）。
 *
 * ## 与"全库备份"的分工（别混）
 *
 * | | 全库备份（`backup.ts`） | 快照（本文） |
 * | --- | --- | --- |
 * | 范围 | 整个库 | **一个项目**（图 + 该项目的运行记录） |
 * | 谁触发 | 用户手动点 | **自动**（按天，见 `snapshotStore`） |
 * | 存哪 | 用户选的文件 | 库内 `snapshots` 表 |
 * | 用途 | 换机器 / 重装 | **改坏了想回退到昨天** |
 *
 * ## 为什么快照要"按项目"而不是"整库"
 *
 * 整库快照会把素材字节也抄一遍（几百 MB × N 份）。按项目只抄**图与记录**，
 * 素材仍走内容寻址的 `assets` 表（那张表是只增不改的，天然就是历史的）。
 * 所以快照可以做得又多又小。
 *
 * 本文件是纯函数层：只判断"该不该拍""该删哪几张"，不认识存储。
 */

/** 两次自动快照的最小间隔：一天（按自然日判断，见 `shouldSnapshot`） */
export const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 默认保留份数（用户可在设置里改） */
export const SNAPSHOT_KEEP_DEFAULT = 7

/** 可选的保留份数档位 */
export const SNAPSHOT_KEEP_CHOICES = [3, 7, 15, 30] as const
export type SnapshotKeep = (typeof SNAPSHOT_KEEP_CHOICES)[number]

export interface ProjectSnapshot {
  id: string
  projectId: string
  /** 快照时间 */
  createdAt: number
  /** 项目名（快照当时） —— 项目改名后，旧快照仍显示当时的名字，便于辨认 */
  name: string
  /** 节点数（列表直接展示，不必回读图数据） */
  nodeCount: number
}

/** 快照行 = 快照元数据 + 图数据（nodes / edges / runRecords 的原始行） */
export interface SnapshotRecord extends ProjectSnapshot {
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
  runRecords: Record<string, unknown>[]
}

/**
 * 该不该给这个项目拍快照？
 *
 * 三条判据，缺一不可：
 * 1. 有内容（nodeCount > 0）—— 空项目拍下来没有任何意义，还会挤掉有价值的快照；
 * 2. 快照之后**改过**（updatedAt > 最近一次快照时间）—— 没改就重复拍是浪费；
 * 3. 距上次快照**超过一天** —— 否则用户连改十次就产生十份几乎一样的快照。
 *
 * 传 `lastSnapshotAt = null` 表示从没拍过：这时只要"有内容 + 改过"就拍。
 */
export function shouldSnapshot(
  project: { nodeCount: number; updatedAt: number },
  lastSnapshotAt: number | null,
  now: number,
): boolean {
  if (project.nodeCount <= 0) return false
  if (!lastSnapshotAt) return true
  if (project.updatedAt <= lastSnapshotAt) return false
  return now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS
}

/**
 * 超出保留份数时要删掉哪些快照（**最旧的先删**）。
 *
 * 返回**待删除的 id 列表**，而不是"保留哪些"：调用方拿着 id 直接删，
 * 不必再推一遍"保留集合"。
 */
export function snapshotsToPrune(
  snapshots: readonly ProjectSnapshot[],
  keep: number,
): string[] {
  if (keep <= 0) return snapshots.map((s) => s.id)
  if (snapshots.length <= keep) return []
  // 新的在前（时间倒序），超出的尾巴就是要删的
  const sorted = [...snapshots].sort((a, b) => b.createdAt - a.createdAt)
  return sorted.slice(keep).map((s) => s.id)
}

/** 按项目分组，挑出每个项目"最近一次"快照时间（供 `shouldSnapshot` 用） */
export function lastSnapshotAtByProject(
  snapshots: readonly ProjectSnapshot[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of snapshots) {
    const prev = out.get(s.projectId) ?? 0
    if (s.createdAt > prev) out.set(s.projectId, s.createdAt)
  }
  return out
}

/** 快照里有什么（界面用一句话说清，避免用户不知道点下去会发生什么） */
export function describeSnapshot(snapshot: ProjectSnapshot): string {
  const when = new Date(snapshot.createdAt).toLocaleString()
  return `${snapshot.name} · ${snapshot.nodeCount} 个节点 · ${when}`
}
