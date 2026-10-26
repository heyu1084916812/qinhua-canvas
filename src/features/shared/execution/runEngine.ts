import {
  runPlanWaves,
  type RunPlan,
  type RunTask,
} from '../../../domain/shared/execution/plan'
import type { RunRequest } from '../../../domain/shared/execution/types'
import {
  createRunRecord,
  type RunRecord,
  type RunRecordScope,
  type ScopedRunRecord,
} from '../../../domain/shared/execution/runRecord'
import type { TransactionBoundary } from '../../../state/shared/types'
import { describeError, type AppError } from '../../../shared/result'
import type { ChannelAdapter, GeneratedAsset } from '../../../platform/channels/types'
import { ChannelError } from '../../../platform/channels/types'
import {
  backoffMs,
  isRequestResendSafe,
  isRetryableStatus,
} from '../../../domain/shared/task'
import { createId } from '../../../shared/id'
import type { CollectedAsset, ExecutionPlacement } from './placement'

/**
 * 执行引擎（架构 §5.5）。**跨工作台共享**（本文件位于 features/shared/execution）。
 *
 * 这不是「把 canvas 的 runEngine 挪个位置」——M6-1 已如实记账：引擎的落位/写回逻辑
 * 本身就是画布命令形状的。M6-5 路径 B 把它们抽成注入式 `ExecutionPlacement`
 * （见 ./placement.ts），于是引擎本体变成**真正中性**的：
 * 不认识 dispatch、不持有状态、不知道 `node.create` / `resultGroup` / `RESULT_CELL` 为何物。
 * 它只按 plan 调度、重试、调用渠道，然后把产物交给适配器回答「怎么落」。
 *
 * 结果：喂一个 mock writeBack + mock 适配器就能在 node 下跑完整条计划（见既有单测）；
 * comic 工作台也得以复用同一引擎，只需提供自己的 `ComicPlacement`。
 *
 * 批量（§6.12）：同一主体展开出的多次调用必须**逐次可区分**——
 * 同一张素材在集合里出现两次时 nodeId 相同，若请求原样重复，
 * 渠道按 prompt+序号产出的 hash 就会撞车，N 张结果退化成 1 张。
 * 因此每次调用都在请求 prompt 上带一个稳定的「第 n 项」后缀（见 applyCallOrdinal）。
 */
export type RunTaskState =
  | { kind: 'queued' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'succeeded'; result: GeneratedAsset[]; duration: number }
  | { kind: 'failed'; error: AppError; attempts: number }
  | { kind: 'canceled' }

export interface RunSummary {
  runPlanId: string
  mode: RunPlan['mode']
  taskResults: { taskId: string; nodeId: string; state: RunTaskState }[]
  succeeded: number
  failed: number
  canceled: number
  startedAt: number
  finishedAt: number
  /** 本次执行产出的 RunRecord（成功 / 失败 / 取消各一条），由调用方落库 */
  records: ScopedRunRecord[]
}

export interface RunPolicy {
  maxRetries: number
  backoffBase: number
  retryableStatuses: number[]
}

