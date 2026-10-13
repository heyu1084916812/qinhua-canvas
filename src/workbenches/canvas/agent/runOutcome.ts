import type { RunRecord } from '../../../domain/canvas/model/runRecord'

/**
 * Agent 的 runNode 结果。
 *
 * 必须从**运行记录**对账，不能从 execution.nodeStates 猜：runEngine 跑完会清理节点状态，
 * 失败态在 `await runNode()` 返回后可能已经消失；之前正是因此把失败回报成了 ok:true。
 */
export interface AgentRunOutcome {
  nodeId: string
  ok: boolean
  error?: string
  status?: RunRecord['status']
  channelId?: string
  model?: string
}

export function agentRunOutcomeOf(
  records: readonly RunRecord[],
  nodeId: string,
  beforeIds: ReadonlySet<string>,
): AgentRunOutcome {
  const fresh = records
    .filter((record) => record.nodeId === nodeId && !beforeIds.has(record.id))
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  if (!fresh) {
    return { nodeId, ok: false, error: '这次运行没有留下记录，无法确认是否出图' }
  }

  const outcome: AgentRunOutcome = {
    nodeId,
    ok: fresh.status === 'succeeded',
    status: fresh.status,
  }
  if (fresh.errorText) outcome.error = fresh.errorText
  if (fresh.sentChannelId) outcome.channelId = fresh.sentChannelId
  if (fresh.sentModel) outcome.model = fresh.sentModel
  return outcome
}
