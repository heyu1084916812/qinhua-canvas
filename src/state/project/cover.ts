import type { RowOf, StoragePort } from '../../platform/ports'
import { readCoverMark, withCoverMark } from '../../domain/project/cover'

/**
 * 把"这一张图刚进了某个项目的画布"记到项目行上（对账 #289）。
 *
 * 只做一件事：读回项目行 → 合并 `extra.cover` → 写回。
 * **不动 `updatedAt`**：那是"项目本身被编辑"的时间，与"哪个文件被导入"是两件事，
 * 顺手改它会连带影响「最近编辑」排序（那不在这次的范围内）。
 *
 * 三次幂等保护：
 *  1. 项目行读不到（已被删）→ 什么都不做，不新建一行脏数据；
 *  2. 记的就是同一张图 → 直接返回，不写库（重复导入同一张图很常见）；
 *  3. 写失败 → 由调用方决定（导入不该因为"封面没记上"而失败，所以这里不抛）。
 */
export async function rememberCanvasCover(
  storage: StoragePort,
  projectId: string,
  hash: string,
  at: number = Date.now(),
): Promise<void> {
  if (!hash) return
  try {
    const rows = (await storage.query('projects', { id: projectId })) as RowOf<'projects'>[]
    const row = rows[0]
    if (!row) return
    const extra = (row as Record<string, unknown>).extra
    if (readCoverMark(extra)?.hash === hash) return
    await storage.put(
      'projects',
      { ...(row as Record<string, unknown>), extra: withCoverMark(extra, hash, at) } as never,
    )
  } catch {
    /* 封面记不上不影响这次导入：卡片回落上一张封面或网格占位 */
  }
}