export interface RunEngineDeps<TTask extends RunTask, TCommand> {
  /** runPlan 级取消信号：一次拓扑生成共用一个 */
  signal: AbortSignal
  /**
   * 引擎把图变更以「命令序列」提交，由调用方决定怎么落回 store。
   * 首次调用带 { mode:'multi-step', planId }，同 planId 的命令合并为一个撤销单元。
   * 命令的**具体形状**由各工作台定义（泛型 TCommand），引擎不解读。
   */
  writeBack: (commands: TCommand[], transaction?: TransactionBoundary) => void
  channelResolver: (request: RunRequest) => ChannelAdapter
  /** 项目 id，写 RunRecord 用 */
  projectId: string
  /** 落位 / 写回适配器：把产物翻译成工作台自己的命令（架构 §5.5 路径 B） */
  placement: ExecutionPlacement<TTask, TCommand>
  /**
   * 生成新 RunRecord 的必填业务作用域。
   *
   * 在调用渠道之前解析，记录写入失败或作用域缺失都不能让付费请求先发出去。
   * `targetId` 是 Placement 决定的真实落点；画布另建承载节点时必须用它，
   * 不能用触发任务的源节点冒充业务主体。
   */
  recordScope: (plan: RunPlan<TTask>, task: TTask, targetId: string) => RunRecordScope
  policy?: Partial<RunPolicy>
  /**
   * 任务状态变化（queued / running / succeeded / failed / canceled）。
   *
   * 首参 `planId`：并发时多个计划同时在跑，宿主需按 planId 精确定位该 task
   * 属于哪条链路，避免遍历全部计划时误改别的计划的状态。
   */
  onTaskUpdate?: (planId: string, taskId: string, state: RunTaskState) => void
  /**
   * 任务的实际落点（`placement.begin` 返回的 `targetId`）。
   *
   * 与 `onTaskUpdate` 分开：更新发生在**调用渠道前后**、那时落点已经确定，
   * 宿主据此把「生成中」画在**真正会收到产物的节点**上——
   * 画布在源节点已有内容时会另建承载节点，状态若仍挂在源节点上，
   * 用户看到的就是「转圈在旧节点、结果跑到新节点」（2026-09-16 报）。
   *
   * 首参 `planId` 用于并发时精确定位本计划，避免宿主遍历全部计划时改错对象。
   */
  onTaskTarget?: (planId: string, taskId: string, targetId: string) => void
  /** 版本号来源；未提供时每个主体都从 1 开始 */
  nextVersion?: (nodeId: string) => number
  /** 重试等待（默认真实 setTimeout；测试传 no-op 保持同步） */
  wait?: (ms: number) => Promise<void>
  now?: () => number
}

const DEFAULT_POLICY: RunPolicy = {
  maxRetries: 2,
  backoffBase: 1000,
  retryableStatuses: [429],
}

const MODE_LABEL: Record<RunPlan['mode'], string> = {
  single: '生成',
  rerun: '重跑下游',
  rerunAll: '全部重跑',
}

function normalizeError(e: unknown): AppError {
  if (e instanceof ChannelError) return e.appError
  if (e && typeof e === 'object' && 'kind' in e) return e as AppError
  if (e instanceof Error) {
    if (e.name === 'AbortError') {
      return { kind: 'network', detail: 'aborted', sendPhase: 'unknown' }
    }
    if (e.name === 'TimeoutError') {
      return { kind: 'network', detail: 'timeout', sendPhase: 'unknown' }
    }
  }
  return { kind: 'parse', raw: String(e) }
}

function isRetryable(error: AppError, policy: RunPolicy): boolean {
  /**
   * 付费 POST 一旦进入传输层，浏览器就无法证明上游是否已经受理。
   * DNS / TLS / CORS / 超时 / 响应丢失都必须按“可能已到达”处理；
   * 只有错误明确标记为 `not-sent` 时才允许再次提交。
   */
  if (error.kind === 'network') {
    return isRequestResendSafe(error)
  }
  if (error.kind === 'http') {
    // 408 可能发生在上游已受理之后；即使宿主误配 retryableStatuses，也不能重发付费 POST。
    if (error.status === 408) return false
    /*
     * 免费账户的速率限制通常是一个较长的冷却窗口。本轮内等 1–2 秒再打只会
     * 继续吃 429，还会把用户仅有的免费额度窗口搅得更久；直接如实返回，
     * 让用户等待后再试。普通 429（查询过频）仍走退避重试。
     */
    if (
      error.status === 429 &&
      /free user API rate limit|\u514d\u8d39\u7528\u6237\u7684\s*API\s*\u901f\u7387\u9650\u5236/i.test(
        error.body ?? '',
      )
    ) {
      return false
    }
    return policy.retryableStatuses.includes(error.status) || isRetryableStatus(error.status)
  }
  return false
}

/**
 * 同一渠道换 Key 分组前允许跨过的错误。
 *
 * 网络层无法可靠证明 DNS / TLS / CORS 错误发生在发送之前，自动换组
 * 同样会变成第二次付费提交。只有显式 `not-sent` 才可换组；
 * 401 / 403 / 429 / 5xx 才是服务端已给出响应的换 Key 范围。
 */
