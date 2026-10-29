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
import { compactHarnessContext } from './HarnessContextCompaction'
import type { RouteExecutionPort } from './RouteExecutionPort'

export interface HarnessLocalChatRequest {
  requestId: string
  model: string
  messages: readonly ChatMessage[]
  tools?: readonly ToolDeclaration[]
  inputs?: readonly NodeInput[]
  stream?: boolean
}

export interface HarnessLocalRoute {
  channelId: string
  upstreamModel: string
  candidates: readonly DirectRunRouteCandidate[]
  routePlanId: string
  trace: DirectRunTraceInput
}

export interface HarnessLocalChatResponse extends TextResult {
  requestId: string
}

export interface HarnessLocalProviderBridge {
  listModels(): Promise<string[]>
  complete(
    request: HarnessLocalChatRequest,
    signal?: AbortSignal,
  ): Promise<HarnessLocalChatResponse>
}

/**
 * `qinghua-local` 的唯一业务实现。
 *
 * Harness 只提交固定前端模型名、消息和工具；这里把模型交给轻画现成 RoutePlan，
 * 再经 RouteExecutionPort 发送。它不读取 Key，也不接受 provider/baseUrl/retry。
 */
export function createHarnessLocalProviderBridge(input: {
  execution: RouteExecutionPort
  listModels: () => Promise<string[]>
  resolveRoute: (
    request: HarnessLocalChatRequest,
  ) => Promise<HarnessLocalRoute>
}): HarnessLocalProviderBridge {
  return {
    listModels: input.listModels,
    async complete(request, signal = new AbortController().signal) {
      const route = await input.resolveRoute(request)
      const compacted = compactHarnessContext(request.messages)
      const result = await input.execution.execute({
        channelId: route.channelId,
        model: route.upstreamModel,
        modelIsUpstream: true,
        tools: request.tools ?? [],
        messages: compacted.messages,
        ...(request.inputs?.length ? { inputs: request.inputs } : {}),
        signal,
        routeCandidates: route.candidates,
        routePlanId: route.routePlanId,
        trace: route.trace,
      })
      return {
        requestId: request.requestId,
        ...result,
      }
    },
  }
}
