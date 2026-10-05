import { assetFileName } from '../domain/shared/assetLocation'
import type { AssetFolderPort, Row } from './ports'
import { toBytes } from './assets'

/**
 * 一行的写盘结果（对账 #196 · 增量 5 起成为**共用实现**：镜像与"导出全部"走同一份）。
 *
 * 为什么要四种状态而不是"成功 / 失败"两种：
 * - `exists` 与 `no-bytes` 都不是失败，但**在"导出全部"里必须分开报** ——
 *   前者是"这份内容已经在盘上了"（内容寻址，同名即同 hash），
 *   后者是"这一行只有远端地址、没有本地字节"（视频成片那种）⇒ **搬不过去**，用户得知道。
 *   把它们混成一句"跳过 N 个"，用户就会以为素材都搬完了。
 */
export type AssetWriteStatus = 'written' | 'exists' | 'no-bytes' | 'failed'

export interface AssetWriteResult {
  /** 目标文件名（`<hash>.<ext>`）—— 失败也要有名字，否则报错说不清是哪一个 */
  name: string
  status: AssetWriteStatus
  /** 仅 `failed` 时有 */
  reason?: string
}

/**
 * 把一行素材写到素材文件夹（**写盘这件事的唯一实现**）。
 *
 * 三条约定（都有理由，别随手改）：
 * 1. **只写本地字节**（`bytes`）。远端产物（视频成片）行里只有 `url`，没有字节可写 ⇒ `no-bytes`。
 * 2. **文件名 = `<hash>.<ext>`**，所以「已存在」等价于「这份内容已经在了」—— `has` 命中就不再写
 *    （`exists`），重复导入同一张图不会反复落盘（与 `assets` 表的内容寻址幂等同一套道理）。
 * 3. **写盘失败绝不抛**：磁盘可能只读、可能被拔了、可能没权限 —— 那都不该让上层链路失败，
 *    只把原因回报给调用方（由它决定是记日志还是显示给用户）。
 */
export async function writeAssetRow(folder: AssetFolderPort, row: Row): Promise<AssetWriteResult> {
  const mime = typeof row.mime === 'string' && row.mime ? row.mime : 'image/png'
  const name = assetFileName(String(row.id), mime)
  const bytes = toBytes(row.bytes)
  if (!bytes || bytes.length === 0) return { name, status: 'no-bytes' }
  try {
    if (await folder.has(name)) return { name, status: 'exists' }
    await folder.write(name, new Blob([bytes as BlobPart], { type: mime }))
    return { name, status: 'written' }
  } catch (err) {
    return { name, status: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 把 `assets` 表的行镜像到**素材文件夹**（对账 #196 · 增量 2）。
 *
 * 约定见 `writeAssetRow`（这里只是"逐行调用它 + 把失败记进日志"）。
 * 落库成功之后才调它：写盘失败**绝不影响落库**。
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
    const result = await writeAssetRow(folder, row)
    if (result.status === 'written') written += 1
    else if (result.status === 'failed') {
      onError('[assetMirror] 写素材文件夹失败', { name: result.name, error: result.reason ?? '' })
    }
  }
  return written
}