function isGroupSwitchable(error: AppError): boolean {
  if (error.kind === 'network') {
    return isRequestResendSafe(error)
  }
  if (error.kind === 'http') {
    return error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500
  }
  return false
}

function callChannel(
  adapter: ChannelAdapter,
  request: RunRequest,
  signal: AbortSignal,
): Promise<GeneratedAsset[]> {
  switch (request.kind) {
    case 'image':
      return adapter.generateImage(request, signal)
    case 'video':
      return adapter.generateVideo(request, signal)
    case 'text':
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    case 'speech': {
      if (!adapter.generateSpeech) {
        throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
      }
      const voice =
        typeof request.params.voice === 'string' && request.params.voice.trim()
          ? request.params.voice
          : 'alloy'
      const speed =
        typeof request.params.speed === 'number' &&
        Number.isFinite(request.params.speed)
          ? request.params.speed
          : undefined
      const format = request.params.responseFormat
      const responseFormat =
        format === 'mp3' ||
        format === 'wav' ||
        format === 'opus' ||
        format === 'aac' ||
        format === 'flac' ||
        format === 'pcm'
          ? format
          : 'mp3'
      return adapter
        .generateSpeech(
          {
            channelId: request.channelId,
            model: request.model,
            text: request.prompt,
            voice,
            ...(speed !== undefined ? { speed } : {}),
            responseFormat,
            ...(request.timeoutMs !== undefined
              ? { timeoutMs: request.timeoutMs }
              : {}),
          },
          signal,
        )
        .then((asset) => [asset])
    }
  }
}

/**
 * 给批量展开出的后续调用加「第 n 项」序号（§6.12）。
 *
 * 为什么需要：真实渠道多以 (model, prompt) 作为素材种子/缓存键。集合里有 2 张**不同**素材
 * 时提示词天然不同，但同一张素材被执行 2 次、或同一提示词连发 2 次时，
 * 请求完全一样 → 产出同一个素材 hash → N 张结果退化成 1 张。
 *
 * 只在 seq > 0 时追加，第 1 次调用保持原样：
 * - 单张场景（seq=0）路径与 M2 完全一致，回归测试的 hash 断言不受影响
 * - 批量场景每次调用的 prompt 互不相同，素材必然各不相同
 *
 * 注意这里是**执行期**行为，不改 plan：指纹与 RunRecord.inputs 仍按真实输入记录，
 * 序号只是发给渠道的请求修饰（渠道侧会把它当作素材差异化依据）。
 */
function applyCallOrdinal(task: RunTask): RunRequest {
  const seq = task.seq ?? 0
  if (seq <= 0) return task.request
  const mark = task.collectionItemId ? `第 ${seq + 1} 项` : `第 ${seq + 1} 次`
  return { ...task.request, prompt: `${task.request.prompt}（${mark}）` }
}

