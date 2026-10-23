import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  WORKBENCH_ITEM_GAP,
  WORKBENCH_TASK_GAP,
  layoutEcommerceResults,
  mergeWorkbenchItems,
  ratioAspectOf,
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
    autoLayout:
      typeof row.autoLayout === 'boolean' ? row.autoLayout : !!row.resultId,
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
    ...(typeof row.shotTitle === 'string' && row.shotTitle ? { shotTitle: row.shotTitle } : {}),
    ...(typeof row.brief === 'string' && row.brief ? { brief: row.brief } : {}),
    ...(typeof row.ratio === 'string' && row.ratio ? { ratio: row.ratio } : {}),
    ...(typeof row.headline === 'string' && row.headline ? { headline: row.headline } : {}),
    ...(typeof row.subheadline === 'string' && row.subheadline
      ? { subheadline: row.subheadline }
      : {}),
    ...(typeof row.visualSystem === 'string' && row.visualSystem
      ? { visualSystem: row.visualSystem }
      : {}),
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
      const retainedExisting = existing.filter((item) => !removedIds.has(item.id))
      const retainedByTask = new Map<string, EcommerceCanvasItem[]>()
      for (const item of retainedExisting) {
        const key = item.taskId ?? ''
        const group = retainedByTask.get(key) ?? []
        group.push(item)
        retainedByTask.set(key, group)
      }
      let globalRight = retainedExisting.reduce(
        (right, item) => Math.max(right, item.x + item.width),
        Number.NEGATIVE_INFINITY,
      )
      const columnX = new Map<string, number>()
      const taskBottom = new Map<string, number>()
      for (const [taskId, group] of retainedByTask) {
        columnX.set(taskId, Math.min(...group.map((item) => item.x)))
        taskBottom.set(
          taskId,
          Math.max(...group.map((item) => item.y + item.height)),
        )
      }
      const added = merged.added.map((item) => {
        const key = item.taskId ?? ''
        let x = columnX.get(key)
        if (x === undefined) {
          x = Math.max(
            item.x,
            Number.isFinite(globalRight) ? globalRight + WORKBENCH_TASK_GAP : item.x,
          )
          columnX.set(key, x)
          globalRight = Math.max(globalRight, x + item.width)
        }
        const previousBottom = taskBottom.get(key)
        const y = previousBottom === undefined
          ? item.y
          : previousBottom + WORKBENCH_ITEM_GAP
        taskBottom.set(key, y + item.height)
        return materialize({ ...item, x, y }, at)
      })
      const resultByResultId = new Map(results.map((result) => [result.id, result]))
      const desiredByResultId = new Map(
        desired
          .filter((item) => item.resultId)
          .map((item) => [item.resultId as string, item] as const),
      )
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
          const aspect =
            result.width && result.height
              ? result.width / result.height
              : result.ratio
                ? ratioAspectOf(result.ratio)
                : ratioAspectOf(task?.request.ratio)
          const next = {
            ...item,
            kind,
            taskId: result.taskId,
            assetHash: result.assetHash ?? item.assetHash,
            ...(item.autoLayout && aspect
              ? { height: Math.max(120, Math.round(item.width / aspect)) }
              : {}),
            updatedAt: at,
          } satisfies EcommerceCanvasItem
          return next
        })
      const reflowedExisting = (() => {
        const positions = new Map<string, { x: number; y: number }>()
        for (const item of updatedExisting) {
          if (!item.autoLayout || !item.resultId) continue
          const target = desiredByResultId.get(item.resultId)
          if (target) positions.set(item.id, { x: target.x, y: target.y })
        }
        return updatedExisting.map((item) => {
          const position = positions.get(item.id)
          return position === undefined ? item : { ...item, ...position }
        })
      })()
      const finalItems = [
        ...reflowedExisting,
        ...added,
      ].sort((a, b) => a.zIndex - b.zIndex || a.createdAt - b.createdAt)
      await storage.transaction(['ecommerceCanvasItems'], async (tx) => {
        if (merged.removedIds.length > 0) {
          for (const id of merged.removedIds) await tx.delete('ecommerceCanvasItems', id)
        }
        if (added.length > 0) await tx.bulkPut('ecommerceCanvasItems', added as never)
        const changed = reflowedExisting.filter((item) => {
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
