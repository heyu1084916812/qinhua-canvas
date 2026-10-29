import type {
  ChatMessage,
  NodeInput,
  ToolDeclaration,
} from '../../../domain/shared/execution/types'
import type { TextResult } from '../../../platform/channels/types'
import type {
  DirectRunRouteCandidate,
  DirectRunTraceInput,
} from '../../../state/shared/directRun'

export interface AgentRouteExecutionRequest {
  channelId: string
  model: string
  modelIsUpstream?: boolean
  tools: readonly ToolDeclaration[]
  messages: readonly ChatMessage[]
  inputs?: readonly NodeInput[]
  signal: AbortSignal
  timeoutMs?: number
  routeCandidates?: readonly DirectRunRouteCandidate[]
  routePlanId?: string
  trace: DirectRunTraceInput
  onRecordWarning?: (warning: string) => void
  onRouteSucceeded?: (route: DirectRunRouteCandidate) => void
}

export interface RouteExecutionPort {
  execute(request: AgentRouteExecutionRequest): Promise<TextResult>
}

/**
 * Agent 唯一的文本发送入口。
 *
 * Agent 只能提交已冻结的消息、工具和 RoutePlan；渠道解析、凭据读取、安全降级、
 * RunRecord 与重试边界仍由轻画执行层负责。
 */
export function createRouteExecutionPort(
  execute: (request: AgentRouteExecutionRequest) => Promise<TextResult>,
): RouteExecutionPort {
  return {
    execute(request) {
      return execute(request)
    },
  }
}