export async function runEngine<TTask extends RunTask, TCommand>(
  plan: RunPlan<TTask>,
  deps: RunEngineDeps<TTask, TCommand>,
): Promise<RunSummary> {
  const now = deps.now ?? (() => Date.now())
  const wait = deps.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const policy: RunPolicy = { ...DEFAULT_POLICY, ...deps.policy }
  const update = (taskId: string, state: RunTaskState) =>
    deps.onTaskUpdate?.(plan.id, taskId, state)
  const placement = deps.placement

  const startedAt = now()
  const taskResults: RunSummary['taskResults'] = []
  const records: ScopedRunRecord[] = []

  // 整次 plan 的所有写回合进同一个撤销单元：只有第一次 writeBack 带事务边界
  let firstWrite = true
  const write: typeof deps.writeBack = (commands, transaction) => {
    if (firstWrite) {
      firstWrite = false
      deps.writeBack(commands, transaction ?? { mode: 'multi-step', planId: plan.id, label: MODE_LABEL[plan.mode] })
      return
    }
    deps.writeBack(commands)
  }

  /**
   * 按主体累计成功产物（§6.12 批量入口 / §6.8「每次执行各自产生独立结果组」）。
   *
   * 一个主体可能展开成多次调用（批量集合卡），但**一次执行只落一个聚合结果**：
   * 场景 1「批量节点内 2 张图 → 右侧出 2 个结果」是同一个结果组里的 2 个结果节点。
   * 因此这里先攒、plan 跑完再统一交给适配器 finalize，而不是每 task 各落一次。
   *
   * 累加时按「调用序号」去重：同一张素材被放进集合多次时，
   * 集合项 nodeId 相同、素材 hash 也可能相同，只有序号能区分它们是两次独立调用。
   */
  const collected = new Map<
    string,
    {
      nodeId: string
      entries: { item: string | null; seq: number; asset: GeneratedAsset }[]
    }
  >()
  const callCounts = new Map<string, number>()
  for (const t of plan.tasks) callCounts.set(t.nodeId, (callCounts.get(t.nodeId) ?? 0) + 1)

  const collect = (task: RunTask, assets: GeneratedAsset[]): void => {
    const current = collected.get(task.id) ?? {
      nodeId: task.nodeId,
      entries: [],
    }
    const item = task.collectionItemId ?? null
    const seq = task.seq ?? 0
    // 同一 (集合项, 序号) 只保留一次；不同 (集合项) 各自入列，即使素材 hash 相同
    const key = `${item ?? ''}#${seq}`
    if (
      current.entries.some(
        (entry) => `${entry.item ?? ''}#${entry.seq}` === key,
      )
    ) {
      return
    }
    for (const asset of assets) current.entries.push({ item, seq, asset })
    collected.set(task.id, current)
  }

  /**
   * `runPlanWaves` 在这里只负责校验 DAG 并给出稳定的拓扑顺序。
   * 它不再决定运行时分批：某个任务的前置一成功，它就能立刻启动，
   * 不必等待同一拓扑层的无关慢任务。
   */
  const orderedTasks = runPlanWaves(plan.tasks).flat()
  const stateByTaskId = new Map<string, RunTaskState>()
  const recordsByTaskId = new Map<string, ScopedRunRecord>()
  const pendingTaskIds = new Set(orderedTasks.map((task) => task.id))
  const activeSettlements = new Set<Promise<void>>()
  let startedCount = 0

  type StartedTask = {
    task: TTask
    targetId: string
    startedAt: number
    scope: RunRecordScope
  }

  const settleWithoutRun = (task: TTask, state: RunTaskState): void => {
    pendingTaskIds.delete(task.id)
    stateByTaskId.set(task.id, state)
    update(task.id, state)
  }

  const cancelPendingTasks = (): void => {
    for (const task of orderedTasks) {
      if (!pendingTaskIds.has(task.id)) continue
      settleWithoutRun(task, { kind: 'canceled' })
    }
  }

  type PreparedTask = StartedTask & { beganCommands: TCommand[] }

  const executeTask = async ({
    task,
    startedAt,
  }: StartedTask): Promise<{
    state: RunTaskState
    assets: GeneratedAsset[]
  }> => {
    let attempt = 0
    let state: RunTaskState = {
      kind: 'failed',
      error: { kind: 'parse', raw: 'unreachable' },
      attempts: 1,
    }
    let assets: GeneratedAsset[] = []

    for (;;) {
      try {
        const adapter = deps.channelResolver({
          ...task.request,
          routingAttempt: attempt,
        })
        const callRequest = applyCallOrdinal(task)
        assets = await callChannel(adapter, callRequest, deps.signal)
        if (deps.signal.aborted) {
          state = { kind: 'canceled' }
          break
        }
        state = {
          kind: 'succeeded',
          result: assets,
          duration: now() - startedAt,
        }
        break
      } catch (e) {
        const error = normalizeError(e)
        if (deps.signal.aborted) {
          state = { kind: 'canceled' }
          break
        }
        const hasNextCredentialGroup =
          attempt + 1 < (task.request.credentialGroupIds?.length ?? 0)
        const shouldRetry =
          (isRetryable(error, policy) && attempt < policy.maxRetries) ||
          (hasNextCredentialGroup && isGroupSwitchable(error))
        if (shouldRetry) {
          attempt += 1
          await wait(backoffMs(attempt - 1, policy.backoffBase, 0))
          if (deps.signal.aborted) {
            state = { kind: 'canceled' }
            break
          }
          continue
        }
        state = { kind: 'failed', error, attempts: attempt + 1 }
        break
      }
    }

    return { state, assets }
  }

  const finishTask = (
    started: StartedTask,
    state: RunTaskState,
    assets: GeneratedAsset[],
  ): void => {
    const { task, targetId, startedAt, scope } = started
    const status: RunRecord['status'] =
      state.kind === 'succeeded'
        ? 'succeeded'
        : state.kind === 'canceled'
          ? 'canceled'
          : 'failed'
    if (state.kind === 'succeeded') {
      const cmds = placement.commit(task, targetId, assets)
      if (cmds.length > 0) write(cmds)
      if (placement.shouldCollect(task, assets)) {
        collect(task, assets)
      }
    }
    const finishedAt = now()
    const record = makeRecord(
      task,
      targetId,
      scope,
      deps,
      startedAt,
      status,
      state.kind === 'succeeded' ? assets : [],
      finishedAt - startedAt,
      state.kind === 'failed' ? describeError(state.error) : undefined,
    )
    const recordCommand = placement.record(task, targetId, record)
    if (recordCommand !== null) write([recordCommand])

    stateByTaskId.set(task.id, state)
    recordsByTaskId.set(task.id, record)
    update(task.id, state)

    // 前置的成功 / 失败都在这里收口；此刻才允许依赖它的任务启动或阻断。
    dispatchReadyTasks()
  }

  const launchTask = (started: StartedTask): void => {
    const settlement = (async () => {
      const { state, assets } = await executeTask(started)
      finishTask(started, state, assets)
    })().finally(() => {
      activeSettlements.delete(settlement)
    })
    activeSettlements.add(settlement)
  }

  function dispatchReadyTasks(): void {
    if (deps.signal.aborted) {
      cancelPendingTasks()
      return
    }

    const prepared: PreparedTask[] = []
    let changed = true
    while (changed) {
      changed = false
      for (const task of orderedTasks) {
        if (!pendingTaskIds.has(task.id)) continue

        let allSucceeded = true
        let failedDependency: string | undefined
        let canceledDependency: string | undefined
        for (const dependency of task.dependsOn) {
          const state = stateByTaskId.get(dependency)
          if (!state) {
            allSucceeded = false
          } else if (state.kind === 'failed') {
            allSucceeded = false
            failedDependency = dependency
          } else if (state.kind === 'canceled') {
            allSucceeded = false
            if (!failedDependency) canceledDependency = dependency
          } else if (state.kind !== 'succeeded') {
            allSucceeded = false
          }
        }

        if (failedDependency || canceledDependency) {
          const state: RunTaskState = failedDependency
            ? {
                kind: 'failed',
                error: {
                  kind: 'validation',
                  field: 'dependsOn',
                  reason: `依赖任务未成功：${failedDependency}`,
                },
                attempts: 0,
              }
            : { kind: 'canceled' }
          settleWithoutRun(task, state)
          changed = true
          continue
        }
        if (!allSucceeded) continue

        const isRepeat =
          (callCounts.get(task.nodeId) ?? 1) > 1 && (task.seq ?? 0) > 0
        const began = placement.begin(task, {
          isRepeat,
          slotIndex: startedCount + prepared.length,
          slotCount: plan.tasks.length,
        })
        const scope = deps.recordScope(plan, task, began.targetId)
        prepared.push({
          task,
          targetId: began.targetId,
          startedAt: 0,
          scope,
          beganCommands: began.commands,
        })
        pendingTaskIds.delete(task.id)
      }
    }

    for (const started of prepared) {
      const { task, targetId, beganCommands } = started
      if (beganCommands.length > 0) write(beganCommands)
      deps.onTaskTarget?.(plan.id, task.id, targetId)
      update(task.id, { kind: 'queued' })

      const taskStartedAt = now()
      started.startedAt = taskStartedAt
      update(task.id, { kind: 'running', startedAt: taskStartedAt })
      startedCount += 1
    }

    // 落位和状态广播全部就绪后再发请求，整批任务仍同时开工。
    for (const started of prepared) {
      launchTask(started)
    }
  }

  const onAbort = () => cancelPendingTasks()
  deps.signal.addEventListener('abort', onAbort)
  try {
    dispatchReadyTasks()
    while (activeSettlements.size > 0) {
      await Promise.race(activeSettlements)
    }
  } finally {
    deps.signal.removeEventListener('abort', onAbort)
  }

  if (pendingTaskIds.size > 0) {
    throw new Error('RunPlan 调度结束但仍有任务未结算')
  }

  for (const task of orderedTasks) {
    const state = stateByTaskId.get(task.id)
    if (!state) throw new Error(`RunPlan 任务缺少终态：${task.id}`)
    taskResults.push({ taskId: task.id, nodeId: task.nodeId, state })
    const record = recordsByTaskId.get(task.id)
    if (record) records.push(record)
  }

  // 计划收尾：把聚合到的产物落成工作台自己的形态（canvas：结果组 + 逐张子节点 + 素材本体）
  const collectedList: CollectedAsset[] = []
  for (const task of orderedTasks) {
    const current = collected.get(task.id)
    if (!current) continue
    for (const entry of current.entries) {
      collectedList.push({
        sourceId: current.nodeId,
        itemId: entry.item,
        seq: entry.seq,
        asset: entry.asset,
      })
    }
  }
  const finalCommands = placement.finalize(plan, collectedList)
  if (finalCommands.length > 0) write(finalCommands)

  const count = (kind: RunTaskState['kind']) =>
    taskResults.filter((r) => r.state.kind === kind).length

  return {
    runPlanId: plan.id,
    mode: plan.mode,
    taskResults,
    succeeded: count('succeeded'),
    failed: count('failed'),
    canceled: count('canceled'),
    startedAt,
    finishedAt: now(),
    records,
  }
}

