/**
 * 素材库仓储（`/assets` 的数据来源）。
 *
 * 与 `repository.ts`（项目）同级而非塞进它：`projects` 的每一次列表都要
 * 顺带查节点与留痕，而素材库要查的是「全库 assets + 全库 runRecords + 全库
 * 持有这些 hash 的节点」——三张表的全表扫描，挂在项目列表上会让首页首屏
 * 平白多背一次全库查询。两者生命周期也不同（侧栏每次切页都会读项目）。
 *
 * 读的是同一份事实（同一个 StoragePort），只是**不共享查询**。
 */
import type { StoragePort, TableName } from '../../platform/ports'
import {
  toLibraryAssets,
  type LibraryAsset,
  type NodeProvenance,
  type RunProvenance,
} from '../../domain/shared/assetLibrary'

export interface AssetLibraryRepository {
  /** 全库素材（时间与来源已在此补齐，界面不再回落到别处） */
  list(): Promise<LibraryAsset[]>
  /** 项目 id → 项目名，用于卡片上的「来自 X」 */
  projectNames(): Promise<Map<string, string>>
  /**
   * 删除一条素材。
   *
   * 只删 `assets` 表这一行（字节本体就存在这一行里，没有第二处）。
   * **刻意不级联清理节点上的 `assetHash`**：那样会在用户看不到的地方
   * 改动画布内容，而素材库不该有这个权力。节点仍持有 hash 但素材没了 ——
   * 那条路径本来就有兜底（`useAssetMeta` 取不到就是空态，不报错）。
   */
  remove(hash: string): Promise<void>
}

/** 需要一起读的三张表；删素材也要在同一个事务里完成 */
const TABLES: TableName[] = ['assets', 'runRecords', 'nodes']

export function createAssetLibraryRepository(storage: StoragePort): AssetLibraryRepository {
  return {
    async list() {
      const [assetRows, records, nodes] = await Promise.all([
        storage.query('assets', {}),
        storage.query('runRecords', {}),
        storage.query('nodes', {}),
      ])

      const runRecords: RunProvenance[] = records.map((r) => ({
        createdAt: Number(r.createdAt ?? 0),
        projectId: typeof r.projectId === 'string' ? r.projectId : undefined,
        outputHashes: Array.isArray(r.outputHashes) ? (r.outputHashes as string[]) : [],
      }))

      /**
       * 节点 → 它持有的 hash。
       *
       * 只看 `generation` 类型：那是唯一把素材当内容持有的类型
       * （其余类型要么没有 `assetHash`，要么是对比节点的左右两张——
       *  那两张也是素材，故一并算进去）。
       */
      const nodesHolding: NodeProvenance[] = []
      for (const n of nodes) {
        const data = (n.data ?? {}) as Record<string, unknown>
        const hashes: unknown[] = []
        if (typeof data.assetHash === 'string') hashes.push(data.assetHash)
        if (typeof data.leftAssetHash === 'string') hashes.push(data.leftAssetHash)
        if (typeof data.rightAssetHash === 'string') hashes.push(data.rightAssetHash)
        if (Array.isArray(data.thumbOrder)) hashes.push(...(data.thumbOrder as unknown[]))
        const projectId = typeof n.projectId === 'string' ? n.projectId : null
        if (!projectId) continue
        for (const h of hashes) {
          if (typeof h === 'string' && h) nodesHolding.push({ hash: h, projectId })
        }
      }

      return toLibraryAssets(
        assetRows as unknown as Parameters<typeof toLibraryAssets>[0],
        { runRecords, nodes: nodesHolding },
      )
    },

    async projectNames() {
      const rows = await storage.query('projects', {})
      const out = new Map<string, string>()
      for (const r of rows) {
        const id = String(r.id)
        out.set(id, String(r.name ?? '未命名项目'))
      }
      return out
    },

    async remove(hash: string) {
      await storage.delete('assets', hash)
    },
  }
}

/** 供事务场景复用（目前没有跨表写入，保留以免将来在别处重写这张表清单） */
export const ASSET_LIBRARY_TABLES = TABLES
