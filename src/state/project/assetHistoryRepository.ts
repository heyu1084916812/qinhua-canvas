import type { StoragePort, TableName } from '../../platform/ports'
import type { HistoryItem } from '../../domain/shared/assetHistory'
import { buildHistory } from '../../domain/shared/assetHistory'
import { byteLengthOf, normalizeMetaString } from '../../domain/shared/assetLibrary'

/**
 * 「全部生成历史」的仓储（对账 #264）。
 *
 * 与 `assetLibraryRepository` **刻意分成两个文件**：那个的不变量是"只碰 `assetLibrary`，
 * 绝不碰 `assets`"（取消收藏不许动字节）；这里恰恰要**读**`runRecords` / `assets` / `projects` /
 * `assetLibrary` 四张表。合成一个模块，那条"绝不碰"的注释立刻变成假话。
 *
 * ## 为什么 `assets` 必须用 `scan` 分批读
 *
 * `assets` 每行都带**全分辨率字节**：库涨到几 GB 时，`query('assets', {})` 就是把整个库
 * 读进内存（浏览器直接崩）。而历史列表只需要**元数据**（hash / mime / 像素 / 字节数），
 * 所以按批读、**每批只把元数据留下**、字节随批次释放。老后端没有 `scan` 时退回整表
 * （小库两条路等价，这条口径与"导出素材到文件夹"一致）。
 */
export interface AssetHistoryRepository {
  list(): Promise<HistoryItem[]>
}

/** 分批大小：一行可能几 MB，取小一点（峰值内存 ≈ batchSize × 单张大小） */
const SCAN_BATCH = 8

const TABLES: TableName[] = ['runRecords', 'assets', 'assetLibrary', 'projects']

export function createAssetHistoryRepository(storage: StoragePort): AssetHistoryRepository {
  return {
    async list() {
      const [runs, library, projects] = await Promise.all([
        storage.query('runRecords', {}),
        storage.query('assetLibrary', {}),
        storage.query('projects', {}),
      ])

      /**
       * 只收**元数据**：`bytes` 当场折算成数字，字节本体不进这个数组 ——
       * 这是"分批"真正省下的东西（否则分批只是把峰值从"1×库"降到"仍然 ≈ 库"）。
       */
      const assets: {
        hash: string
        mime?: string
        width?: number
        height?: number
        bytes: number
      }[] = []
      const collect = (
        rows: readonly {
          hash?: unknown
          id?: unknown
          mime?: unknown
          width?: unknown
          height?: unknown
          bytes?: unknown
          bytesLength?: unknown
        }[],
      ) => {
        for (const row of rows) {
          const hash = normalizeMetaString(row.hash ?? row.id)
          if (!hash) continue
          assets.push({
            hash,
            mime: normalizeMetaString(row.mime),
            width: typeof row.width === 'number' ? row.width : undefined,
            height: typeof row.height === 'number' ? row.height : undefined,
            bytes:
              typeof row.bytesLength === 'number'
                ? row.bytesLength
                : byteLengthOf(row.bytes),
          })
        }
      }

      if (storage.scan) {
        await storage.scan(
          'assets',
          SCAN_BATCH,
          async (rows) => {
            collect(rows as never)
          },
          { includePayload: false },
        )
      } else {
        collect((await storage.query('assets', {})) as never)
      }

      return buildHistory({
        runs: runs as never,
        assets: assets as never,
        savedHashes: library
          .map((row) => normalizeMetaString((row as { hash?: unknown; id?: unknown }).hash ?? (row as { id?: unknown }).id))
          .filter((h): h is string => !!h),
        projects: projects as never,
      })
    },
  }
}

/** 供事务场景复用（与 `ASSET_LIBRARY_TABLES` 同一用途） */
export const ASSET_HISTORY_TABLES = TABLES
