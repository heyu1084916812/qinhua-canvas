import type { RowOf, StoragePort } from '../../platform/ports'
import {
  normalizeEcommerceFormDraft,
  readEcommerceFormDraft,
  withEcommerceFormDraft,
  type EcommerceFormDraft,
} from '../../domain/ecommerce/draft'

/**
 * 电商左侧草稿的项目级落库（对账 #477）。
 *
 * 与 `canvasStyle` / `cover` 同一条写法：项目行是整行覆盖写，
 * 所以「读 → 合并 extra → 写回」必须在同一个事务里，否则会把并发发生的
 * 改名 / 软删 / 批次号 / 封面标记覆盖掉。改草稿不算"项目被编辑"，
 * **不动 `updatedAt`**。
 */

export async function loadEcommerceDraft(
  storage: StoragePort,
  projectId: string,
): Promise<EcommerceFormDraft | null> {
  try {
    const rows = (await storage.query('projects', { id: projectId })) as RowOf<'projects'>[]
    return readEcommerceFormDraft((rows[0] as Record<string, unknown> | undefined)?.extra)
  } catch {
    return null
  }
}

/** 返回是否真写了；值没变不写，失败不抛（草稿记不上不该挡出图）。 */
export async function saveEcommerceDraft(
  storage: StoragePort,
  projectId: string,
  draft: EcommerceFormDraft,
): Promise<boolean> {
  if (!projectId || projectId === 'demo') return false
  const normalized = normalizeEcommerceFormDraft(draft)
  let wrote = false
  try {
    await storage.transaction(['projects'], async (tx) => {
      const rows = (await tx.query('projects', { id: projectId })) as RowOf<'projects'>[]
      const row = rows[0]
      if (!row) return
      const current = readEcommerceFormDraft((row as Record<string, unknown>).extra)
      if (JSON.stringify(current) === JSON.stringify(normalized)) return
      await tx.put(
        'projects',
        {
          ...(row as Record<string, unknown>),
          extra: withEcommerceFormDraft((row as Record<string, unknown>).extra, normalized),
        } as never,
      )
      wrote = true
    })
  } catch {
    return false
  }
  return wrote
}
