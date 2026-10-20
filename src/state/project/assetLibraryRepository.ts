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
import type { StoragePort, TableName } from '../../platform/ports'
import { normalizeTags, toLibraryAssets, type LibraryAsset } from '../../domain/shared/assetLibrary'

export interface AssetLibraryRepository {
  /** 用户保存过的素材（元数据在保存时已冻结在这一行里） */
  list(): Promise<LibraryAsset[]>
  /** 所有素材的标签（独立于收藏关系，未收藏的生成历史也能打标签） */
  listTagMap(): Promise<Map<string, string[]>>
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
   * 从素材页移除记录：隐藏该 hash，并删除收藏关系。
   *
   * 只动素材页自己的记录与隐藏索引，不删 `assets` 字节，也不删运行记录。
   */
  removeMany(hashes: readonly string[]): Promise<number>
  /** 素材页隐藏索引（跨刷新保存） */
  listHidden(): Promise<Set<string>>
  /** 给任意素材 hash 写标签；标签独立存，不再要求先收藏。 */
  setTags(hash: string, tags: readonly string[]): Promise<void>
}

/** 收藏关系 + 独立标签映射 */
const TABLES: TableName[] = ['assetLibrary', 'presets']
const TAGS_KEY = 'assetTags:v1'
const HIDDEN_KEY = 'assetRecordsHidden:v1'

export function createAssetLibraryRepository(storage: StoragePort): AssetLibraryRepository {
  /**
   * 标签的唯一真相：`presets` 里一行 `hash -> string[]`。
   *
   * 旧版本把标签挂在 `assetLibrary` 行上。首次读取时把旧标签搬进这份映射，
   * 之后所有读写都只认它；这样未收藏的生成记录也能打标签，取消收藏也不会误删整理结果。
   */
  const loadTagMap = async (): Promise<Map<string, string[]>> => {
    const saved = (await storage.query('presets', { id: TAGS_KEY })) as unknown as {
      tags?: unknown
    }[]
    if (saved[0] && saved[0].tags && typeof saved[0].tags === 'object') {
      const out = new Map<string, string[]>()
      for (const [hash, values] of Object.entries(saved[0].tags as Record<string, unknown>)) {
        const tags = normalizeTags(values)
        if (hash && tags.length > 0) out.set(hash, tags)
      }
      return out
    }
    const rows = (await storage.query('assetLibrary', {})) as unknown as {
      hash?: unknown
      id?: unknown
      tags?: unknown
    }[]
    const migrated = new Map<string, string[]>()
    for (const row of rows) {
      const hash = typeof row.hash === 'string' ? row.hash : typeof row.id === 'string' ? row.id : ''
      const tags = normalizeTags(row.tags)
      if (hash && tags.length > 0) migrated.set(hash, tags)
    }
    await storage.put('presets', { id: TAGS_KEY, tags: Object.fromEntries(migrated) })
    return migrated
  }

  const saveTagMap = (map: Map<string, string[]>) =>
    storage.put('presets', { id: TAGS_KEY, tags: Object.fromEntries(map) })

  const hiddenFrom = (row: unknown): Set<string> => {
    const hashes = (row as { hashes?: unknown } | undefined)?.hashes
    return new Set(
      Array.isArray(hashes)
        ? hashes.filter((hash): hash is string => typeof hash === 'string' && hash.length > 0)
        : [],
    )
  }

  const loadHidden = async (): Promise<Set<string>> => {
    const rows = (await storage.query('presets', { id: HIDDEN_KEY })) as unknown[]
    return hiddenFrom(rows[0])
  }

  const writeHidden = async (hidden: ReadonlySet<string>) =>
    storage.put('presets', { id: HIDDEN_KEY, hashes: [...hidden] })

  return {
    async list() {
      const rows = await storage.query('assetLibrary', {})
      const tagMap = await loadTagMap()
      return toLibraryAssets(rows as unknown as Parameters<typeof toLibraryAssets>[0]).map(
        (asset) => {
          const tags = tagMap.get(asset.hash)
          return tags?.length ? { ...asset, tags } : asset
        },
      )
    },

    async listTagMap() {
      return loadTagMap()
    },

    async save(asset: LibraryAsset) {
      const row: Partial<LibraryAsset> = { ...asset }
      delete row.tags
      await storage.put('assetLibrary', {
        ...row,
        id: asset.hash,
      })
      const hidden = await loadHidden()
      if (hidden.delete(asset.hash)) await writeHidden(hidden)
    },

    async remove(hash: string) {
      await storage.delete('assetLibrary', hash)
    },

    async removeMany(hashes) {
      const targets = new Set(hashes.filter((hash) => hash.trim()))
      if (targets.size === 0) return 0
      await storage.transaction(['assetLibrary', 'presets'], async (tx) => {
        const rows = (await tx.query('presets', { id: HIDDEN_KEY })) as unknown[]
        const hidden = hiddenFrom(rows[0])
        for (const hash of targets) {
          hidden.add(hash)
          await tx.delete('assetLibrary', hash)
        }
        await tx.put('presets', { id: HIDDEN_KEY, hashes: [...hidden] })
      })
      return targets.size
    },

    async listHidden() {
      return loadHidden()
    },

    async setTags(hash: string, tags: readonly string[]) {
      if (!hash) return
      const map = await loadTagMap()
      const normalized = normalizeTags(tags)
      if (normalized.length > 0) map.set(hash, normalized)
      else map.delete(hash)
      await saveTagMap(map)
    },
  }
}

/** 供事务场景复用（与 `assets` 分开，取消收藏不碰内容仓库） */
export const ASSET_LIBRARY_TABLES = TABLES
