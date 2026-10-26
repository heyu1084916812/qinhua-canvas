import type { AssetPort, StoragePort } from '../../platform/ports'
import {
  assetHashIsReadable,
  createStorageAssetPort,
  putGeneratedAssets,
} from '../../platform/assets'
import type { GeneratedAsset } from '../../platform/channels/types'
import { createId } from '../../shared/id'
import {
  statusOfResult,
  statusOfTask,
  taskStatusOf,
  resultMetadataOf,
  type EcommerceResultRecord,
  type EcommerceResultMetadata,
  type EcommerceTaskRecord,
} from '../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../domain/ecommerce/types'

export interface QueuedAssetSave {
  id: string
  projectId: string
  resultId: string
  taskId: string
  planId: string
  prompt: string
  model: string
  assets: readonly GeneratedAsset[]
  createdAt: number
  updatedAt: number
  errorText?: string
}

export interface RetryAssetSaveResult {
  ok: boolean
  result: EcommerceResultRecord | null
  errorText?: string
}

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
    metadata?: readonly EcommerceResultMetadata[]
    sourceTaskId?: string
    sourceResultId?: string
    sourceAssetHash?: string
    at?: number
  }): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
  appendResults(
    taskId: string,
    nodeIds: readonly string[],
    metadata?: readonly EcommerceResultMetadata[],
  ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
  updateResult(result: EcommerceResultRecord): Promise<void>
  /**
   * 正常提交的唯一落库入口：写素材、读回校验、再置 done。
   *
   * 任一步失败都会留下 retry-save 句柄；不会把只有主键或损坏字节的结果标完成。
   */
  commitAssets(input: {
    resultId: string
    planId: string
    prompt: string
    model: string
    assets: readonly GeneratedAsset[]
    at?: number
  }): Promise<RetryAssetSaveResult>
  /**
   * 模型已成功、素材写入失败时，把同一份产物存进内部恢复队列并把结果切到
   * `failed + retry-save`。后续只能重试保存，不能重新请求模型。
   */
  markRetrySave(input: {
    resultId: string
    planId: string
    prompt: string
    model: string
    assets: readonly GeneratedAsset[]
    errorText: string
    at?: number
  }): Promise<EcommerceResultRecord | null>
  /** 从内部恢复队列重试同一份产物；成功后才清队列。 */
  retrySave(resultId: string, at?: number): Promise<RetryAssetSaveResult>
  /** 只给诊断与单测使用：查看内部恢复句柄是否真的持久化。 */
  queuedSave(resultId: string): Promise<QueuedAssetSave | null>
  result(resultId: string): Promise<EcommerceResultRecord | null>
  refreshTaskStatus(taskId: string, at?: number): Promise<EcommerceTaskRecord | null>
  setResultHidden(resultId: string, hidden: boolean, at?: number): Promise<void>
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
    ...(numberOrUndefined(row.hiddenAt) !== undefined
      ? { hiddenAt: Number(row.hiddenAt) }
      : {}),
    ...(numberOrUndefined(row.width) !== undefined ? { width: Number(row.width) } : {}),
    ...(numberOrUndefined(row.height) !== undefined ? { height: Number(row.height) } : {}),
    ...(stringOrUndefined(row.prompt) ? { prompt: String(row.prompt) } : {}),
    ...(stringOrUndefined(row.model) ? { model: String(row.model) } : {}),
    ...(stringOrUndefined(row.errorText) ? { errorText: String(row.errorText) } : {}),
    ...(row.recovery === 'retry-save' ? { recovery: 'retry-save' as const } : {}),
    ...resultMetadataOf({
      shotTitle: stringOrUndefined(row.shotTitle),
      brief: stringOrUndefined(row.brief),
      ratio: stringOrUndefined(row.ratio),
      headline: stringOrUndefined(row.headline),
      subheadline: stringOrUndefined(row.subheadline),
      visualSystem: stringOrUndefined(row.visualSystem),
    }),
  }
}

/** RunRecord 的成功产物可能不止一张；电商一格只认第一张。 */
function firstOutputHashOf(run: Record<string, unknown> | undefined): string | undefined {
  if (!Array.isArray(run?.outputHashes)) return undefined
  return run.outputHashes.map(String).find((hash) => hash.length > 0)
}

