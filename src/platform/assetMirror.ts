import { assetFileName } from '../domain/shared/assetLocation'
import type { AssetFolderPort, Row } from './ports'
import { toBytes } from './assets'

/**
 * 把 `assets` 表的行镜像到**素材文件夹**（对账 #196 · 增量 2）。
 *
 * 三条约定（都有理由，别随手改）：
 * 1. **只镜像本地字节**（`bytes`）。远端产物（视频成片）行里只有 `url`，没有字节可写，跳过。
 * 2. **文件名 = `<hash>.<ext>`**，所以「已存在」等价于「这份内容已经在了」—— `has` 命中就不再写，
 *    重复导入同一张图不会反复落盘（与 `assets` 表的内容寻址幂等同一套道理）。
 * 3. **写盘失败绝不影响落库**：这里只回报给调用方记日志，不抛。
 *    磁盘可能是只读、可能被拔了、可能没权限 —— 那都不该让「素材入库」这件事失败。
 *
 * @returns 真正写出去的文件数（跳过的不算）
 */
export async function mirrorAssetsToFolder(
  folder: AssetFolderPort | undefined,
  rows: readonly Row[],
  onError: (message: string, meta?: Record<string, unknown>) => void,
): Promise<number> {
  if (!folder?.current()) return 0
  let written = 0
  for (const row of rows) {
    const bytes = toBytes(row.bytes)
    if (!bytes || bytes.length === 0) continue
    const mime = typeof row.mime === 'string' && row.mime ? row.mime : 'image/png'
    const name = assetFileName(String(row.id), mime)
    try {
      if (await folder.has(name)) continue
      await folder.write(name, new Blob([bytes as BlobPart], { type: mime }))
      written += 1
    } catch (err) {
      onError('[assetMirror] 写素材文件夹失败', { name, error: String(err) })
    }
  }
  return written
}
