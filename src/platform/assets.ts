import type { AssetPort, AssetPayload, AssetUrlSource, StoragePort } from './ports'

/**
 * 素材读回（M6-12）：`assets` 表 → 字节。
 *
 * 与 `assets` 表的约定（产品文档 §8）：**id 即内容哈希**，故 `read(hash)`
 * 就是按主键查一行。两种平台实现共用这一个——它只依赖 `StoragePort`，
 * 不依赖 IndexedDB，因此 web / memory 双端行为一致（测试里种一行即可用）。
 *
 * 字节形态兼容：IndexedDB 结构化克隆可能把 `Uint8Array` 还原成 `ArrayBuffer`，
 * 而 `flowIo` 导入导出路径上还可能出现普通数组，三种都归一成 `Uint8Array`。
 */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return new Uint8Array(value as number[])
  return null
}

export function createStorageAssetPort(storage: StoragePort): AssetPort {
  return {
    async read(hash: string): Promise<AssetPayload | null> {
      const rows = await storage.query('assets', { id: hash })
      const row = rows[0] as { bytes?: unknown; mime?: string } | undefined
      const bytes = row ? toBytes(row.bytes) : null
      if (!bytes || bytes.length === 0) return null
      return { bytes, mime: row?.mime ?? 'image/png' }
    },

    /**
     * 远端素材（视频成片）只存了地址：字节那条路按设计返回 null，
     * 这里补上「地址 + 类型」，让播放与下载都有据可依。
     */
    async readUrl(hash: string): Promise<AssetUrlSource | null> {
      const rows = await storage.query('assets', { id: hash })
      const row = rows[0] as { url?: unknown; mime?: string } | undefined
      const url = typeof row?.url === 'string' ? row.url.trim() : ''
      if (!url) return null
      return { url, mime: row?.mime ?? 'video/mp4' }
    },
  }
}
