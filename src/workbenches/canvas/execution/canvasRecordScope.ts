import type { RunRecordScope } from '../../../domain/shared/execution/runRecord'
import type { WorkbenchId } from '../../../domain/shared/workbench'

export interface CanvasRecordScopeOverrideArgs {
  nodeId: string
  nodeData: Readonly<Record<string, unknown>> | undefined
  planId: string
  fallback: RunRecordScope
}

export function resolveCanvasRecordScope(args: {
  workbench: WorkbenchId
  targetId: string
  planId: string
  nodeData: Readonly<Record<string, unknown>> | undefined
  override?: (args: CanvasRecordScopeOverrideArgs) => RunRecordScope | null
}): RunRecordScope {
  const fallback: RunRecordScope = {
    scopeVersion: 1,
    workbench: args.workbench,
    subjectId: args.targetId,
    scopeId: `plan:${args.planId}`,
    operationId: args.planId,
  }
  return (
    args.override?.({
      nodeId: args.targetId,
      nodeData: args.nodeData,
      planId: args.planId,
      fallback,
    }) ?? fallback
  )
}
