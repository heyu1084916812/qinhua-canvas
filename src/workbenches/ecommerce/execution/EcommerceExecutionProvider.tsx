import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { RunRouteCandidate } from '../../../domain/shared/execution/types'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import { createRunRecord } from '../../../domain/shared/execution/runRecord'
import { createChannelRepository } from '../../../state/project/channelRepository'
import {
  createEcommerceCanvasRepository,
  type EcommerceCanvasRepository,
} from '../../../state/project/ecommerceCanvasRepository'
import {
  createEcommerceTaskRepository,
  type EcommerceTaskRepository,
} from '../../../state/project/ecommerceTaskRepository'
import type { EcommerceRunTask } from '../../../features/ecommerce/execution/ecommerceRunPlan'
import {
  createEcommercePlacement,
  type EcommerceExecutionCommand,
} from '../../../features/ecommerce/execution/ecommercePlacement'
import { executeEcommerceCommands } from '../../../features/ecommerce/execution/ecommerceCommandExecutor'
import {
  useExecution,
  type ExecutionHost,
} from '../../../features/shared/execution/useExecution'
import type {
  RunSummary,
  RunTaskState,
} from '../../../features/shared/execution/runEngine'
import type { ChannelAdapter } from '../../../platform/channels/types'
import { createGenerationClient } from '../../../platform/generation'
import { applyRoutePlanToRequest } from '../../../domain/project/generationRouting'
import { createId } from '../../../shared/id'
import { asAppError, describeError, errorTextOf } from '../../../shared/result'
import {
  ecommerceAdapterKey,
  resolveEcommerceAdapter,
} from './ecommerceAdapterRouting'
import { registerEcommerceChannelGuard } from './ecommerceChannelGuard'
import {
  createEcommercePreflightBoundary,
  ECOMMERCE_CHANNEL_REMOVED_MESSAGE,
} from './ecommercePreflightBoundary'

export interface EcommerceRunOutcome {
  summary: RunSummary
  /** 生成成功但结果 / 投影 / 日志补写失败的真实原因。 */
  warnings: string[]
}

export interface EcommerceExecutionApi {
  run(plan: RunPlan<EcommerceRunTask>): Promise<EcommerceRunOutcome>
  cancel(): void
  isRunning: boolean
  resultStateOf(resultId: string): RunTaskState | undefined
}

type EcommerceExecutionHost = ExecutionHost<EcommerceRunTask, EcommerceExecutionCommand>

const EcommerceExecutionContext = createContext<EcommerceExecutionApi | null>(null)

async function markPlanPreflightFailed(args: {
  projectId: string
  plan: RunPlan<EcommerceRunTask>
  error: unknown
  operationId: string
  storage: ReturnType<typeof usePlatform>['storage']
  taskRepo: EcommerceTaskRepository
  canvasRepo: EcommerceCanvasRepository
}): Promise<string[]> {
  const warnings: string[] = []
  const app = asAppError(args.error)
  const text = app ? describeError(app) : errorTextOf(args.error)
  const at = Date.now()
  for (const task of args.plan.tasks) {
    const record: RunRecord = createRunRecord({
      id: createId('rec'),
      nodeId: task.resultId,
      projectId: args.projectId,
      version: 1,
      createdAt: at,
      status: 'failed',
      inputs: [...task.request.inputs],
      params: task.params,
      outputHashes: [],
      fingerprint: task.fingerprint,
      taskId: task.id,
      durationMs: 0,
      sentChannelId: task.request.channelId,
      sentModel: task.request.model,
      errorText: text,
      scope: {
        scopeVersion: 1,
        workbench: 'ecommerce',
        subjectId: task.resultId,
        scopeId: `task:${task.taskId}`,
        operationId: args.operationId,
      },
    })
    try {
      await args.storage.put('runRecords', record as never)
    } catch (error) {
      warnings.push(`RunRecord 写入失败：${errorTextOf(error)}`)
    }
    try {
      const row = await args.taskRepo.result(task.resultId)
      if (row) {
        const { errorText: _oldError, ...rest } = row
        await args.taskRepo.updateResult({
          ...rest,
          status: 'failed',
          errorText: text,
          updatedAt: at,
        })
      }
    } catch (error) {
      warnings.push(`结果状态写入失败：${errorTextOf(error)}`)
    }
  }
  try {
    await args.taskRepo.refreshTaskStatus(args.plan.tasks[0]?.taskId ?? '')
  } catch (error) {
    warnings.push(`任务状态写入失败：${errorTextOf(error)}`)
  }
  try {
    await args.canvasRepo.sync(args.projectId)
  } catch (error) {
    warnings.push(`工作区投影失败：${errorTextOf(error)}`)
  }
  return warnings
}

