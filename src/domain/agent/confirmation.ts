import type { ChatMessage } from '../shared/execution/types'
import type {
  AgentEventType,
  AgentJobPatch,
  AgentJobStatus,
} from './job'

export interface ConfirmationRequestRef {
  callId: string
  name: string
}

export interface ConfirmationJobStep {
  to: AgentJobStatus
  eventType: AgentEventType
  patch: AgentJobPatch
}

const PLANNING_ONLY_CONFIRMATIONS = new Set([
  'rememberMemory',
  'proposeTaskPlan',
  'requestTaskConfirmation',
])

/** 这些确认只推进工作流本身，不进入“等待生成”状态。 */
export function confirmationRunsGeneration(name: string): boolean {
  return !PLANNING_ONLY_CONFIRMATIONS.has(name)
}

/**
 * 自动生成模式下仍必须由用户亲自点的确认。
 *
 * 计划永远人工确认；真正缺信息的 clarification 也不能替用户猜答案。
 * 生成结果 review 属于自动执行链路，允许自动通过。
 */
export function confirmationRequiresExplicitApproval(
  name: string,
  args?: unknown,
): boolean {
  if (name === 'proposeTaskPlan') return true
  if (name !== 'requestTaskConfirmation') return false
  const purpose =
    args && typeof args === 'object'
      ? (args as { purpose?: unknown }).purpose
      : undefined
  return purpose !== 'review'
}

/**
 * 用户批准确认卡之后的合法状态链。
 *
 * `waiting_confirmation` 不能直接跳进 `waiting_generation`：前者只允许先回到
 * `planning`。写画布 / 花钱的工具再从 `planning` 进入 `waiting_generation`。
 */
export function confirmationApprovalSteps(
  request: ConfirmationRequestRef,
): readonly ConfirmationJobStep[] {
  const resolved: ConfirmationJobStep = {
    to: 'planning',
    eventType: 'confirmation_resolved',
    patch: { pendingCallId: undefined },
  }
  if (!confirmationRunsGeneration(request.name)) return [resolved]
  return [
    resolved,
    {
      to: 'waiting_generation',
      eventType: 'generation_started',
      patch: { pendingCallId: request.callId },
    },
  ]
}

/**
 * 取消 / 停止确认卡时补一条工具结果，但不继续调用模型。
 *
 * 历史里已经有一条 assistant(tool_calls) 消息。只清确认卡而不回填结果，
 * 下一轮会留下悬空调用；继续调用模型又会让“取消”变成“换个方案继续建节点”。
 * 因此这里只补齐配对的 tool 消息，把决定权交回用户。
 */
export function confirmationSettlementMessages(
  messages: readonly ChatMessage[],
  request: ConfirmationRequestRef,
  result: 'canceled' | 'interrupted',
): ChatMessage[] {
  if (
    messages.some(
      (message) =>
        message.role === 'tool' && message.toolCallId === request.callId,
    )
  ) {
    return [...messages]
  }
  return [
    ...messages,
    {
      role: 'tool',
      toolCallId: request.callId,
      toolName: request.name,
      content: JSON.stringify(
        result === 'canceled'
          ? {
              ok: false,
              canceled: true,
              error: '用户取消了这次操作，工具未执行，也没有创建或删除节点。',
            }
          : {
              ok: false,
              interrupted: true,
              error: '用户停止了当前任务；不继续调用模型，也不自动重试。',
            },
      ),
    },
  ]
}
