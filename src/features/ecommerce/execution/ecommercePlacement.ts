import type { EcommerceResultStatus } from '../../../domain/ecommerce/tasks'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import type { GeneratedAsset } from '../../../platform/channels/types'
import type { ExecutionPlacement } from '../../shared/execution/placement'
import type { EcommerceRunTask } from './ecommerceRunPlan'

export type EcommerceExecutionCommand =
  | {
      kind: 'result.status'
      planId: string
      resultId: string
      status: Extract<EcommerceResultStatus, 'running' | 'failed' | 'canceled'>
      errorText?: string
    }
  | {
      kind: 'result.commit'
      planId: string
      resultId: string
      assets: readonly GeneratedAsset[]
    }
  | {
      kind: 'runRecord.finalize'
      planId: string
      record: RunRecord
      resultId: string
      status?: Extract<EcommerceResultStatus, 'failed' | 'canceled'>
      errorText?: string
    }
  | {
      kind: 'projection.sync'
      planId: string
      projectId: string
      taskId: string
    }

/**
 * 电商落位：结果行就是执行落点，不再创建画布承载节点。
 *
 * Placement 只生成“要做什么”的命令；真正写素材、结果表、RunRecord 和投影由
 * EcommerceExecutionProvider 按命令顺序落库，便于测试与幂等重试。
 */
export function createEcommercePlacement(
  projectId: string,
): ExecutionPlacement<EcommerceRunTask, EcommerceExecutionCommand> {
  return {
    begin(task) {
      return {
        targetId: task.resultId,
        commands: [
          {
            kind: 'result.status',
            planId: task.planId,
            resultId: task.resultId,
            status: 'running',
          },
        ],
      }
    },

    commit(task, targetId, assets) {
      return [
        {
          kind: 'result.commit',
          planId: task.planId,
          resultId: targetId,
          assets: [...assets],
        },
      ]
    },

    shouldCollect() {
      return false
    },

    record(_task, targetId, record) {
      return {
        kind: 'runRecord.finalize',
        planId: _task.planId,
        record,
        resultId: targetId,
        ...(record.status === 'failed'
          ? {
              status: 'failed' as const,
              ...(record.errorText ? { errorText: record.errorText } : {}),
            }
          : record.status === 'canceled'
            ? { status: 'canceled' as const }
            : {}),
      }
    },

    finalize(plan) {
      const taskId = plan.tasks[0]?.taskId
      return taskId
        ? [{ kind: 'projection.sync', planId: plan.id, projectId, taskId }]
        : []
    },
  }
}