function queuedSaveOf(row: Record<string, unknown>): QueuedAssetSave {
  const assets = Array.isArray(row.assets)
    ? (row.assets as GeneratedAsset[])
    : []
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    resultId: String(row.resultId ?? ''),
    taskId: String(row.taskId ?? ''),
    planId: String(row.planId ?? ''),
    prompt: String(row.prompt ?? ''),
    model: String(row.model ?? ''),
    assets,
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    ...(typeof row.errorText === 'string' && row.errorText
      ? { errorText: row.errorText }
      : {}),
  }
}

export function createEcommerceTaskRepository(
  storage: StoragePort,
  assets: AssetPort = createStorageAssetPort(storage),
): EcommerceTaskRepository {
  const putAssets = async (
    projectId: string,
    queuedAssets: readonly GeneratedAsset[],
    at: number,
  ) => {
    await putGeneratedAssets(storage, assets, projectId, queuedAssets, at)
  }

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
      metadata,
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
        ...resultMetadataOf(metadata?.[position] ?? {}),
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

    async commitAssets({
      resultId,
      planId,
      prompt,
      model,
      assets: nextAssets,
      at = Date.now(),
    }) {
      const current = await this.result(resultId)
      const primary = nextAssets[0]
      if (!current) {
        return {
          ok: false,
          result: null,
          errorText: `电商结果不存在：${resultId}`,
        }
      }
      if (!primary) {
        return {
          ok: false,
          result: current,
          errorText: '生成成功但没有返回可落库的产物',
        }
      }
      try {
        await putAssets(current.projectId, nextAssets, at)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        let failed: EcommerceResultRecord | null = null
        try {
          failed = await this.markRetrySave({
            resultId,
            planId,
            prompt,
            model,
            assets: nextAssets,
            errorText: `生成已成功，但素材保存失败：${reason}。请重试保存结果，不要重新生成。`,
            at,
          })
        } catch (recoveryError) {
          const {
            errorText: _oldError,
            recovery: _oldRecovery,
            assetHash: _oldAssetHash,
            mime: _oldMime,
            width: _oldWidth,
            height: _oldHeight,
            ...rest
          } = current
          failed = {
            ...rest,
            status: 'failed',
            prompt,
            model,
            errorText:
              `生成已成功，但素材保存失败：${reason}；` +
              `恢复句柄也写入失败：${
                recoveryError instanceof Error
                  ? recoveryError.message
                  : String(recoveryError)
              }`,
            updatedAt: at,
          }
          await this.updateResult(failed)
        }
        return {
          ok: false,
          result: failed,
          errorText: `素材保存失败：${reason}`,
        }
      }

      const {
        errorText: _oldError,
        recovery: _oldRecovery,
        ...rest
      } = current
      const done: EcommerceResultRecord = {
        ...rest,
        status: 'done',
        assetHash: primary.hash,
        mime: primary.mime,
        prompt,
        model,
        ...(primary.width ? { width: primary.width } : {}),
        ...(primary.height ? { height: primary.height } : {}),
        updatedAt: at,
      }
      try {
        await this.updateResult(done)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        let failed: EcommerceResultRecord | null = null
        try {
          failed = await this.markRetrySave({
            resultId,
            planId,
            prompt,
            model,
            assets: nextAssets,
            errorText: `素材已保存，但结果状态写入失败：${reason}。请重试保存结果。`,
            at,
          })
        } catch {
          failed = {
            ...current,
            status: 'failed',
            prompt,
            model,
            errorText: `素材已保存，但结果状态写入失败：${reason}`,
            updatedAt: at,
          }
          await this.updateResult(failed)
        }
        return {
          ok: false,
          result: failed,
          errorText: `结果状态写入失败：${reason}`,
        }
      }
      return { ok: true, result: done }
    },

    async markRetrySave({
      resultId,
      planId,
      prompt,
      model,
      assets: queuedAssets,
      errorText,
      at = Date.now(),
    }) {
      const rows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      const row = rows.map(resultOf)[0]
      if (!row) return null
      const {
        errorText: _oldError,
        recovery: _oldRecovery,
        assetHash: _oldAssetHash,
        mime: _oldMime,
        width: _oldWidth,
        height: _oldHeight,
        ...rest
      } = row
      const next: EcommerceResultRecord = {
        ...rest,
        status: 'failed',
        recovery: 'retry-save',
        prompt,
        model,
        errorText,
        updatedAt: at,
      }
      const queued: QueuedAssetSave = {
        id: resultId,
        projectId: row.projectId,
        resultId,
        taskId: row.taskId,
        planId,
        prompt,
        model,
        assets: [...queuedAssets],
        createdAt: at,
        updatedAt: at,
        errorText,
      }
      await storage.transaction(
        ['assetSaveQueue', 'ecommerceResults'],
        async (tx) => {
          await tx.put('assetSaveQueue', queued as never)
          await tx.put('ecommerceResults', next as never)
        },
      )
      return next
    },

    async retrySave(resultId, at = Date.now()) {
      const queued = await this.queuedSave(resultId)
      const current = await this.result(resultId)
      if (!queued || !current) {
        return {
          ok: false,
          result: current,
          errorText: '没有找到可恢复的保存句柄，请查看运行日志',
        }
      }
      try {
        await putAssets(queued.projectId, queued.assets, at)
      } catch (error) {
        const message = `重试保存失败：${error instanceof Error ? error.message : String(error)}`
        let outcome: RetryAssetSaveResult = {
          ok: false,
          result: current,
          errorText: message,
        }
        await storage.transaction(
          ['assetSaveQueue', 'ecommerceResults'],
          async (tx) => {
            const resultRows = await tx.query('ecommerceResults', {
              id: resultId,
            })
            const queueRows = await tx.query('assetSaveQueue', { resultId })
            const latest = (resultRows as unknown as Record<string, unknown>[])
              .map(resultOf)[0]
            const latestQueue = (queueRows as unknown as Record<string, unknown>[])
              .map(queuedSaveOf)[0]
            if (
              !latest ||
              !latestQueue ||
              latest.updatedAt !== current.updatedAt ||
              latestQueue.updatedAt !== queued.updatedAt ||
              latest.status !== 'failed' ||
              latest.recovery !== 'retry-save'
            ) {
              outcome = {
                ok: false,
                result: latest ?? null,
                errorText: '结果状态已变化，旧恢复句柄已停止写入',
              }
              return
            }
            const { errorText: _oldError, recovery: _oldRecovery, ...rest } =
              latest
            const failed: EcommerceResultRecord = {
              ...rest,
              status: 'failed',
              recovery: 'retry-save',
              errorText: message,
              updatedAt: at,
            }
            await tx.put(
              'assetSaveQueue',
              { ...latestQueue, updatedAt: at, errorText: message } as never,
            )
            await tx.put('ecommerceResults', failed as never)
            outcome = { ok: false, result: failed, errorText: message }
          },
        )
        return outcome
      }
      const primary = queued.assets[0]
      let outcome: RetryAssetSaveResult = {
        ok: false,
        result: current,
        errorText: '结果状态已变化，旧恢复句柄已停止写入',
      }
      await storage.transaction(
        ['assetSaveQueue', 'ecommerceResults'],
        async (tx) => {
          const resultRows = await tx.query('ecommerceResults', {
            id: resultId,
          })
          const queueRows = await tx.query('assetSaveQueue', { resultId })
          const latest = (resultRows as unknown as Record<string, unknown>[])
            .map(resultOf)[0]
          const latestQueue = (queueRows as unknown as Record<string, unknown>[])
            .map(queuedSaveOf)[0]
          if (
            !latest ||
            !latestQueue ||
            latest.updatedAt !== current.updatedAt ||
            latestQueue.updatedAt !== queued.updatedAt ||
            latest.status !== 'failed' ||
            latest.recovery !== 'retry-save'
          ) {
            outcome = {
              ok: false,
              result: latest ?? null,
              errorText: '结果状态已变化，旧恢复句柄已停止写入',
            }
            return
          }
          const {
            errorText: _oldError,
            recovery: _oldRecovery,
            ...rest
          } = latest
          const done: EcommerceResultRecord = {
            ...rest,
            status: 'done',
            prompt: latestQueue.prompt,
            model: latestQueue.model,
            ...(primary
              ? {
                  assetHash: primary.hash,
                  mime: primary.mime,
                  ...(primary.width ? { width: primary.width } : {}),
                  ...(primary.height ? { height: primary.height } : {}),
                }
              : {}),
            updatedAt: at,
          }
          await tx.put('ecommerceResults', done as never)
          await tx.delete('assetSaveQueue', resultId)
          outcome = { ok: true, result: done }
        },
      )
      if (outcome.ok && outcome.result) {
        await this.refreshTaskStatus(outcome.result.taskId, at)
      }
      return outcome
    },

    async queuedSave(resultId) {
      const rows = (await storage.query('assetSaveQueue', {
        resultId,
      })) as unknown as Record<string, unknown>[]
      return rows.map(queuedSaveOf)[0] ?? null
    },

    async result(resultId) {
      const rows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      return rows.map(resultOf)[0] ?? null
    },

    async refreshTaskStatus(taskId, at = Date.now()) {
      const taskRows = (await storage.query('ecommerceTasks', {
        id: taskId,
      })) as unknown as Record<string, unknown>[]
      const task = taskRows.map(taskOf)[0]
      if (!task) return null
      const rows = await resultsOf(taskId)
      const failed = rows.find((row) => row.status === 'failed' && row.errorText)
      const { errorText: _oldError, ...rest } = task
      const next: EcommerceTaskRecord = {
        ...rest,
        updatedAt: at,
        status: taskStatusOf(rows),
        ...(failed?.errorText ? { errorText: failed.errorText } : {}),
      }
      await storage.put('ecommerceTasks', next as never)
      return next
    },

    async setResultHidden(resultId, hidden, at = Date.now()) {
      const rows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      const row = rows.map(resultOf)[0]
      if (!row) return
      const { hiddenAt: _hiddenAt, ...rest } = row
      await storage.put(
        'ecommerceResults',
        (hidden ? { ...rest, hiddenAt: at } : rest) as never,
      )
    },

    async appendResults(taskId, nodeIds, metadata) {
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
      const appended: EcommerceResultRecord[] = appendedIds.map((nodeId, offset) => {
        const sourceIndex = nodeIds.indexOf(nodeId)
        return {
          id: createId('ecr'),
          taskId,
          projectId: task.projectId,
          nodeId,
          position: start + offset,
          createdAt: at,
          updatedAt: at,
          status: 'pending',
          ...resultMetadataOf(metadata?.[sourceIndex >= 0 ? sourceIndex : offset] ?? {}),
        }
      })
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
      return storage.transaction(
        ['ecommerceTasks', 'ecommerceResults', 'assetSaveQueue'],
        async (tx) => {
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
          await tx.delete('assetSaveQueue', resultId)
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
        },
      )
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
      const [taskRows, resultRows, runRows, queueRows] = await Promise.all([
        storage.query('ecommerceTasks', { projectId }),
        storage.query('ecommerceResults', { projectId }),
        storage.query('runRecords', { projectId }),
        storage.query('assetSaveQueue', { projectId }),
      ])
      const tasks = (taskRows as unknown as Record<string, unknown>[]).map(taskOf)
      const results = (resultRows as unknown as Record<string, unknown>[]).map(resultOf)
      const queuedByResult = new Map(
        (queueRows as unknown as Record<string, unknown>[])
          .map(queuedSaveOf)
          .map((row) => [row.resultId, row] as const),
      )
      const latestByNode = new Map<string, Record<string, unknown>>()
      for (const run of (runRows as unknown as Record<string, unknown>[]).sort(
        (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
      )) {
        const nodeId = String(run.nodeId ?? '')
        if (nodeId && !latestByNode.has(nodeId)) latestByNode.set(nodeId, run)
      }
      const outputHashesToVerify = new Set<string>()
      for (const row of results) {
        const run = latestByNode.get(row.nodeId)
        const runHash =
          String(run?.status ?? '') === 'succeeded'
            ? firstOutputHashOf(run)
            : undefined
        const hash = runHash ?? row.assetHash
        if (
          hash &&
          (Boolean(runHash) ||
            row.status === 'done' ||
            row.recovery === 'retry-save')
        ) {
          outputHashesToVerify.add(hash)
        }
      }
      const readableHashes = new Set<string>()
      for (const hash of outputHashesToVerify) {
        if (await assetHashIsReadable(assets, hash)) readableHashes.add(hash)
      }
      const changed: EcommerceResultRecord[] = []
      const nextResults = results.map((row) => {
        const run = latestByNode.get(row.nodeId)
        const runStatus = String(run?.status ?? '')
        const runOutputHash = firstOutputHashOf(run)
        const active = row.status === 'pending' || row.status === 'running'
        const needsHashBackfill = row.status === 'done' && !row.assetHash
        const needsRetrySave = row.recovery === 'retry-save'
        const needsIntegrityCheck = row.status === 'done' && Boolean(row.assetHash)
        if (
          (!active &&
            !needsHashBackfill &&
            !needsRetrySave &&
            !needsIntegrityCheck)
        ) {
          return row
        }
        if (
          run &&
          runStatus !== 'succeeded' &&
          runStatus !== 'failed' &&
          runStatus !== 'canceled'
        ) {
          return row
        }
        if (!run && active) return row
        const succeeded = run ? runStatus === 'succeeded' : row.status === 'done'
        const outputHash = succeeded ? runOutputHash ?? row.assetHash : undefined
        const outputAssetExists = Boolean(
          outputHash && readableHashes.has(outputHash),
        )
        if (
          succeeded &&
          outputHash &&
          outputAssetExists &&
          row.status === 'done' &&
          row.assetHash === outputHash &&
          !row.recovery
        ) {
          return row
        }
        const assetHash = succeeded
          ? outputAssetExists
            ? outputHash
            : undefined
          : row.assetHash
        const queued = queuedByResult.get(row.id)
        const {
          errorText: _oldError,
          recovery: _oldRecovery,
          assetHash: _oldAssetHash,
          mime: _oldMime,
          width: _oldWidth,
          height: _oldHeight,
          ...rest
        } = row
        const next: EcommerceResultRecord = {
          ...rest,
          updatedAt: at,
          status: succeeded ? (assetHash ? 'done' : 'failed') : 'failed',
          ...(assetHash ? { assetHash } : {}),
          ...(assetHash && (row.mime || queued?.assets[0]?.mime)
            ? { mime: row.mime ?? queued?.assets[0]?.mime }
            : {}),
          ...(assetHash && succeeded && typeof run?.sentModel === 'string'
            ? { model: run.sentModel }
            : {}),
          ...(assetHash &&
          typeof run?.outputWidth === 'number' &&
          run.outputWidth > 0
            ? { width: run.outputWidth }
            : {}),
          ...(assetHash &&
          typeof run?.outputHeight === 'number' &&
          run.outputHeight > 0
            ? { height: run.outputHeight }
            : {}),
          ...(succeeded && outputHash && !outputAssetExists && queued
            ? {
                recovery: 'retry-save' as const,
                errorText:
                  queued.errorText ??
                  '生成已成功，但素材字节不在库中。请重试保存同一产物，不要重新生成。',
              }
            : !succeeded || !assetHash
            ? {
                errorText:
                  !succeeded &&
                  typeof run?.errorText === 'string' &&
                  run.errorText
                    ? run.errorText
                    : !succeeded
                      ? '这次 API 调用失败，但上游没有返回可读原因'
                      : '生成已完成，但没有找到可展示的产物',
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
        if (
          task.status !== taskStatusOf(rows) ||
          realError !== task.errorText
        ) {
          affected.add(task.id)
        }
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
      await storage.transaction(
        ['ecommerceTasks', 'ecommerceResults', 'assetSaveQueue'],
        async (tx) => {
        await tx.delete('ecommerceTasks', taskId)
        const rows = await tx.query('ecommerceResults', { taskId })
        for (const row of rows) await tx.delete('ecommerceResults', row.id)
          const queued = await tx.query('assetSaveQueue', { taskId })
          for (const row of queued) await tx.delete('assetSaveQueue', row.id)
        },
      )
    },
  }
}
