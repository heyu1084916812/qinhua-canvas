import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  WORKBENCH_ITEM_GAP,
  WORKBENCH_LEFT,
  WORKBENCH_TASK_GAP,
  layoutEcommerceResults,
  mergeWorkbenchItems,
  type EcommerceCanvasItem,
  type NewEcommerceCanvasItem,
} from '../../domain/ecommerce/canvasItem'
import {
  statusOfResult,
  statusOfTask,
  type EcommerceResultRecord,
  type EcommerceTaskRecord,
} from '../../domain/ecommerce/tasks'

export interface EcommerceCanvasRepository {
  list(projectId: string): Promise<EcommerceCanvasItem[]>
  /** 从任务 / 结果真源补旧布局；已有对象的坐标与旋转原样保留。 */
  sync(projectId: string, viewportWidth?: number): Promise<EcommerceCanvasItem[]>
  saveMany(items: readonly EcommerceCanvasItem[]): Promise<void>
  /** 用当前工作台对象集合替换项目布局（删除对象也走这里）。 */
  replace(projectId: string, items: readonly EcommerceCanvasItem[]): Promise<void>
  save(item: EcommerceCanvasItem): Promise<void>
  removeByResultIds(projectId: string, resultIds: readonly string[]): Promise<void>
}

function itemOf(row: Record<string, unknown>): EcommerceCanvasItem {
  const number = (value: unknown, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    kind: row.kind === 'video' || row.kind === 'text' ? row.kind : 'image',
    ...(typeof row.taskId === 'string' && row.taskId ? { taskId: row.taskId } : {}),
    ...(typeof row.resultId === 'string' && row.resultId ? { resultId: row.resultId } : {}),
    ...(typeof row.assetHash === 'string' && row.assetHash ? { assetHash: row.assetHash } : {}),
    ...(typeof row.text === 'string' ? { text: row.text } : {}),
    x: number(row.x),
    y: number(row.y),
    width: Math.max(1, number(row.width, 320)),
    height: Math.max(1, number(row.height, 240)),
    rotation: number(row.rotation),
    zIndex: Math.max(0, number(row.zIndex, 1)),
    aspectLocked: row.aspectLocked !== false,
    createdAt: number(row.createdAt),
    updatedAt: number(row.updatedAt),
  }
}

function taskOf(row: Record<string, unknown>): EcommerceTaskRecord {
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    batchId: String(row.batchId ?? ''),
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    status: statusOfTask(row.status),
    request: (row.request ?? {}) as EcommerceTaskRecord['request'],
    nodeIds: Array.isArray(row.nodeIds) ? row.nodeIds.map(String) : [],
  }
}

function resultOf(row: Record<string, unknown>): EcommerceResultRecord {
  return {
    id: String(row.id),
    taskId: String(row.taskId ?? ''),
    projectId: String(row.projectId ?? ''),
    nodeId: String(row.nodeId ?? ''),
    position: Number(row.position) || 0,
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    status: statusOfResult(row.status),
    ...(typeof row.assetHash === 'string' && row.assetHash
      ? { assetHash: row.assetHash }
      : {}),
    ...(typeof row.mime === 'string' && row.mime ? { mime: row.mime } : {}),
    ...(typeof row.hiddenAt === 'number' ? { hiddenAt: row.hiddenAt } : {}),
    ...(typeof row.width === 'number' ? { width: row.width } : {}),
    ...(typeof row.height === 'number' ? { height: row.height } : {}),
    ...(typeof row.prompt === 'string' ? { prompt: row.prompt } : {}),
    ...(typeof row.model === 'string' ? { model: row.model } : {}),
    ...(typeof row.errorText === 'string' ? { errorText: row.errorText } : {}),
  }
}

function materialize(item: NewEcommerceCanvasItem, at: number): EcommerceCanvasItem {
  return {
    ...item,
    id: createId('eci'),
    createdAt: at,
    updatedAt: at,
  }
}

