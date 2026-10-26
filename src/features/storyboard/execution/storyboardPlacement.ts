import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { StoryboardRunTask } from '../../../domain/storyboard/runTypes'
import type { ExecutionPlacement } from '../../shared/execution/placement'
import type { StoryboardExecutionCommand } from './storyboardCommands'

export function createStoryboardPlacement(
  projectId: string,
): ExecutionPlacement<StoryboardRunTask, StoryboardExecutionCommand> {
  return {
    begin(task) {
      return {
        targetId: task.subject.id,
        commands: [],
      }
    },

    commit(task, _targetId, assets) {
      return [
        {
          kind: 'storyboard.commit',
          planId: task.planId,
          taskId: task.id,
          projectId,
          action: task.action,
          subject: task.subject,
          assets: [...assets],
          metadata: {
            prompt: task.request.prompt,
            model: task.request.model,
            params: task.params,
          },
        },
      ]
    },

    shouldCollect() {
      return false
    },

    record(task, _targetId, record: RunRecord) {
      return {
        kind: 'runRecord.finalize',
        planId: task.planId,
        taskId: task.id,
        record,
      }
    },

    finalize(plan: RunPlan<StoryboardRunTask>) {
      const first = plan.tasks[0]
      return first
        ? [
            {
              kind: 'storyboard.projection.sync',
              planId: plan.id,
              taskId: first.id,
              projectId,
            },
          ]
        : []
    },
  }
}
