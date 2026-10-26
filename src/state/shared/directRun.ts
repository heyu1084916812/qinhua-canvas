import type {
  RunRecord,
  RunRecordScope,
} from '../../domain/shared/execution/runRecord'
import type { NodeInput, RunStatus } from '../../domain/shared/execution/types'
import type { GeneratedAsset } from '../../platform/channels/types'
import type { PlatformKit } from '../../platform/ports'
import { createId } from '../../shared/id'
import { asAppError, describeError, errorTextOf } from '../../shared/result'

export interface DirectRunTraceInput extends RunRecordScope {
  projectId: string
  version?: number
  inputs?: NodeInput[]
  params?: unknown
  fingerprint: string
}

export interface DirectRunResult<T> {
  result: T
  record: RunRecord
  /** 生成成功但日志补写失败时的真实原因；不改变本次生成结果。 */
  recordWarning?: string
}

function statusOf(error: unknown, signal?: AbortSignal): RunStatus {
  const app = asAppError(error)
  if (
    signal?.aborted ||
    (app?.kind === 'network' && app.detail === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return 'canceled'
  }
  return 'failed'
}

async function persistRecord(
  storage: PlatformKit['storage'],
  record: RunRecord,
): Promise<string | undefined> {
  let lastError: unknown
  /**
   * 只重试日志写入。生成、轮询和付费请求都不能因为这里失败而重跑。
   */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await storage.put('runRecords', record as never)
      return undefined
    } catch (error) {
      lastError = error
    }
  }
  return errorTextOf(lastError)
}

/**
 * 不经过 runEngine 的单次工作台动作也必须统一留痕。
 *
 * 这个助手只负责计时、构造 RunRecord 和幂等写日志；业务调用、结果投影与重跑
 * 仍由工作台自己的控制器决定。它不重试生成，也不会把日志写入失败冒充成生成失败。
 */
export async function runDirectGeneration<T>(args: {
  storage: PlatformKit['storage']
  trace: DirectRunTraceInput
  signal?: AbortSignal
  call: () => Promise<T>
  outputHashesOf: (result: T) => string[]
  outputAssetOf?: (result: T) => GeneratedAsset | undefined
  now?: () => number
}): Promise<DirectRunResult<T>> {
  const now = args.now ?? (() => Date.now())
  const startedAt = now()
  const base = {
    id: createId('rec'),
    nodeId: args.trace.subjectId,
    projectId: args.trace.projectId,
    version: args.trace.version ?? 1,
    createdAt: startedAt,
    inputs: [...(args.trace.inputs ?? [])],
    params: args.trace.params,
    fingerprint: args.trace.fingerprint,
    taskId: createId('task'),
    scopeVersion: args.trace.scopeVersion,
    workbench: args.trace.workbench,
    subjectId: args.trace.subjectId,
    ...(args.trace.scopeId ? { scopeId: args.trace.scopeId } : {}),
    ...(args.trace.parentRunId ? { parentRunId: args.trace.parentRunId } : {}),
    ...(args.trace.operationId ? { operationId: args.trace.operationId } : {}),
  }

  try {
    const result = await args.call()
    const finishedAt = now()
    const asset = args.outputAssetOf?.(result)
    const record: RunRecord = {
      ...base,
      status: 'succeeded',
      outputHashes: args.outputHashesOf(result),
      durationMs: Math.max(0, finishedAt - startedAt),
      ...(asset?.width ? { outputWidth: asset.width } : {}),
      ...(asset?.height ? { outputHeight: asset.height } : {}),
    }
    const recordWarning = await persistRecord(args.storage, record)
    return {
      result,
      record,
      ...(recordWarning ? { recordWarning } : {}),
    }
  } catch (error) {
    const finishedAt = now()
    const status = statusOf(error, args.signal)
    const app = asAppError(error)
    const record: RunRecord = {
      ...base,
      status,
      outputHashes: [],
      durationMs: Math.max(0, finishedAt - startedAt),
      ...(status === 'failed'
        ? {
            errorText: app ? describeError(app) : errorTextOf(error),
          }
        : {}),
    }
    await persistRecord(args.storage, record)
    throw error
  }
}
