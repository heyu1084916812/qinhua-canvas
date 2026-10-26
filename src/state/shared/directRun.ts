import {
  createRunRecord,
  type RunRecord,
  type RunRecordScope,
} from '../../domain/shared/execution/runRecord'
import type { NodeInput, RunStatus } from '../../domain/shared/execution/types'
import type { GeneratedAsset } from '../../platform/channels/types'
import type { PlatformKit } from '../../platform/ports'
import { fingerprintHex } from '../../domain/shared/hash'
import { createId } from '../../shared/id'
import { asAppError, describeError, errorTextOf } from '../../shared/result'
import {
  ChannelRemovalInterruptedError,
  registerGuardedChannelRun,
  unregisterGuardedChannelRun,
} from './runChannelGuard'

export interface DirectRunTraceInput extends RunRecordScope {
  projectId: string
  version?: number
  inputs?: NodeInput[]
  params?: unknown
  fingerprint: string
  sentChannelId?: string
  sentModel?: string
}

export interface DirectRunResult<T> {
  result: T
  record: RunRecord
  /** 生成成功但日志补写失败时的真实原因；不改变本次生成结果。 */
  recordWarning?: string
}

/**
 * 单次付费文字调用的统一作用域。请求正文只进 params / fingerprint，
 * 作用域字段由调用方按真实业务对象传入，不能从节点 id 或项目 id 猜工作台。
 */
export function directTextTrace(args: {
  projectId: string
  workbench: DirectRunTraceInput['workbench']
  subjectId: string
  scopeId: string
  operationId: string
  purpose: string
  channelId: string
  model: string
  prompt: string
  inputs?: NodeInput[]
  params?: Readonly<Record<string, unknown>>
  version?: number
}): DirectRunTraceInput {
  const inputs = [...(args.inputs ?? [])]
  return {
    projectId: args.projectId,
    version: args.version,
    scopeVersion: 1,
    workbench: args.workbench,
    subjectId: args.subjectId,
    scopeId: args.scopeId,
    operationId: args.operationId,
    inputs,
    params: {
      ...args.params,
      kind: 'text',
      purpose: args.purpose,
      channelId: args.channelId,
      model: args.model,
      prompt: args.prompt,
    },
    fingerprint: fingerprintHex(
      JSON.stringify({
        purpose: args.purpose,
        channelId: args.channelId,
        model: args.model,
        prompt: args.prompt,
        inputs,
      }),
    ),
    sentChannelId: args.channelId,
    sentModel: args.model,
  }
}

function reportRecordWarning(
  callback: ((warning: string) => void) | undefined,
  warning: string | undefined,
): void {
  if (!warning || !callback) return
  try {
    callback(warning)
  } catch {
    // UI 提示通道坏掉不能覆盖原始生成结果 / 错误。
  }
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
  /** Channel used by this direct call; guards the call against channel removal. */
  channelId?: string
  signal?: AbortSignal
  call: (signal: AbortSignal) => Promise<T>
  outputHashesOf: (result: T) => string[]
  outputAssetOf?: (result: T) => GeneratedAsset | undefined
  onRecordWarning?: (warning: string) => void
  now?: () => number
}): Promise<DirectRunResult<T>> {
  const now = args.now ?? (() => Date.now())
  const startedAt = now()
  const controller = new AbortController()
  let interrupted = false
  const abortFromParent = () => controller.abort(args.signal?.reason)
  if (args.signal?.aborted) abortFromParent()
  else args.signal?.addEventListener('abort', abortFromParent, { once: true })

  const guardedChannelId = args.channelId?.trim() || args.trace.sentChannelId?.trim()
  const guardId = guardedChannelId ? createId('directguard') : null
  if (guardId && guardedChannelId) {
    registerGuardedChannelRun(guardId, {
      taskChannels: new Map([[guardId, guardedChannelId]]),
      cancel: () => {
        interrupted = true
        controller.abort()
      },
      onInterrupted: () => {
        interrupted = true
        controller.abort()
      },
    })
  }

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
    scope: {
      scopeVersion: args.trace.scopeVersion,
      workbench: args.trace.workbench,
      subjectId: args.trace.subjectId,
      scopeId: args.trace.scopeId,
      operationId: args.trace.operationId,
      ...(args.trace.parentRunId ? { parentRunId: args.trace.parentRunId } : {}),
    } satisfies RunRecordScope,
    ...(args.trace.sentChannelId ? { sentChannelId: args.trace.sentChannelId } : {}),
    ...(args.trace.sentModel ? { sentModel: args.trace.sentModel } : {}),
  }

  try {
    const result = await args.call(controller.signal)
    if (interrupted) throw new ChannelRemovalInterruptedError()
    const finishedAt = now()
    const asset = args.outputAssetOf?.(result)
    const record: RunRecord = createRunRecord({
      ...base,
      status: 'succeeded',
      outputHashes: args.outputHashesOf(result),
      durationMs: Math.max(0, finishedAt - startedAt),
      ...(asset?.width ? { outputWidth: asset.width } : {}),
      ...(asset?.height ? { outputHeight: asset.height } : {}),
    })
    const recordWarning = await persistRecord(args.storage, record)
    reportRecordWarning(args.onRecordWarning, recordWarning)
    return {
      result,
      record,
      ...(recordWarning ? { recordWarning } : {}),
    }
  } catch (error) {
    const finishedAt = now()
    const status = statusOf(error, controller.signal)
    const app = asAppError(error)
    const record: RunRecord = createRunRecord({
      ...base,
      status,
      outputHashes: [],
      durationMs: Math.max(0, finishedAt - startedAt),
      ...(status === 'failed'
        ? {
            errorText: app ? describeError(app) : errorTextOf(error),
          }
        : {}),
    })
    const recordWarning = await persistRecord(args.storage, record)
    reportRecordWarning(args.onRecordWarning, recordWarning)
    throw interrupted ? new ChannelRemovalInterruptedError() : error
  } finally {
    args.signal?.removeEventListener('abort', abortFromParent)
    if (guardId) unregisterGuardedChannelRun(guardId)
  }
}

/** `runDirectGeneration` 的单次文字调用薄包装：文字请求永远没有媒体产物。 */
export async function runDirectText(args: {
  storage: PlatformKit['storage']
  trace: DirectRunTraceInput
  channelId?: string
  signal?: AbortSignal
  call: (signal: AbortSignal) => Promise<string>
  onRecordWarning?: (warning: string) => void
  now?: () => number
}): Promise<string> {
  const finished = await runDirectGeneration({
    storage: args.storage,
    trace: args.trace,
    channelId: args.channelId ?? args.trace.sentChannelId,
    signal: args.signal,
    call: args.call,
    outputHashesOf: () => [],
    ...(args.onRecordWarning ? { onRecordWarning: args.onRecordWarning } : {}),
    ...(args.now ? { now: args.now } : {}),
  })
  return finished.result
}
