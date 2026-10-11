/**
 * 素材库仓储（`/assets` 的数据来源）。
 *
 * 与 `repository.ts`（项目）同级而非塞进它：`projects` 的每一次列表都要
 * 顺带查节点与留痕，而素材库只读 `assetLibrary` 一张表 —— 两者生命周期不同
 * （侧栏每次切页都会读项目），且素材库的语义是「用户手动收藏」，
 * 与项目列表的「内容仓库」不是一回事。
 *
 * ## 只碰 `assetLibrary`，绝不碰 `assets`
 *
 * - `assets` 是**内容仓库**（内容哈希为主键，存字节与真实尺寸），
 *   凡是画布上出现过的素材都在里面，**不代表用户收藏过**。
 * - `assetLibrary` 是**收藏关系**（一行 = 用户主动保存过一次），
 *   保存当时冻结的元数据也在这一行上。
 *
 * 因此 `list()` 只查 `assetLibrary`，`remove()` 只删 `assetLibrary` 行 ——
 * 取消收藏不该顺手删掉字节：画布上可能还有节点引用着它。
 */
import type { RowOf, StoragePort, TableName } from '../../platform/ports'
import { normalizeTags, toLibraryAssets, type LibraryAsset } from '../../domain/shared/assetLibrary'

export interface AssetLibraryRepository {
  /** 用户保存过的素材（元数据在保存时已冻结在这一行里） */
  list(): Promise<LibraryAsset[]>
  /**
   * 保存一条素材到素材库。
   *
   * 行主键就是素材 hash（同一张素材重复保存是覆盖，不是新增第二张）。
   * 素材字节仍留在 `assets` 表，这里只写收藏关系与冻结元数据。
   */
  save(asset: LibraryAsset): Promise<void>
  /**
   * 取消收藏一条素材。
   *
   * **只删 `assetLibrary` 这一行**，绝不动 `assets` 表 ——
   * 字节可能仍被画布节点引用，删掉会在用户看不到的地方弄坏画布。
   */
  remove(hash: string): Promise<void>
  /**
   * 给一条**已收藏**的素材写标签（对账 #303）。
   *
   * 三条口径：
   * - **只改 `assetLibrary` 这一行**（标签属于"我的整理"，不属于内容仓库）；
   * - **没收藏过就什么都不做**（不是报错）：界面在那种情况下不该给出打标签的入口，
   *   真走到了这里也只是空操作，绝不顺手替用户收藏一份；
   * - **不动 `savedAt`**：收藏时间决定列表排序，打个标签不该让这张图跳到最前面。
   */
  setTags(hash: string, tags: readonly string[]): Promise<void>
}

/** 素材库只涉及一张表 */
const TABLES: TableName[] = ['assetLibrary']

export function createAssetLibraryRepository(storage: StoragePort): AssetLibraryRepository {
  return {
    async list() {
      const rows = await storage.query('assetLibrary', {})
      return toLibraryAssets(rows as unknown as Parameters<typeof toLibraryAssets>[0])
    },

    async save(asset: LibraryAsset) {
      await storage.put('assetLibrary', {
        ...asset,
        id: asset.hash,
      })
    },

    async remove(hash: string) {
      await storage.delete('assetLibrary', hash)
    },

    async setTags(hash: string, tags: readonly string[]) {
      const rows = await storage.query('assetLibrary', { id: hash })
      const row = rows[0]
      if (!row) return
      const normalized = normalizeTags(tags)
      /** 标签全删光时**把字段去掉**，不留一个空的 `tags: []`（"没有"与"空"在库里是同一件事） */
      const next: Record<string, unknown> = { ...row }
      if (normalized.length > 0) next.tags = normalized
      else delete next.tags
      await storage.put('assetLibrary', next as unknown as RowOf<'assetLibrary'>)
    },
  }
}

/** 供事务场景复用（与 `assets` 分开，取消收藏不碰内容仓库） */
export const ASSET_LIBRARY_TABLES = TABLES
