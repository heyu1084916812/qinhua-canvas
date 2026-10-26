import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Channel } from '../../../domain/project/channel'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import { createRunRecord } from '../../../domain/shared/execution/runRecord'
import type { StoryboardRunPlan, StoryboardRunTask } from '../../../domain/storyboard/runTypes'
import { assertStoryboardRunTask, storyboardRunRecordScopeOfTask } from '../../../domain/storyboard/runTypes'
import type { AssetPort, StoragePort } from '../../../platform/ports'
import type { GenerationClient } from '../../../platform/generation'
import type { ChannelAdapter } from '../../../platform/channels/types'
import {
  registerGuardedChannelRun,
  unregisterGuardedChannelRun,
} from '../../../state/shared/runChannelGuard'
import { createId } from '../../../shared/id'
import { asAppError, describeError, errorTextOf } from '../../../shared/result'
import { useExecution, type UseExecution } from '../../shared/execution/useExecution'
import type { RunSummary, RunTaskState } from '../../shared/execution/runEngine'
import {
  createStoryboardCommandExecutor,
  type StoryboardCommandExecutionResult,
  type StoryboardDocumentPort,
} from './storyboardCommandExecutor'
import type { StoryboardExecutionCommand } from './storyboardCommands'
import { createStoryboardPlacement } from './storyboardPlacement'
import {
  prepareStoryboardAdapters,
  storyboardAdapterKey,
} from './storyboardAdapterRouting'
import {
  beginStoryboardExecutionPlan,
  failStoryboardExecutionPlan,
  finishStoryboardExecutionPlan,
  runningStoryboardPlanIds,
  storyboardExecutionVersion,
  subjectStateOf,
  subscribeStoryboardExecutionStatus,
  updateStoryboardExecutionTask,
} from './storyboardExecutionStatus'

export interface StoryboardRunOutcome {
  summary: RunSummary
  warnings: string[]
  failures: StoryboardCommandExecutionResult['failures']
}

export interface StoryboardExecutionApi {
  run(plan: StoryboardRunPlan): Promise<StoryboardRunOutcome>
  cancel(planId?: string): void
  isRunning: boolean
  runningPlanIds: string[]
  taskStateOf(taskId: string): RunTaskState | undefined
  subjectStateOf(
    subjectId: string,
    action: StoryboardRunTask['action'],
  ): RunTaskState | undefined
}

export interface StoryboardExecutionProviderProps {
  projectId: string
  storage: StoragePort
  assets: AssetPort
  documents: StoryboardDocumentPort
  generation: GenerationClient
  channels: () => readonly Channel[]
  children?: ReactNode
}

const StoryboardExecutionContext = createContext<StoryboardExecutionApi | null>(null)

function emptyCommandResult(): StoryboardCommandExecutionResult {
  return { warnings: [], failures: [] }
}

function mergeCommandResult(
  into: StoryboardCommandExecutionResult,
  next: StoryboardCommandExecutionResult,
): StoryboardCommandExecutionResult {
  return {
    warnings: [...into.warnings, ...next.warnings],
    failures: [...into.failures, ...next.failures],
  }
}