function makeRecord(
  task: RunTask,
  targetId: string,
  scope: RunRecordScope,
  deps: { projectId: string; nextVersion?: (nodeId: string) => number },
  startedAt: number,
  status: RunRecord['status'],
  assets: GeneratedAsset[],
  durationMs: number,
  /** 失败时的人话原因（对账 #469：日志里必须能读到"为什么没出图"） */
  errorText?: string,
): ScopedRunRecord {
  return createRunRecord({
    id: createId('rec'),
    nodeId: targetId,
    projectId: deps.projectId,
    version: deps.nextVersion?.(targetId) ?? 1,
    createdAt: startedAt,
    status,
    inputs: task.request.inputs,
    params: task.params,
    /**
     * 实际发出的渠道 / 模型（M7-3）。
     *
     * 取自 `task.request`（选路改写后的那份），不是 `task.params` ——
     * 后者是节点上的意图（逻辑名）。留痕只记意图的话，日志会显示一个
     * 从未被请求过的名字，排查直接跑偏。
     */
    sentChannelId: task.request.channelId,
    sentModel: task.request.model,
    outputHashes: assets.map((a) => a.hash),
    fingerprint: task.fingerprint,
    taskId: task.id,
    durationMs,
    ...(errorText ? { errorText } : {}),
    ...pixelFieldsOf(assets),
    scope,
  })
}

/**
 * 从产物里取「请求像素 / 实际像素」（§6.18 日志面板）。
 *
 * 取**第一张**产物：一次调用的所有产物同批请求、同批返回，尺寸一致；
 * 多张时逐张记没有额外信息，只会让记录变胖。失败 / 取消（无产物）自然一项都没有。
 *
 * 缺哪个就不填哪个 —— 展示侧按「未知即不显示」处理，绝不拿另一侧顶替。
 */
function pixelFieldsOf(assets: readonly GeneratedAsset[]): Pick<
  RunRecord,
  'requestedWidth' | 'requestedHeight' | 'outputWidth' | 'outputHeight'
> {
  const first = assets[0]
  if (!first) return {}
  const fields: Partial<RunRecord> = {}
  if (first.requestedWidth && first.requestedHeight) {
    fields.requestedWidth = first.requestedWidth
    fields.requestedHeight = first.requestedHeight
  }
  if (first.width && first.height) {
    fields.outputWidth = first.width
    fields.outputHeight = first.height
  }
  return fields as Pick<
    RunRecord,
    'requestedWidth' | 'requestedHeight' | 'outputWidth' | 'outputHeight'
  >
}
