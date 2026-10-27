import type { EcommerceResultMetadata } from '../../../domain/ecommerce/tasks'
import type { RunPlan, RunTask } from '../../../domain/shared/execution/plan'
import type { NodeInput, RunRequest } from '../../../domain/shared/execution/types'
import { fingerprintHex } from '../../../domain/shared/hash'

export interface EcommerceRunShot {
  /** 对应 `ecommerceResults.id`；执行计划不依赖画布节点 id。 */
  resultId: string
  /** RunRecord 的中性执行主体；缺省与 resultId 相同。 */
  subjectId?: string
  prompt: string
  params: Record<string, unknown>
  metadata?: EcommerceResultMetadata
}

export interface EcommerceRunPlanInput {
  taskId: string
  mediaKind: 'image' | 'video'
  channelId: string
  model: string
  /** 用户选择的前端逻辑模型；`model` 可以是已映射的上游 ID。 */
  logicalModel?: string
  /** 已完成渠道内分组选路时传入；网关只做单次执行，不再自行换组。 */
  credentialGroupId?: string
  credentialGroupIds?: string[]
  inputs: readonly NodeInput[]
  shots: readonly EcommerceRunShot[]
}

export interface EcommerceRunTask extends RunTask {
  planId: string
  taskId: string
  /** 执行落点就是结果行本身，不再借画布承载节点。 */
  resultId: string
  metadata?: EcommerceResultMetadata
}

function requestOf(
  input: EcommerceRunPlanInput,
  shot: EcommerceRunShot,
): RunRequest {
  const request = {
    kind: input.mediaKind,
    channelId: input.channelId,
    model: input.model,
    ...(input.logicalModel?.trim()
      ? { logicalModel: input.logicalModel.trim() }
      : {}),
    prompt: shot.prompt,
    inputs: [...input.inputs],
    params: { ...shot.params },
  } as RunRequest
  return {
    ...request,
    ...(input.credentialGroupId
      ? { credentialGroupId: input.credentialGroupId }
      : {}),
    ...(input.credentialGroupIds?.length
      ? { credentialGroupIds: [...input.credentialGroupIds] }
      : {}),
  }
}

/**
 * 电商任务 -> 通用 RunPlan。
 *
 * 每个结果行对应一个 task；不创建画布节点，也不从节点反推结果。
 * `runEngine` 只看到通用请求，真正写结果表与工作区投影由 EcommercePlacement 负责。
 */
export function buildEcommerceRunPlan(
  input: EcommerceRunPlanInput,
): RunPlan<EcommerceRunTask> {
  if (!input.taskId.trim()) throw new Error('电商任务 id 不能为空')
  if (!input.channelId.trim()) throw new Error('电商执行计划缺少渠道')
  if (!input.model.trim()) throw new Error('电商执行计划缺少模型')
  if (input.shots.length === 0) throw new Error('电商执行计划没有结果行')

  const planId = `ecommerce:${input.taskId}:run`
  const tasks = input.shots.map((shot, seq): EcommerceRunTask => {
    const request = requestOf(input, shot)
    const fingerprint = fingerprintHex(
      JSON.stringify({
        taskId: input.taskId,
        resultId: shot.resultId,
        kind: input.mediaKind,
        channelId: input.channelId,
        model: input.model,
        prompt: shot.prompt,
        params: shot.params,
        inputs: input.inputs,
      }),
    )
    return {
      id: `${input.taskId}:task:${seq + 1}`,
      nodeId: shot.subjectId ?? shot.resultId,
      planId,
      taskId: input.taskId,
      resultId: shot.resultId,
      request,
      dependsOn: [],
      fingerprint,
      params: {
        taskId: input.taskId,
        resultId: shot.resultId,
        ...shot.params,
      },
      ...(shot.metadata ? { metadata: shot.metadata } : {}),
      seq,
    }
  })

  return {
    id: planId,
    tasks,
    scope: 'global',
    mode: 'single',
  }
}