export function createEcommerceCanvasRepository(
  storage: StoragePort,
): EcommerceCanvasRepository {
  const list = async (projectId: string): Promise<EcommerceCanvasItem[]> =>
    (
      (await storage.query('ecommerceCanvasItems', {
        projectId,
      })) as unknown as Record<string, unknown>[]
    )
      .map(itemOf)
      .sort((a, b) => a.zIndex - b.zIndex || a.createdAt - b.createdAt)

  return {
    list,

    async sync(projectId, viewportWidth = 1280) {
      const [taskRows, resultRows, existing] = await Promise.all([
        storage.query('ecommerceTasks', { projectId }),
        storage.query('ecommerceResults', { projectId }),
        list(projectId),
      ])
      const tasks = (taskRows as unknown as Record<string, unknown>[]).map(taskOf)
      const results = (resultRows as unknown as Record<string, unknown>[]).map(resultOf)
      const desired = layoutEcommerceResults(projectId, tasks, results, viewportWidth)
      const merged = mergeWorkbenchItems(existing, desired)
      const at = Date.now()
      const removedIds = new Set(merged.removedIds)
      /**
       * 已隐藏 / 已删除的结果对象不能参与下一批的底部计算。
       * 否则历史对象虽然会在本事务里删掉，新任务仍会先被排到它们下方几十屏之外，
       * 用户看到的就是“点了生成，画布里没有占位”。
       */
      const retainedExisting = existing.filter((item) => !removedIds.has(item.id))
      const taskBottom = new Map<string, number>()
      let globalBottom = retainedExisting.reduce(
        (bottom, item) => Math.max(bottom, item.y + item.height),
        Number.NEGATIVE_INFINITY,
      )
      const added = merged.added.map((item) => {
        const key = item.taskId ?? ''
        const existingInTask = retainedExisting.filter(
          (candidate) => (candidate.taskId ?? '') === key,
        )
        const existingTaskBottom = existingInTask.reduce(
          (bottom, candidate) => Math.max(bottom, candidate.y + candidate.height),
          Number.NEGATIVE_INFINITY,
        )
        const y = Number.isFinite(taskBottom.get(key))
          ? (taskBottom.get(key) as number) + WORKBENCH_ITEM_GAP
          : Number.isFinite(existingTaskBottom)
            ? existingTaskBottom + WORKBENCH_ITEM_GAP
            : Number.isFinite(globalBottom)
              ? globalBottom + WORKBENCH_TASK_GAP
              : item.y
        const positioned = { ...item, x: WORKBENCH_LEFT, y }
        taskBottom.set(key, y + positioned.height)
        globalBottom = Math.max(globalBottom, y + positioned.height)
        return materialize(positioned, at)
      })
      const resultByResultId = new Map(results.map((result) => [result.id, result]))
      const taskByTaskId = new Map(tasks.map((task) => [task.id, task]))
      const updatedExisting = merged.items
        .filter((item) => !item.id.startsWith('pending:'))
        .map((item) => {
          if (!item.resultId) return item
          const result = resultByResultId.get(item.resultId as string)
          if (!result) return item
          const task = taskByTaskId.get(result.taskId)
          const kind =
            result.mime?.startsWith('video/') || task?.request.mediaKind === 'video'
              ? 'video'
              : 'image'
          const wasPlaceholder = !item.assetHash
          const aspect =
            result.width && result.height
              ? result.width / result.height
              : null
          const next = {
            ...item,
            kind,
            taskId: result.taskId,
            assetHash: result.assetHash ?? item.assetHash,
            ...(wasPlaceholder && aspect
              ? { height: Math.max(120, Math.round(item.width / aspect)) }
              : {}),
            updatedAt: at,
          } satisfies EcommerceCanvasItem
          return next
        })
      const finalItems = [
        ...updatedExisting,
        ...added,
      ].sort((a, b) => a.zIndex - b.zIndex || a.createdAt - b.createdAt)
      await storage.transaction(['ecommerceCanvasItems'], async (tx) => {
        if (merged.removedIds.length > 0) {
          for (const id of merged.removedIds) await tx.delete('ecommerceCanvasItems', id)
        }
        if (added.length > 0) await tx.bulkPut('ecommerceCanvasItems', added as never)
        const changed = updatedExisting.filter((item) => {
          const before = existing.find((candidate) => candidate.id === item.id)
          return before && JSON.stringify(before) !== JSON.stringify(item)
        })
        for (const item of changed) await tx.put('ecommerceCanvasItems', item as never)
      })
      return finalItems
    },

    async saveMany(items) {
      if (items.length === 0) return
      await storage.bulkPut('ecommerceCanvasItems', items as never)
    },

    async replace(projectId, items) {
      await storage.transaction(['ecommerceCanvasItems'], async (tx) => {
        const current = await tx.query('ecommerceCanvasItems', { projectId })
        const nextIds = new Set(items.map((item) => item.id))
        for (const row of current) {
          if (!nextIds.has(String(row.id))) await tx.delete('ecommerceCanvasItems', String(row.id))
        }
        if (items.length > 0) {
          await tx.bulkPut('ecommerceCanvasItems', items as never)
        }
      })
    },

    async save(item) {
      await storage.put('ecommerceCanvasItems', item as never)
    },

    async removeByResultIds(projectId, resultIds) {
      const targets = new Set(resultIds.filter(Boolean))
      if (targets.size === 0) return
      const rows = await list(projectId)
      await storage.transaction(['ecommerceCanvasItems'], async (tx) => {
        for (const item of rows) {
          if (item.resultId && targets.has(item.resultId)) {
            await tx.delete('ecommerceCanvasItems', item.id)
          }
        }
      })
    },
  }
}
