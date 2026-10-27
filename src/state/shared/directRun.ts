import {
  createRunRecord,
  type RunAttemptRecord,
  type RunRecord,
  type RunRecordScope,
} from '../../domain/shared/execution/runRecord'
import type { NodeInput, RunStatus } from '../../domain/shared/execution/types'
import type { GeneratedAsset } from '../../platform/channels/types'
import type { PlatformKit } from '../../platform/ports'
import { fingerprintHex } from '../../domain/shared/hash'
import { isRouteFallbackSafe } from '../../domain/shared/task'
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
  /** 用户选择的逻辑模型；与真正发往上游的 sentModel 分开记录。 */
  requestedModel?: string
  routePlanId?: string
}

export interface DirectRunRouteCandidate {
  channelId: string
  credentialGroupId?: string
  model: string
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
    requestedModel: args.model,
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

function attemptErrorMeta(
  error: ReturnType<typeof asAppError>,
  callStarted: boolean,
): Pick<RunAttemptRecord, 'errorKind' | 'httpStatus' | 'sendPhase'> {
  if (!error) return { sendPhase: callStarted ? 'unknown' : 'not-sent' }
  if (error.kind === 'network') {
    return {
      errorKind: error.kind,
      sendPhase: error.sendPhase ?? 'unknown',
    }
  }
  if (error.kind === 'http') {
    return {
      errorKind: error.kind,
      httpStatus: error.status,
      sendPhase: 'rejected',
    }
  }
  if (error.kind === 'execution') {
    return { errorKind: error.kind, sendPhase: 'accepted' }
  }
  return {
    errorKind: error.kind,
    sendPhase: callStarted ? 'unknown' : 'not-sent',
  }
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
  /** Frozen route candidates for this direct call. Each entry is one real attempt. */
  routeCandidates?: readonly DirectRunRouteCandidate[]
  signal?: AbortSignal
  call: (
    signal: AbortSignal,
    route: DirectRunRouteCandidate | undefined,
  ) => Promise<T>
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

  const routeCandidates = (args.routeCandidates ?? []).filter(
    (candidate) => candidate.channelId.trim() && candidate.model.trim(),
  )
  const fallbackChannelId =
    args.channelId?.trim() || args.trace.sentChannelId?.trim() || ''
  const guardedChannelIds = [
    ...new Set([
      ...routeCandidates.map((candidate) => candidate.channelId),
      ...(fallbackChannelId ? [fallbackChannelId] : []),
    ]),
  ]
  const guardId = guardedChannelIds.length > 0 ? createId('directguard') : null
  if (guardId) {
    registerGuardedChannelRun(guardId, {
      taskChannels: new Map(
        guardedChannelIds.map((channelId) => [channelId, channelId]),
      ),
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
      ...(args.trace.action ? { action: args.trace.action } : {}),
      subjectId: args.trace.subjectId,
      scopeId: args.trace.scopeId,
      operationId: args.trace.operationId,
      ...(args.trace.parentRunId ? { parentRunId: args.trace.parentRunId } : {}),
    } satisfies RunRecordScope,
    ...(args.trace.routePlanId ? { routePlanId: args.trace.routePlanId } : {}),
  }

  const attempts: RunAttemptRecord[] = []
  const attemptCount = Math.max(1, routeCandidates.length)
  let lastRoute: DirectRunRouteCandidate | undefined
  let lastChannelId =
    fallbackChannelId || args.trace.sentChannelId?.trim() || ''
  let lastModel = args.trace.sentModel?.trim() || ''
  const trackAttempts = routeCandidates.length > 0 || Boolean(lastChannelId || lastModel)

  try {
    let result: T | undefined
    let lastFinishedAt = startedAt
    for (let index = 0; index < attemptCount; index += 1) {
      const route = routeCandidates[index]
      if (route) {
        lastRoute = route
        lastChannelId = route.channelId
        lastModel = route.model
      }
      const attemptStartedAt = index === 0 ? startedAt : now()
      try {
        result = await args.call(controller.signal, route)
        const attemptFinishedAt = now()
        lastFinishedAt = attemptFinishedAt
        if (trackAttempts) {
          attempts.push({
            attempt: index + 1,
            channelId: lastChannelId,
            ...(route?.credentialGroupId
              ? { credentialGroupId: route.credentialGroupId }
              : {}),
            requestedModel:
              args.trace.requestedModel?.trim() ||
              args.trace.sentModel?.trim() ||
              lastModel,
            sentModel: lastModel,
            status: controller.signal.aborted ? 'canceled' : 'succeeded',
            sendPhase: 'accepted',
            startedAt: attemptStartedAt,
            finishedAt: attemptFinishedAt,
            durationMs: Math.max(0, attemptFinishedAt - attemptStartedAt),
          })
        }
        break
      } catch (error) {
        const attemptFinishedAt = now()
        lastFinishedAt = attemptFinishedAt
        const normalized = asAppError(error)
        const canceled = controller.signal.aborted
        if (trackAttempts) {
          attempts.push({
            attempt: index + 1,
            channelId: lastChannelId,
            ...(route?.credentialGroupId
              ? { credentialGroupId: route.credentialGroupId }
              : {}),
            requestedModel:
              args.trace.requestedModel?.trim() ||
              args.trace.sentModel?.trim() ||
              lastModel,
            sentModel: lastModel,
            status: canceled ? 'canceled' : 'failed',
            startedAt: attemptStartedAt,
            finishedAt: attemptFinishedAt,
            durationMs: Math.max(0, attemptFinishedAt - attemptStartedAt),
            ...attemptErrorMeta(normalized, true),
            ...(canceled || !normalized ? {} : { errorText: describeError(normalized) }),
          })
        }
        if (canceled) throw error
        const hasNext = index + 1 < routeCandidates.length
        if (normalized && hasNext && isRouteFallbackSafe(normalized)) continue
        throw error
      }
    }
    if (result === undefined) {
      throw new Error('直连调用没有执行任何路由候选')
    }
    if (interrupted) throw new ChannelRemovalInterruptedError()
    const finishedAt = lastFinishedAt
    const asset = args.outputAssetOf?.(result)
    const record: RunRecord = createRunRecord({
      ...base,
      ...(lastChannelId ? { sentChannelId: lastChannelId } : {}),
      ...(lastModel ? { sentModel: lastModel } : {}),
      ...(lastRoute?.credentialGroupId
        ? { credentialGroupId: lastRoute.credentialGroupId }
        : {}),
      ...(attempts.length > 0 ? { routeAttempts: attempts } : {}),
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
      ...(lastChannelId ? { sentChannelId: lastChannelId } : {}),
      ...(lastModel ? { sentModel: lastModel } : {}),
      ...(lastRoute?.credentialGroupId
        ? { credentialGroupId: lastRoute.credentialGroupId }
        : {}),
      ...(attempts.length > 0 ? { routeAttempts: attempts } : {}),
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
  routeCandidates?: readonly DirectRunRouteCandidate[]
  signal?: AbortSignal
  call: (
    signal: AbortSignal,
    route: DirectRunRouteCandidate | undefined,
  ) => Promise<string>
  onRecordWarning?: (warning: string) => void
  now?: () => number
}): Promise<string> {
  const finished = await runDirectGeneration({
    storage: args.storage,
    trace: args.trace,
    channelId: args.channelId ?? args.trace.sentChannelId,
    ...(args.routeCandidates ? { routeCandidates: args.routeCandidates } : {}),
    signal: args.signal,
    call: args.call,
    outputHashesOf: () => [],
    ...(args.onRecordWarning ? { onRecordWarning: args.onRecordWarning } : {}),
    ...(args.now ? { now: args.now } : {}),
  })
  return finished.result
}
