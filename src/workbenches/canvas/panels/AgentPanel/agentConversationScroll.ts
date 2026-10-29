export const AGENT_SCROLL_BOTTOM_TOLERANCE = 4
export const AGENT_JUMP_LATEST_LINES = 3
export const AGENT_JUMP_LATEST_LINE_HEIGHT = 18
export const AGENT_JUMP_LATEST_THRESHOLD =
  AGENT_JUMP_LATEST_LINES * AGENT_JUMP_LATEST_LINE_HEIGHT

export interface AgentScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function agentDistanceFromBottom(metrics: AgentScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)
}

export function agentShouldFollowLatest(metrics: AgentScrollMetrics): boolean {
  return agentDistanceFromBottom(metrics) <= AGENT_SCROLL_BOTTOM_TOLERANCE
}

export function agentShouldShowJumpLatest(metrics: AgentScrollMetrics): boolean {
  return agentDistanceFromBottom(metrics) >= AGENT_JUMP_LATEST_THRESHOLD
}
