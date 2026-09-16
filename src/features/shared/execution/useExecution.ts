import { useCallback, useRef, useState } from 'react'
import type { RunPlan, RunTask } from '../../../domain/shared/execution/plan'
import type { RunRequest } from '../../../domain/shared/execution/types'
import type { ChannelAdapter } from '../../../platform/channels/types'
import type { TransactionBoundary } from '../../../state/shared/types'
import type { ExecutionPlacement } from './placement'
import { runEngine, type RunPolicy, type RunSummary, type RunTaskState } from './runEngine'
import { createRunRegistry } from './runRegistry'

/**
 * 执行宿主（架构 §5.5）。**跨工作台共享**（本文件位于 features/shared/execution）。
 *
 * 分工：
 * - useExecution 持有全部可变状态与生命周期：AbortController、writeBack 闭包、taskStates
 * - runEngine 是纯执行器：不认识 React、不知道 dispatch
 *
 * 因此 runEngine 可以被直接单测（喂 mock writeBack + mock 适配器），而本 hook 只把它们接起来。
 * 命令的**具体形状**（TCommand）与**落位方式**（placement）由各工作台注入，本 hook 不解读。
 */
export interface ExecutionHost<TTask extends RunTask, TCommand> {
  /** 把 runEngine 的命令落回 store；store 侧需支持事务边界覆盖（见 CanvasStore.dispatch(cmd, tx)） */
  writeBack: (commands: TCommand[], transaction?: TransactionBoundary) => void
  /**
   * 解析渠道适配器。`runPlanId` 告诉宿主「这是哪条并发链路在要适配器」——
   * 宿主按 planId 分开存放预解析结果，才不会让后发计划覆盖先发计划。
   */
  channelResolver: (request: RunRequest, runPlanId: string) => ChannelAdapter
  projectId: string
  /** 落位 / 写回适配器（canvas：CanvasPlacement、comic：ComicPlacement） */
  placement: ExecutionPlacement<TTask, TCommand>
  /** 计划结束：落 RunRecord、补发 stale.clear 都在这里做 */
  onFinish?: (summary: RunSummary) => void
  policy?: Partial<RunPolicy>
  nextVersion?: (nodeId: string) => number
}

export interface UseExecution<TTask extends RunTask = RunTask> {
  startRun(plan: RunPlan<TTask>): Promise<RunSummary>
  cancelRun(runPlanId: string): void
  runningPlanId: string | null
  runningPlanIds: string[]
  taskStates: Map<string, RunTaskState>
  isRunning: boolean
}

export function useExecution<TTask extends RunTask, TCommand>(
  host: ExecutionHost<TTask, TCommand>,
): UseExecution<TTask> {
  /**
   * 并发运行表：planId → AbortController。
   *
   * 早先这里只有**一个** `runningPlanId` + 一个 controllerRef —— 第二个 `startRun`
   * 会把第一个覆盖掉：界面上仍在跑的那条链路失去取消能力，且 `isRunning` 的
   * 归零时机被后发计划改写。画布上「一个节点在生成时另一个节点生成不了」正是
   * 这条单槽位留下的症状。改为按 planId 建表后，多条链路各自独立可取消、互不覆盖。
   */
  const controllersRef = useRef(createRunRegistry<AbortController>())
  const [runningPlanIds, setRunningPlanIds] = useState<string[]>([])
  const [taskStates, setTaskStates] = useState<Map<string, RunTaskState>>(() => new Map())
  const hostRef = useRef(host)
  hostRef.current = host

  const startRun = useCallback(async (plan: RunPlan<TTask>): Promise<RunSummary> => {
    const controller = new AbortController()
    controllersRef.current.add(plan.id, controller)
    setRunningPlanIds((prev) => (prev.includes(plan.id) ? prev : [...prev, plan.id]))

    try {
      const summary = await runEngine<TTask, TCommand>(plan, {
        signal: controller.signal,
        projectId: hostRef.current.projectId,
        channelResolver: (request) => hostRef.current.channelResolver(request, plan.id),
        writeBack: hostRef.current.writeBack,
        placement: hostRef.current.placement,
        policy: hostRef.current.policy,
        nextVersion: hostRef.current.nextVersion,
        onTaskUpdate: (taskId, state) => {
          setTaskStates((prev) => new Map(prev).set(taskId, state))
        },
      })
        hostRef.current.onFinish?.(summary)
      return summary
    } finally {
      controllersRef.current.remove(plan.id)
      setRunningPlanIds((prev) => prev.filter((id) => id !== plan.id))
    }
  }, [])

  const cancelRun = useCallback((runPlanId: string) => {
    controllersRef.current.get(runPlanId)?.abort()
  }, [])

  return {
    startRun,
    cancelRun,
    runningPlanId: runningPlanIds[runningPlanIds.length - 1] ?? null,
    runningPlanIds,
    taskStates,
    isRunning: runningPlanIds.length > 0,
  }
}
