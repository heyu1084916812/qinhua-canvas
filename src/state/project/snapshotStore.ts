/**
 * 项目快照的落库（用户 2026-10-09，对账 #378 A4）。
 *
 * 规则在 `domain/project/snapshot.ts`（该不该拍、该删哪几张），这里只负责读写。
 *
 * ## 快照抄什么
 *
 * `nodes` / `edges` / `runRecords` 三张表 —— 前两张是"图"，第三张是"当时跑过什么"。
 * **不抄素材字节**：`assets` 是内容寻址、只增不改的，快照里只要留着 hash 就还能取到图。
 * 这也让快照小得多（一份图数据通常几十 KB，而不是几十 MB）。
 *
 * ## 还原是"覆盖当前项目"，但走的是**同 id 原地覆盖**
 *
 * 先删掉这个项目现存的 nodes / edges，再把快照里的写回去，然后 `bulkPut` 运行记录。
 * 还原前**不必**另存一份"还原前"的快照 —— 用户如果真的选错了，
 * 回收站和全库备份还在；再多存一层只会让快照表迅速膨胀。
 */
import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  SNAPSHOT_KEEP_DEFAULT,
  lastSnapshotAtByProject,
  shouldSnapshot,
  snapshotsToPrune,
  type ProjectSnapshot,
  type SnapshotRecord,
} from '../../domain/project/snapshot'

export interface SnapshotStore {
  /** 快照元数据列表（不含图数据，供界面展示） */
  list: (projectId?: string) => Promise<ProjectSnapshot[]>
  /** 取一份完整快照（含图） */
  read: (id: string) => Promise<SnapshotRecord | null>
  /** 给单个项目拍一张 */
  capture: (projectId: string, now?: number) => Promise<ProjectSnapshot | null>
  /**
   * 自动快照：把所有"该拍的"项目各拍一张，并按保留份数清理。
   *
   * 返回值告诉调用方"这次实际拍了几张" —— 界面可以据此决定要不要提示用户。
   */
  runAuto: (opts?: { keep?: number; now?: number }) => Promise<ProjectSnapshot[]>
  /** 还原一份快照（原地覆盖当前项目） */
  restore: (snapshotId: string) => Promise<void>
  /** 删一份快照 */
  remove: (id: string) => Promise<void>
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((r) => !!r && typeof r === 'object') as Record<string, unknown>[]) : []
}

function metaFromRow(row: Record<string, unknown>): ProjectSnapshot | null {
  const id = typeof row.id === 'string' ? row.id : ''
  const projectId = typeof row.projectId === 'string' ? row.projectId : ''
  if (!id || !projectId) return null
  return {
    id,
    projectId,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    name: typeof row.name === 'string' ? row.name : '未命名项目',
    nodeCount: typeof row.nodeCount === 'number' ? row.nodeCount : 0,
  }
}

export function createSnapshotStore(storage: StoragePort): SnapshotStore {
  const list: SnapshotStore['list'] = async (projectId) => {
    const rows = (await storage.query('snapshots', projectId ? { projectId } : {})) as unknown as Record<
      string,
      unknown
    >[]
    return rows
      .map(metaFromRow)
      .filter((s): s is ProjectSnapshot => s !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 读一份完整快照（抽成独立函数：`restore` 也要用，别在方法里写 `this.read`） */
  const readSnapshot = async (id: string): Promise<SnapshotRecord | null> => {
    const rows = await storage.query('snapshots', { id })
    const row = rows[0] as unknown as Record<string, unknown> | undefined
    if (!row) return null
    const meta = metaFromRow(row)
    if (!meta) return null
    return {
      ...meta,
      nodes: asRows(row.nodes),
      edges: asRows(row.edges),
      runRecords: asRows(row.runRecords),
    }
  }

  /** 真正落库的那一步（capture 与 runAuto 共用，避免两套写法） */
  const writeSnapshot = async (projectId: string, now: number): Promise<ProjectSnapshot | null> => {
    const projectRows = await storage.query('projects', { id: projectId })
    const project = projectRows[0]
    if (!project) return null

    const [nodes, edges, runRecords] = await Promise.all([
      storage.query('nodes', { projectId }),
      storage.query('edges', { projectId }),
      storage.query('runRecords', { projectId }),
    ])
    if (nodes.length === 0) return null // 空项目不拍（规则层也拦，这里再兜一道）

    const record: SnapshotRecord = {
      id: createId('snap'),
      projectId,
      createdAt: now,
      name: typeof project.name === 'string' ? project.name : '未命名项目',
      nodeCount: nodes.length,
      nodes: nodes as unknown as Record<string, unknown>[],
      edges: edges as unknown as Record<string, unknown>[],
      runRecords: runRecords as unknown as Record<string, unknown>[],
    }
    await storage.put('snapshots', record as never)
    // 只把元数据回给调用方：界面列表不需要背着整份图
    return {
      id: record.id,
      projectId: record.projectId,
      createdAt: record.createdAt,
      name: record.name,
      nodeCount: record.nodeCount,
    }
  }

  const prune = async (projectId: string, keep: number): Promise<void> => {
    const all = await list(projectId)
    for (const id of snapshotsToPrune(all, keep)) await storage.delete('snapshots', id)
  }

  return {
    list,

    read: readSnapshot,

    capture: (projectId, now = Date.now()) => writeSnapshot(projectId, now),

    async runAuto(opts = {}) {
      const keep = opts.keep ?? SNAPSHOT_KEEP_DEFAULT
      const now = opts.now ?? Date.now()

      // 项目行直接读表：这里只需要 nodeCount / updatedAt，不必走仓储算封面
      const projectRows = (await storage.query('projects', {})) as unknown as Record<string, unknown>[]
      const alive = projectRows.filter((r) => !r.deletedAt)
      const lastByProject = lastSnapshotAtByProject(await list())

      const created: ProjectSnapshot[] = []
      for (const row of alive) {
        const projectId = typeof row.id === 'string' ? row.id : ''
        if (!projectId) continue
        const nodeCount = (await storage.query('nodes', { projectId })).length
        const updatedAt = typeof row.updatedAt === 'number' ? row.updatedAt : 0
        const last = lastByProject.get(projectId) ?? null
        if (!shouldSnapshot({ nodeCount, updatedAt }, last, now)) continue
        const snap = await writeSnapshot(projectId, now)
        if (snap) {
          created.push(snap)
          await prune(projectId, keep)
        }
      }
      return created
    },

    async restore(snapshotId) {
      const snap = await readSnapshot(snapshotId)
      if (!snap) throw new Error('这份快照已经不在库里了')
      const projectId = snap.projectId

      await storage.transaction(['nodes', 'edges', 'runRecords'], async (tx) => {
        // 先把现有的图清掉，再写回快照里的 —— 原地覆盖，项目 id 不变
        for (const table of ['nodes', 'edges'] as const) {
          const rows = await tx.query(table, { projectId })
          for (const row of rows) await tx.delete(table, row.id)
        }
        if (snap.nodes.length) await tx.bulkPut('nodes', snap.nodes as never)
        if (snap.edges.length) await tx.bulkPut('edges', snap.edges as never)
        /**
         * 运行记录**不清空、只补写**：它是"跑过什么"的历史，
         * 清掉会让日志凭空少一截，而用户只是想把画布退回某个状态。
         * 快照里已有的行按 id 覆盖，缺的保留。
         */
        if (snap.runRecords.length) await tx.bulkPut('runRecords', snap.runRecords as never)
      })
    },

    async remove(id) {
      await storage.delete('snapshots', id)
    },
  }
}
