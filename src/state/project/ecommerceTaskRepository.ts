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
  /** 整个项目的逐格结果，供无限工作台按任务与 position 回填空间布局。 */
  listResults(projectId: string): Promise<EcommerceResultRecord[]>
  /**
   * 用 RunRecord 的终态 reconcile 电商结果与任务。
   *
   * 执行宿主会在 `runNode` 返回前清掉内存状态，因此只读 `nodeStateOf()` 会把
   * 已失败的 API 调用永久留在 running。RunRecord 是每次调用的持久事实源。
   */
  reconcileFromRunRecords(
    projectId: string,
    at?: number,
  ): Promise<{ results: EcommerceResultRecord[]; tasks: EcommerceTaskRecord[] }>
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
      /**
       * 结果行可能因为执行宿主在 `runNode` 收尾前清掉内存态而停在 running；
       * 此时界面依据 RunRecord 已显示失败，但用户点“移除记录”会被旧的
       * running 状态挡住，下一次 sync 又把它带回来。以最近一次 RunRecord
       * 的 failed / canceled 作为第二个可删除判据。
       */
      const beforeRows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      const before = beforeRows.map(resultOf)[0]
      if (!before) return null
      const runRows = (
        (await storage.query('runRecords', {
          projectId: before.projectId,
          nodeId: before.nodeId,
        })) as unknown as Record<string, unknown>[]
      ).sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      const latestRunStatus = String(runRows[0]?.status ?? '')
      const removable =
        before.status === 'failed' ||
        before.status === 'canceled' ||
        latestRunStatus === 'failed' ||
        latestRunStatus === 'canceled'
      if (!removable) return null
      return storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        const resultRows = (await tx.query('ecommerceResults', {
          id: resultId,
        })) as unknown as Record<string, unknown>[]
        const target = resultRows.map(resultOf)[0]
        if (!target) return null
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
      const previewRows = (await storage.query('ecommerceTasks', {
        id: taskId,
      })) as unknown as Record<string, unknown>[]
      const preview = previewRows.map(taskOf)[0]
      const runRows = preview
        ? ((await storage.query('runRecords', {
            projectId: preview.projectId,
          })) as unknown as Record<string, unknown>[])
        : []
      const latestRunByNode = new Map<string, Record<string, unknown>>()
      for (const run of runRows.sort(
        (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
      )) {
        const nodeId = String(run.nodeId ?? '')
        if (nodeId && !latestRunByNode.has(nodeId)) latestRunByNode.set(nodeId, run)
      }
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
              ? (() => {
                  const run = latestRunByNode.get(row.nodeId)
                  const runError =
                    String(run?.status ?? '') === 'failed' &&
                    typeof run?.errorText === 'string' &&
                    run.errorText
                      ? run.errorText
                      : reason
                  return { ...row, status: 'failed' as const, errorText: runError, updatedAt: at }
                })()
              : row,
          )
        const nextTask: EcommerceTaskRecord = {
          ...task,
          status: taskStatusOf(results),
          errorText:
            results.find((row) => row.status === 'failed' && row.errorText)?.errorText ?? reason,
          updatedAt: at,
        }
        await tx.put('ecommerceTasks', nextTask as never)
        await tx.bulkPut('ecommerceResults', results as never)
        return { task: nextTask, results }
      })
    },

    results: resultsOf,

    async reconcileFromRunRecords(projectId, at = Date.now()) {
      const [taskRows, resultRows, runRows] = await Promise.all([
        storage.query('ecommerceTasks', { projectId }),
        storage.query('ecommerceResults', { projectId }),
        storage.query('runRecords', { projectId }),
      ])
      const tasks = (taskRows as unknown as Record<string, unknown>[]).map(taskOf)
      const results = (resultRows as unknown as Record<string, unknown>[]).map(resultOf)
      const latestByNode = new Map<string, Record<string, unknown>>()
      for (const run of (runRows as unknown as Record<string, unknown>[]).sort(
        (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
      )) {
        const nodeId = String(run.nodeId ?? '')
        if (nodeId && !latestByNode.has(nodeId)) latestByNode.set(nodeId, run)
      }
      const changed: EcommerceResultRecord[] = []
      const nextResults = results.map((row) => {
        if (row.status !== 'pending' && row.status !== 'running') return row
        const run = latestByNode.get(row.nodeId)
        const runStatus = String(run?.status ?? '')
        if (runStatus !== 'succeeded' && runStatus !== 'failed' && runStatus !== 'canceled') {
          return row
        }
        const { errorText: _oldError, ...rest } = row
        const next: EcommerceResultRecord = {
          ...rest,
          updatedAt: at,
          status: runStatus === 'succeeded' ? 'done' : 'failed',
          ...(runStatus === 'succeeded' && typeof run?.sentModel === 'string'
            ? { model: run.sentModel }
            : {}),
          ...(typeof run?.outputWidth === 'number' && run.outputWidth > 0
            ? { width: run.outputWidth }
            : {}),
          ...(typeof run?.outputHeight === 'number' && run.outputHeight > 0
            ? { height: run.outputHeight }
            : {}),
          ...(runStatus !== 'succeeded'
            ? {
                errorText:
                  typeof run?.errorText === 'string' && run.errorText
                    ? run.errorText
                    : '这次 API 调用失败，但上游没有返回可读原因',
              }
            : {}),
        }
        changed.push(next)
        return next
      })
      const affected = new Set(changed.map((row) => row.taskId))
      for (const task of tasks) {
        const rows = nextResults.filter((row) => row.taskId === task.id)
        const realError = rows.find((row) => row.status === 'failed' && row.errorText)?.errorText
        if (realError && realError !== task.errorText) affected.add(task.id)
      }
      const nextTasks = tasks.map((task) => {
        if (!affected.has(task.id)) return task
        const rows = nextResults.filter((row) => row.taskId === task.id)
        const failed = rows.find((row) => row.status === 'failed' && row.errorText)
        const { errorText: _oldError, ...rest } = task
        return {
          ...rest,
          updatedAt: at,
          status: taskStatusOf(rows),
          ...(failed?.errorText ? { errorText: failed.errorText } : {}),
        } satisfies EcommerceTaskRecord
      })
      const changedTasks = nextTasks.filter(
        (task) => {
          const old = tasks.find((candidate) => candidate.id === task.id)
          return old?.status !== task.status || old?.errorText !== task.errorText
        },
      )
      await storage.transaction(['ecommerceResults', 'ecommerceTasks'], async (tx) => {
        if (changed.length > 0) await tx.bulkPut('ecommerceResults', changed as never)
        if (changedTasks.length > 0) await tx.bulkPut('ecommerceTasks', changedTasks as never)
      })
      return { results: nextResults, tasks: nextTasks }
    },

    async listResults(projectId) {
      return (
        (await storage.query('ecommerceResults', {
          projectId,
        })) as unknown as Record<string, unknown>[]
      )
        .map(resultOf)
        .sort((a, b) => a.createdAt - b.createdAt || a.position - b.position)
    },

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
