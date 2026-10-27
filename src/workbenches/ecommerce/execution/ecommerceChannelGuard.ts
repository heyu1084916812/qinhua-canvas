import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { EcommerceRunTask } from '../../../features/ecommerce/execution/ecommerceRunPlan'
import {
  registerGuardedChannelRun,
  unregisterGuardedChannelRun,
} from '../../../state/shared/runChannelGuard'

export interface EcommerceGuardedExecution {
  cancelRun(planId: string): void
}

export function registerEcommerceChannelGuard(
  plan: RunPlan<EcommerceRunTask>,
  execution: EcommerceGuardedExecution,
  onInterrupted: () => void,
): () => void {
  const taskChannels = new Map(
    plan.tasks.map((task) => [
      task.id,
      task.request.routeCandidates?.length
        ? [...new Set(task.request.routeCandidates.map((candidate) => candidate.channelId))]
        : task.request.channelId,
    ]),
  )
  registerGuardedChannelRun(plan.id, {
    taskChannels,
    cancel: () => execution.cancelRun(plan.id),
    onInterrupted,
  })

  return () => unregisterGuardedChannelRun(plan.id)
}
