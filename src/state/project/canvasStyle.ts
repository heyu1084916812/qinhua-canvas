import type { RowOf, StoragePort } from '../../platform/ports'
import {
  readCanvasStyle,
  withCanvasStyle,
  type CanvasStyle,
} from '../../domain/project/canvasStyle'

/**
 * 项目级画布外观偏好的读写（对账 #379 的 C 步）。
 *
 * 与 `state/project/cover.ts` 同一套写法与同一条理由：
 * 项目行是**整行覆盖写**，所以「读 → 合并 extra → 写回」必须放进一个事务，
 * 否则会把读之后发生的改名 / 软删 / 又一次导入覆盖掉。
 *
 * **不动 `updatedAt`**：改背景色不是"项目被编辑"，
 * 顺手改它会连带影响项目页的「最近编辑」排序。
 */

/** 读当前项目的画布偏好；项目不存在 / 读失败都给默认（画布不该因为偏好读不到而打不开） */
export async function loadCanvasStyle(
  storage: StoragePort,
  projectId: string,
): Promise<CanvasStyle> {
  try {
    const rows = (await storage.query('projects', { id: projectId })) as RowOf<'projects'>[]
    const row = rows[0]
    if (!row) return readCanvasStyle(undefined)
    return readCanvasStyle((row as Record<string, unknown>).extra)
  } catch {
    return readCanvasStyle(undefined)
  }
}

/**
 * 写回画布偏好。
 *
 * 返回"是否真的写了"：值没变时不写库（设置面板每点一下都调它，
 * 反复写同一份数据只会让存储层白忙）。
 * 写失败**不抛** —— 界面已经按新值渲染了，这一次没落库不该把面板弄崩；
 * 调用方拿返回值决定要不要提示。
 */
export async function saveCanvasStyle(
  storage: StoragePort,
  projectId: string,
  style: CanvasStyle,
): Promise<boolean> {
  if (!projectId || projectId === 'demo') return false
  let wrote = false
  try {
    await storage.transaction(['projects'], async (tx) => {
      const rows = (await tx.query('projects', { id: projectId })) as RowOf<'projects'>[]
      const row = rows[0]
      if (!row) return
      const extra = (row as Record<string, unknown>).extra
      const current = readCanvasStyle(extra)
      if (JSON.stringify(current) === JSON.stringify(style)) return
      await tx.put(
        'projects',
        { ...(row as Record<string, unknown>), extra: withCanvasStyle(extra, style) } as never,
      )
      wrote = true
    })
  } catch {
    return false
  }
  return wrote
}
