import type { RouteCapability, RoutePlanResult } from '../../../domain/project/routePlan'

/** Harness 唯一可见的合成 provider；它不代表新的渠道配置。 */
export const AGENT_LOCAL_PROVIDER_ID = 'qinghua-local'

export type AgentRouteCapability = Extract<RouteCapability, 'chat' | 'image' | 'video'>

export interface AgentModelRouteRequest {
  capability: AgentRouteCapability
  logicalModel: string
}

export interface ModelRoutePort {
  plan(request: AgentModelRouteRequest): Promise<RoutePlanResult>
}

/**
 * Agent 路由端口只做一件薄事：把 Harness 的合成 provider 请求转给轻画现有
 * ChannelStore / RoutePlan。Harness 不读取 Key，也不自己决定重试次数。
 */
export function createModelRoutePort(
  planGenerationRoute: (request: {
    category: AgentRouteCapability
    logicalModel: string
  }) => Promise<RoutePlanResult>,
): ModelRoutePort {
  return {
    plan(request) {
      return planGenerationRoute({
        category: request.capability,
        logicalModel: request.logicalModel,
      })
    },
  }
}