export function StoryboardExecutionProvider({
  projectId,
  storage,
  assets,
  documents,
  generation,
  channels,
  children,
}: StoryboardExecutionProviderProps) {
  const placement = useMemo(() => createStoryboardPlacement(projectId), [projectId])
  const commandExecutor = useMemo(
    () => createStoryboardCommandExecutor({ storage, assets, documents }),
    [assets, documents, storage],
  )
  const adaptersRef = useRef(new Map<string, Map<string, ChannelAdapter>>())
  const queuesRef = useRef(
    new Map<string, Promise<StoryboardCommandExecutionResult>>(),
  )

  const writeBack = useCallback(
    (commands: StoryboardExecutionCommand[]) => {
      const planId = commands[0]?.planId
      if (!planId) return
      const previous = queuesRef.current.get(planId) ?? Promise.resolve(emptyCommandResult())
      const next = previous.then(async (result) =>
        mergeCommandResult(result, await commandExecutor.execute(commands)),
      )
      queuesRef.current.set(planId, next)
    },
    [commandExecutor],
  )
  const subscribeStatus = useCallback(
    (listener: () => void) => subscribeStoryboardExecutionStatus(listener),
    [],
  )
  const statusVersion = useSyncExternalStore(
    subscribeStatus,
    () => storyboardExecutionVersion(projectId),
    () => 0,
  )

  const execution: UseExecution<StoryboardRunTask> = useExecution<
    StoryboardRunTask,
    StoryboardExecutionCommand
  >({
    writeBack,
    projectId,
    placement,
    recordScope: (_plan, task) => storyboardRunRecordScopeOfTask(task),
    channelResolver: (request, planId) => {
      const attempt = request.routingAttempt ?? 0
      const groupId =
        request.credentialGroupIds?.[attempt] ??
        request.credentialGroupId
      const adapter = adaptersRef.current.get(planId)?.get(
        storyboardAdapterKey({
          channelId: request.channelId,
          credentialGroupId: groupId,
          kind: request.kind,
        }),
      )
      if (!adapter) throw new Error(`漫剧渠道适配器未就绪：${request.channelId}`)
      return adapter
    },
    onTaskUpdate: (planId, taskId, state) => {
      updateStoryboardExecutionTask(projectId, planId, taskId, state)
    },
  })

  const markPreflightFailed = useCallback(
    async (plan: StoryboardRunPlan, error: unknown, operationId: string) => {
      const app = asAppError(error)
      const text = app ? describeError(app) : errorTextOf(error)
      for (const task of plan.tasks) {
        const record: RunRecord = createRunRecord({
          id: createId('rec'),
          nodeId: task.subject.id,
          projectId,
          version: 1,
          createdAt: Date.now(),
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
            ...storyboardRunRecordScopeOfTask(task),
            operationId,
          },
        })
        await storage.put('runRecords', record as never)
      }
    },
    [projectId, storage],
  )

  const run = useCallback<StoryboardExecutionApi['run']>(
    async (plan) => {
      if (plan.tasks.length === 0) throw new Error('漫剧执行计划为空')
      plan.tasks.forEach(assertStoryboardRunTask)
      const operationIds = new Set(plan.tasks.map((task) => task.operationId))
      if (operationIds.size !== 1) {
        throw new Error('同一漫剧执行计划必须只属于一次用户操作')
      }
      const operationId = plan.tasks[0]!.operationId
      queuesRef.current.set(plan.id, Promise.resolve(emptyCommandResult()))
      beginStoryboardExecutionPlan(projectId, plan)

      try {
        let prepared: Awaited<ReturnType<typeof prepareStoryboardAdapters>>
        try {
          prepared = await prepareStoryboardAdapters({
            plan,
            channels: channels(),
            resolve: async ({ taskId, channel, credentialGroupId }) => {
              const task = plan.tasks.find((item) => item.id === taskId)!
              const taskParams =
                task.params && typeof task.params === 'object'
                  ? (task.params as Record<string, unknown>)
                  : {}
              const target = await generation.resolve({
                channel,
                request: task.request,
                kind: task.request.kind,
                hints: {
                  modelIsUpstream: taskParams.modelIsUpstream === true,
                  ...(credentialGroupId ? { credentialGroupId } : {}),
                },
              })
              return target.adapter
            },
          })
        } catch (error) {
          await markPreflightFailed(plan, error, operationId)
          failStoryboardExecutionPlan(
            projectId,
            plan.id,
            asAppError(error) ?? {
              kind: 'validation',
              field: 'storyboard execution',
              reason: errorTextOf(error),
            },
          )
          throw error
        }

        const liveChannels = new Map(channels().map((item) => [item.id, item]))
        const unavailable = plan.tasks.find((task) => {
          const current = liveChannels.get(task.request.channelId)
          return !current || !current.enabled
        })
        if (unavailable) {
          const error = new Error(
            `漫剧执行渠道在预检期间被删除或停用：${unavailable.request.channelId}`,
          )
          await markPreflightFailed(plan, error, operationId)
          failStoryboardExecutionPlan(
            projectId,
            plan.id,
            asAppError(error) ?? {
              kind: 'validation',
              field: 'storyboard execution',
              reason: errorTextOf(error),
            },
          )
          throw error
        }

        adaptersRef.current.set(plan.id, prepared.adapters)
        registerGuardedChannelRun(plan.id, {
          taskChannels: new Map(
            plan.tasks.map((task) => [task.id, task.request.channelId]),
          ),
          cancel: () => execution.cancelRun(plan.id),
          onInterrupted: () => {},
        })

        try {
          const summary = await execution.startRun(plan)
          const commandResult = await (
            queuesRef.current.get(plan.id) ?? Promise.resolve(emptyCommandResult())
          )
          return {
            summary,
            warnings: commandResult.warnings,
            failures: commandResult.failures,
          }
        } finally {
          unregisterGuardedChannelRun(plan.id)
        }
      } finally {
        adaptersRef.current.delete(plan.id)
        queuesRef.current.delete(plan.id)
        finishStoryboardExecutionPlan(projectId, plan.id)
      }
    },
    [channels, execution, generation, markPreflightFailed, projectId],
  )

  const api = useMemo<StoryboardExecutionApi>(
    () => {
      const runningPlanIds = runningStoryboardPlanIds(projectId)
      return {
        run,
        cancel: (planId) => {
          if (planId) execution.cancelRun(planId)
          else for (const id of execution.runningPlanIds) execution.cancelRun(id)
        },
        isRunning: runningPlanIds.length > 0,
        runningPlanIds,
        taskStateOf: (taskId) => execution.taskStates.get(taskId),
        subjectStateOf: (subjectId, action) =>
          subjectStateOf(projectId, subjectId, action),
      }
    },
    [execution, projectId, run, statusVersion],
  )

  return (
    <StoryboardExecutionContext.Provider value={api}>
      {children}
    </StoryboardExecutionContext.Provider>
  )
}

export function useStoryboardExecution(): StoryboardExecutionApi {
  const api = useContext(StoryboardExecutionContext)
  if (!api) throw new Error('StoryboardExecutionProvider 未挂载')
  return api
}