export function EcommerceExecutionProvider({
  projectId,
  children,
}: {
  projectId: string
  children?: ReactNode
}) {
  const platform = usePlatform()
  const channels = useChannels()
  const repo = useMemo(
    () => createChannelRepository(platform.storage, platform.credentials),
    [platform.storage, platform.credentials],
  )
  const taskRepo = useMemo(
    () => createEcommerceTaskRepository(platform.storage),
    [platform.storage],
  )
  const canvasRepo = useMemo(
    () => createEcommerceCanvasRepository(platform.storage),
    [platform.storage],
  )
  const generation = useMemo(
    () =>
      createGenerationClient({
        platform,
        catalog: () => channels.protocolCatalog(),
        loadToken: (credentialRef) => repo.loadToken(credentialRef),
      }),
    [channels, platform, repo],
  )

  const adaptersRef = useRef(new Map<string, Map<string, ChannelAdapter>>())
  const operationIdsRef = useRef(new Map<string, string>())
  const resultTaskIdsRef = useRef(new Map<string, string>())
  const queuesRef = useRef(new Map<string, Promise<string[]>>())
  const placement = useMemo(() => createEcommercePlacement(projectId), [projectId])

  const writeBack = useCallback(
    (commands: EcommerceExecutionCommand[]) => {
      const planId = commands[0]?.planId
      if (!planId) return
      const previous = queuesRef.current.get(planId) ?? Promise.resolve([])
      const next = previous.then(async (warningsSoFar) => {
        const warnings = await executeEcommerceCommands(commands, {
          storage: platform.storage,
          taskRepo,
          canvasRepo,
        })
        return [...warningsSoFar, ...warnings]
      })
      queuesRef.current.set(planId, next)
    },
    [canvasRepo, platform.storage, taskRepo],
  )

  const host = useMemo<EcommerceExecutionHost>(
    () => ({
      writeBack,
      projectId,
      placement,
      recordScope: (plan, task) => {
        const operationId = operationIdsRef.current.get(plan.id)
        if (!operationId) {
          throw new Error(`[ecommerce] 计划 ${plan.id} 缺少本次操作 id`)
        }
        return {
          scopeVersion: 1,
          workbench: 'ecommerce',
          subjectId: task.resultId,
          scopeId: `task:${task.taskId}`,
          operationId,
        }
      },
      channelResolver: (request, runPlanId) => {
        return resolveEcommerceAdapter(
          adaptersRef.current.get(runPlanId),
          runPlanId,
          request,
        )
      },
      onTaskUpdate: (planId, taskId, state) => {
        if (!state) return
        void planId
        void taskId
      },
    }),
    [placement, projectId, writeBack],
  )

  const execution = useExecution<EcommerceRunTask, EcommerceExecutionCommand>(host)

  const run = useCallback<EcommerceExecutionApi['run']>(
    async (plan) => {
      const first = plan.tasks[0]
      if (!first) {
        throw new Error('电商执行计划为空')
      }
      for (const task of plan.tasks) {
        if (task.request.kind !== 'image' && task.request.kind !== 'video') {
          throw new Error(`电商执行不支持 ${task.request.kind} 请求`)
        }
        const route = await channels.planGenerationRoute({
          category: task.request.kind,
          logicalModel: task.request.logicalModel ?? task.request.model,
          explicitChannelId: task.request.channelId,
        })
        if (!route.ok) {
          throw new Error(
            route.reason === 'policy_excluded'
              ? '电商所选渠道不在当前路由范围内'
              : '电商渠道没有可用于本次生成的模型或 Key',
          )
        }
        task.request = applyRoutePlanToRequest(
          task.request,
          route.plan,
          `${plan.id}:${task.id}:route`,
        )
      }
      const operationId = createId('op')
      operationIdsRef.current.set(plan.id, operationId)
      const preflightBoundary = createEcommercePreflightBoundary()
      const unregisterChannelGuard = registerEcommerceChannelGuard(
        plan,
        execution,
        preflightBoundary.interrupt,
      )

      const candidates: RunRouteCandidate[] =
        first.request.routeCandidates?.length
          ? first.request.routeCandidates.map((candidate) => ({ ...candidate }))
          : [{
              channelId: first.request.channelId,
              ...(first.request.credentialGroupId
                ? { credentialGroupId: first.request.credentialGroupId }
                : {}),
              model: first.request.model,
            }]
      const adapters = new Map<string, ChannelAdapter>()
      const usableCandidates: RunRouteCandidate[] = []
      let firstPreflightError: unknown
      try {
        try {
          for (const candidate of candidates) {
            const channel = channels
              .getState()
              .channels.find((item) => item.id === candidate.channelId)
            if (!channel || !channel.enabled) {
              firstPreflightError ??= new Error(
                `电商渠道不可用：${candidate.channelId}`,
              )
              continue
            }
            try {
              const target = await preflightBoundary.run(() =>
                generation.resolve({
                  channel,
                  request: { model: candidate.model },
                  kind: first.request.kind,
                  hints: {
                    modelIsUpstream: true,
                    ...(candidate.credentialGroupId
                      ? { credentialGroupId: candidate.credentialGroupId }
                      : {}),
                  },
                }),
              )
              adapters.set(
                ecommerceAdapterKey(
                  candidate.channelId,
                  candidate.credentialGroupId,
                  first.request.kind,
                ),
                target.adapter,
              )
              usableCandidates.push(candidate)
            } catch (error) {
              if (preflightBoundary.isInterrupted()) throw error
              firstPreflightError ??= error
            }
          }
          preflightBoundary.assertActive()
          if (adapters.size === 0) {
            throw firstPreflightError ?? new Error('电商渠道没有可用的 Key 分组')
          }
        } catch (error) {
          await markPlanPreflightFailed({
            projectId,
            plan,
            error,
            operationId,
            storage: platform.storage,
            taskRepo,
            canvasRepo,
          })
          throw error
        }

        adaptersRef.current.set(plan.id, adapters)
        for (const task of plan.tasks) {
          if (usableCandidates.length > 0) {
            task.request.routeCandidates = usableCandidates.map((candidate) => ({
              ...candidate,
            }))
            const firstUsable = usableCandidates[0]!
            task.request.channelId = firstUsable.channelId
            task.request.model = firstUsable.model
            if (firstUsable.credentialGroupId) {
              task.request.credentialGroupId = firstUsable.credentialGroupId
            } else {
              delete task.request.credentialGroupId
            }
          }
          resultTaskIdsRef.current.set(task.resultId, task.id)
        }
        queuesRef.current.set(plan.id, Promise.resolve([]))

        if (
          !channels
            .getState()
            .channels.some((item) => item.id === first.request.channelId)
        ) {
          preflightBoundary.interrupt()
        }
        preflightBoundary.assertActive()

        let summary: RunSummary
        try {
          summary = await execution.startRun(plan)
        } finally {
          unregisterChannelGuard()
        }
        const warnings = await (queuesRef.current.get(plan.id) ?? Promise.resolve([]))
        if (preflightBoundary.isInterrupted()) {
          warnings.push(ECOMMERCE_CHANNEL_REMOVED_MESSAGE)
        }
        for (const task of plan.tasks) resultTaskIdsRef.current.delete(task.resultId)
        return { summary, warnings }
      } finally {
        unregisterChannelGuard()
        operationIdsRef.current.delete(plan.id)
        adaptersRef.current.delete(plan.id)
        queuesRef.current.delete(plan.id)
      }
    },
    [canvasRepo, channels, execution, generation, platform.storage, projectId, taskRepo],
  )

  const api = useMemo<EcommerceExecutionApi>(
    () => ({
      run,
      cancel: () => {
        if (execution.runningPlanId) execution.cancelRun(execution.runningPlanId)
      },
      isRunning: execution.isRunning,
      resultStateOf: (resultId) => {
        const taskId = resultTaskIdsRef.current.get(resultId)
        return taskId ? execution.taskStates.get(taskId) : undefined
      },
    }),
    [execution, run],
  )

  return (
    <EcommerceExecutionContext.Provider value={api}>
      {children}
    </EcommerceExecutionContext.Provider>
  )
}

export function useEcommerceExecution(): EcommerceExecutionApi {
  const api = useContext(EcommerceExecutionContext)
  if (!api) throw new Error('EcommerceExecutionProvider 未挂载')
  return api
}
