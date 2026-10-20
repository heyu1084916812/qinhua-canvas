import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  statusOfResult,
  statusOfTask,
  taskStatusOf,
  type EcommerceResultRecord,
  type EcommerceTaskRecord,
} from '../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../domain/ecommerce/types'

/**
 * 电商任务 / 结果的持久化仓储（对账 #399 第二期）。
 *
 * 这里是电商工作区自己的结果真源：结果展示读这两张表，
 * 画布节点只作为内部执行载体，不再由界面直接拿节点反推"这一批出过什么"。
 */
export interface EcommerceTaskRepository {
  create(input: {
    projectId: string
    batchId: string
    request: EcommerceRequest
    nodeIds: readonly string[]
    sourceTaskId?: string
    sourceResultId?: string
    sourceAssetHash?: string
    at?: number
  }): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
  appendResults(
    taskId: string,
    nodeIds: readonly string[],
  ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
  updateResult(result: EcommerceResultRecord): Promise<void>
  updateTask(task: EcommerceTaskRecord): Promise<void>
  removeResult(
    resultId: string,
    at?: number,
  ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] } | null>
  interruptUnfinished(
    taskId: string,
    reason: string,
    at?: number,
  ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] } | null>
  results(taskId: string): Promise<EcommerceResultRecord[]>
  latestWithResults(projectId: string): Promise<{
    task: EcommerceTaskRecord
    results: EcommerceResultRecord[]
  } | null>
  list(projectId: string): Promise<EcommerceTaskRecord[]>
  remove(taskId: string): Promise<void>
}

function taskOf(row: Record<string, unknown>): EcommerceTaskRecord {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    batchId: String(row.batchId),
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    status: statusOfTask(row.status),
    request: (row.request ?? {}) as EcommerceRequest,
    nodeIds: Array.isArray(row.nodeIds) ? row.nodeIds.map(String) : [],
    ...(typeof row.sourceTaskId === 'string' && row.sourceTaskId
      ? { sourceTaskId: row.sourceTaskId }
      : {}),
    ...(typeof row.sourceResultId === 'string' && row.sourceResultId
      ? { sourceResultId: row.sourceResultId }
      : {}),
    ...(typeof row.sourceAssetHash === 'string' && row.sourceAssetHash
      ? { sourceAssetHash: row.sourceAssetHash }
      : {}),
    ...(typeof row.errorText === 'string' && row.errorText ? { errorText: row.errorText } : {}),
  }
}

function resultOf(row: Record<string, unknown>): EcommerceResultRecord {
  const numberOrUndefined = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const stringOrUndefined = (value: unknown) =>
    typeof value === 'string' && value.length > 0 ? value : undefined
  return {
    id: String(row.id),
    taskId: String(row.taskId),
    projectId: String(row.projectId),
    nodeId: String(row.nodeId),
    ...(stringOrUndefined(row.canvasCopyNodeId)
      ? { canvasCopyNodeId: String(row.canvasCopyNodeId) }
      : {}),
    position: Number(row.position) || 0,
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    status: statusOfResult(row.status),
    ...(stringOrUndefined(row.assetHash) ? { assetHash: String(row.assetHash) } : {}),
    ...(stringOrUndefined(row.mime) ? { mime: String(row.mime) } : {}),
    ...(numberOrUndefined(row.width) !== undefined ? { width: Number(row.width) } : {}),
    ...(numberOrUndefined(row.height) !== undefined ? { height: Number(row.height) } : {}),
    ...(stringOrUndefined(row.prompt) ? { prompt: String(row.prompt) } : {}),
    ...(stringOrUndefined(row.model) ? { model: String(row.model) } : {}),
    ...(stringOrUndefined(row.errorText) ? { errorText: String(row.errorText) } : {}),
  }
}

