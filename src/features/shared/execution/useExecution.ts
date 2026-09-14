import { useCallback, useRef, useState } from 'react'
import type { RunPlan, RunTask } from '../../../domain/shared/execution/plan'
import type { RunRequest } from '../../../domain/shared/execution/types'
import type { ChannelAdapter } from '../../../platform/channels/types'
import type { TransactionBoundary } from '../../../state/shared/types'
import type { ExecutionPlacement } from './placement'
import { runEngine, type RunPolicy, type RunSummary, type RunTaskState } from './runEngine'

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
  channelResolver: (request: RunRequest) => ChannelAdapter
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
  taskStates: Map<string, RunTaskState>
  isRunning: boolean
}

export function useExecution<TTask extends RunTask, TCommand>(
  host: ExecutionHost<TTask, TCommand>,
): UseExecution<TTask> {
  const [runningPlanId, setRunningPlanId] = useState<string | null>(null)
  const [taskStates, setTaskStates] = useState<Map<string, RunTaskState>>(() => new Map())
  const controllerRef = useRef<AbortController | null>(null)
  const hostRef = useRef(host)
  hostRef.current = host

  const startRun = useCallback(async (plan: RunPlan<TTask>): Promise<RunSummary> => {
    const controller = new AbortController()
    controllerRef.current = controller
    setRunningPlanId(plan.id)
    setTaskStates(new Map())

    try {
      const summary = await runEngine<TTask, TCommand>(plan, {
        signal: controller.signal,
        projectId: hostRef.current.projectId,
        channelResolver: hostRef.current.channelResolver,
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
      controllerRef.current = null
      setRunningPlanId(null)
      setTaskStates(new Map())
    }
  }, [])

  const cancelRun = useCallback((runPlanId: string) => {
    setRunningPlanId((current) => {
      if (current === runPlanId) controllerRef.current?.abort()
      return current
    })
  }, [])

  return {
    startRun,
    cancelRun,
    runningPlanId,
    taskStates,
    isRunning: runningPlanId !== null,
  }
}
