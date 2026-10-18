import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  statusOfResult,
  statusOfTask,
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
    at?: number
  }): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
  updateResult(result: EcommerceResultRecord): Promise<void>
  updateTask(task: EcommerceTaskRecord): Promise<void>
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
    position: Number(row.position) || 0,
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    status: statusOfResult(row.status),
    ...(stringOrUndefined(row.assetHash) ? { assetHash: String(row.assetHash) } : {}),
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
    async create({ projectId, batchId, request, nodeIds, at = Date.now() }) {
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

    async updateTask(task) {
      await storage.put('ecommerceTasks', task as never)
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