export function createEcommerceTaskRepository(storage: StoragePort): EcommerceTaskRepository {
  const resultsOf = async (taskId: string) =>
    (
      (await storage.query('ecommerceResults', { taskId })) as unknown as Record<string, unknown>[]
    )
      .map(resultOf)
      .sort((a, b) => a.position - b.position)

  return {
    async create({
      projectId,
      batchId,
      request,
      nodeIds,
      sourceTaskId,
      sourceResultId,
      sourceAssetHash,
      at = Date.now(),
    }) {
      const taskId = createId('ect')
      const task: EcommerceTaskRecord = {
        id: taskId,
        projectId,
        batchId,
        createdAt: at,
        updatedAt: at,
        status: 'running',
        request,
        nodeIds: [...nodeIds],
        ...(sourceTaskId ? { sourceTaskId } : {}),
        ...(sourceResultId ? { sourceResultId } : {}),
        ...(sourceAssetHash ? { sourceAssetHash } : {}),
      }
      const results: EcommerceResultRecord[] = nodeIds.map((nodeId, position) => ({
        id: createId('ecr'),
        taskId,
        projectId,
        nodeId,
        position,
        createdAt: at,
        updatedAt: at,
        status: 'pending',
      }))
      await storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        await tx.put('ecommerceTasks', task as never)
        await tx.bulkPut('ecommerceResults', results as never)
      })
      return { task, results }
    },

    async updateResult(result) {
      await storage.put('ecommerceResults', result as never)
    },

    async appendResults(taskId, nodeIds) {
      const taskRows = (await storage.query('ecommerceTasks', { id: taskId })) as unknown as Record<
        string,
        unknown
      >[]
      const task = taskRows.map(taskOf)[0]
      if (!task) throw new Error(`电商任务不存在：${taskId}`)
      const existing = await resultsOf(taskId)
      const currentIds = new Set(task.nodeIds)
      const appendedIds = [...new Set(nodeIds)].filter((id) => id && !currentIds.has(id))
      const at = Date.now()
      const start = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1
      const appended: EcommerceResultRecord[] = appendedIds.map((nodeId, offset) => ({
        id: createId('ecr'),
        taskId,
        projectId: task.projectId,
        nodeId,
        position: start + offset,
        createdAt: at,
        updatedAt: at,
        status: 'pending',
      }))
      const nextTask: EcommerceTaskRecord = {
        ...task,
        updatedAt: at,
        status: appended.length > 0 ? 'running' : task.status,
        nodeIds: [...task.nodeIds, ...appendedIds],
      }
      await storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        await tx.put('ecommerceTasks', nextTask as never)
        if (appended.length > 0) await tx.bulkPut('ecommerceResults', appended as never)
      })
      return { task: nextTask, results: [...existing, ...appended] }
    },

    async updateTask(task) {
      await storage.put('ecommerceTasks', task as never)
    },

    async removeResult(resultId, at = Date.now()) {
      return storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        const resultRows = (await tx.query('ecommerceResults', {
          id: resultId,
        })) as unknown as Record<string, unknown>[]
        const target = resultRows.map(resultOf)[0]
        if (!target || (target.status !== 'failed' && target.status !== 'canceled')) return null
        const taskRows = (await tx.query('ecommerceTasks', {
          id: target.taskId,
        })) as unknown as Record<string, unknown>[]
        const task = taskRows.map(taskOf)[0]
        if (!task) return null
        await tx.delete('ecommerceResults', resultId)
        const remaining = (
          (await tx.query('ecommerceResults', {
            taskId: task.id,
          })) as unknown as Record<string, unknown>[]
        )
          .map(resultOf)
          .sort((a, b) => a.position - b.position)
        const nextTask: EcommerceTaskRecord = {
          ...task,
          updatedAt: at,
          status: taskStatusOf(remaining),
          nodeIds: remaining.map((row) => row.nodeId),
        }
        delete nextTask.errorText
        await tx.put('ecommerceTasks', nextTask as never)
        return { task: nextTask, results: remaining }
      })
    },

    async interruptUnfinished(taskId, reason, at = Date.now()) {
      return storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        const taskRows = (await tx.query('ecommerceTasks', { id: taskId })) as unknown as Record<
          string,
          unknown
        >[]
        const task = taskRows.map(taskOf)[0]
        if (!task || task.status !== 'running') return null
        const rows = (await tx.query('ecommerceResults', {
          taskId,
        })) as unknown as Record<string, unknown>[]
        const results = rows
          .map(resultOf)
          .sort((a, b) => a.position - b.position)
          .map((row) =>
            row.status === 'pending' || row.status === 'running'
              ? { ...row, status: 'failed' as const, errorText: reason, updatedAt: at }
              : row,
          )
        const nextTask: EcommerceTaskRecord = {
          ...task,
          status: taskStatusOf(results),
          errorText: reason,
          updatedAt: at,
        }
        await tx.put('ecommerceTasks', nextTask as never)
        await tx.bulkPut('ecommerceResults', results as never)
        return { task: nextTask, results }
      })
    },

    results: resultsOf,

    async latestWithResults(projectId) {
      const rows = (await storage.query('ecommerceTasks', { projectId })) as unknown as Record<
        string,
        unknown
      >[]
      const tasks = rows
        .map(taskOf)
        .sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)
      for (const task of tasks) {
        const results = await resultsOf(task.id)
        if (results.length > 0) return { task, results }
      }
      return null
    },

    async list(projectId) {
      const rows = (await storage.query('ecommerceTasks', { projectId })) as unknown as Record<
        string,
        unknown
      >[]
      return rows.map(taskOf).sort((a, b) => b.createdAt - a.createdAt)
    },

    async remove(taskId) {
      await storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        await tx.delete('ecommerceTasks', taskId)
        const rows = await tx.query('ecommerceResults', { taskId })
        for (const row of rows) await tx.delete('ecommerceResults', row.id)
      })
    },
  }
}
