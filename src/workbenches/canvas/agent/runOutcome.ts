import type { RunRecord } from '../../../domain/canvas/model/runRecord'

/**
 * Agent 的 runNode 结果。
 *
 * 必须从**运行记录**对账，不能从 execution.nodeStates 猜：runEngine 跑完会清理节点状态，
 * 失败态在 `await runNode()` 返回后可能已经消失；之前正是因此把失败回报成了 ok:true。
 */
export interface AgentRunOutcome {
  nodeId: string
  /**
   * 节点名（`data.title`）。
   *
   * 用户 2026-10-14：「图六当中每个图片的名字都是有的，右边 agent 完成的时候
   * 是不是可以不用写节点 id？是替换还是保留？」—— 面板和模型都该看到
   * 「作品集总封面」，而不是 `node_0544f492-6542-41a1-…`。查不到就缺省，
   * 由展示侧退回 `nodeId`，不编造名字。
   */
  title?: string
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

/**
 * 一小批里只要有一个失败，就把这批 Agent 运行降为串行。
 *
 * 这是对“同一渠道一次打七个、只成功一个”的确定性降载：
 * 已经发出去的那一批无法撤回，但后续节点不应继续按高并发打满。
 */
export function nextRunConcurrency(
  current: number,
  outcomes: readonly Pick<AgentRunOutcome, 'ok'>[],
): number {
  return current > 1 && outcomes.some((outcome) => !outcome.ok) ? 1 : current
}
