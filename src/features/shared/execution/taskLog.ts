import type { StoragePort } from '../../../platform/ports'

/**
 * `tasks` 表的**滚动裁剪**（产品文档 §6.18 / §8：*按项目保留最近 500 条，超出滚动裁剪*）。
 *
 * ## 为什么要真做这件事（2026-10-12，对账 #460）
 *
 * 文档写了三处"500 条上限 / 滚动裁剪"，而代码里**一处裁剪都没有**。同时查实：
 * `tasks` 表**当前没有任何读取方** —— 日志面板读的是 `runRecords`（那一份**故意永不裁剪**，
 * 是执行留痕），而 `tasks` 每跑一条计划就写一整行（含计划全文），还进了**全库备份白名单**。
 * 不裁剪就是典型的一种**"看不见的堆积"**：备份越来越大、按项目查库越来越慢，
 * 而用户与后来的作者都以为"它有上限"。
 *
 * ## 口径
 *
 * 按 `createdAt` **倒序**留最近 `keep` 条，其余删掉；时间戳相同的用 `id` 兜底排序
 * （稳定、可复现，不依赖查询返回顺序）。返回**删掉的条数**（0 = 没到上限，什么都没做）。
 *
 * ⚠️ 调用方请**不要 await**（它是排障用的日志表，绝不该挡住出图这条主路），失败也只记日志。
 */
export async function trimProjectTasks(
  storage: StoragePort,
  projectId: string,
  keep = 500,
): Promise<number> {
  const rows = await storage.query('tasks', { projectId })
  if (rows.length <= keep) return 0
  const at = (row: { createdAt?: unknown }) => Number(row.createdAt ?? 0)
  const sorted = [...rows].sort((a, b) => {
    const bt = at(b as { createdAt?: unknown })
    const atT = at(a as { createdAt?: unknown })
    if (atT !== bt) return bt - atT
    return String(b.id).localeCompare(String(a.id))
  })
  const doomed = sorted.slice(keep)
  for (const row of doomed) await storage.delete('tasks', String(row.id))
  return doomed.length
}
