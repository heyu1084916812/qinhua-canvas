import type { AssetPort, AssetPayload, AssetUrlSource, StoragePort } from './ports'
import { fingerprintBytes } from '../domain/shared/hash'
import type { GeneratedAsset } from './channels/types'

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
export function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return new Uint8Array(value as number[])
  return null
}

export function createStorageAssetPort(
  storage: StoragePort,
  options: {
    thumbUrl?: (hash: string) => string | null
    previewUrl?: (hash: string) => string | null
    sourceUrl?: (hash: string) => string | null
  } = {},
): AssetPort {
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
      const rows = await storage.query(
        'assets',
        { id: hash },
        { includePayload: false, fields: ['id', 'url', 'mime'] },
      )
      const row = rows[0] as { url?: unknown; mime?: string } | undefined
      const url = typeof row?.url === 'string' ? row.url.trim() : ''
      if (!url) return null
      return { url, mime: row?.mime ?? 'video/mp4' }
    },
    thumbUrl: options.thumbUrl,
    previewUrl: options.previewUrl,
    sourceUrl: options.sourceUrl,
  }
}

/**
 * 判断一个素材 hash 是否真有可消费的内容。
 *
 * 本地素材必须能读回字节，且重新计算的内容 hash 与引用一致；只有合法
 * http(s) 视频允许以远端 URL 作为唯一内容来源。这张表的主键存在本身不算通过。
 */
export async function assetHashIsReadable(
  assets: AssetPort,
  hash: string,
): Promise<boolean> {
  const payload = await assets.read(hash).catch(() => null)
  if (payload && payload.bytes.length > 0) {
    const actual = await fingerprintBytes(payload.bytes).catch(() => '')
    return actual.toLowerCase() === hash.toLowerCase()
  }
  const remote = await assets.readUrl(hash).catch(() => null)
  return Boolean(
    remote?.url &&
      /^https?:\/\//i.test(remote.url) &&
      remote.mime.trim().toLowerCase().startsWith('video/'),
  )
}

/** 按内容寻址写入生成素材；每一条写完都立即读回校验。 */
export async function putGeneratedAssets(
  storage: StoragePort,
  assetsPort: AssetPort,
  projectId: string,
  generated: readonly GeneratedAsset[],
  at = Date.now(),
): Promise<void> {
  for (const asset of generated) {
    await storage.put('assets', {
      id: asset.hash,
      hash: asset.hash,
      mime: asset.mime,
      bytes: asset.bytes,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
      ...(asset.url ? { url: asset.url } : {}),
      ...(asset.requestedWidth ? { requestedWidth: asset.requestedWidth } : {}),
      ...(asset.requestedHeight ? { requestedHeight: asset.requestedHeight } : {}),
      createdAt: at,
      projectId,
    } as never)
    if (!(await assetHashIsReadable(assetsPort, asset.hash))) {
      throw new Error(`素材 ${asset.hash} 写入后仍不可读或内容校验失败`)
    }
  }
}
