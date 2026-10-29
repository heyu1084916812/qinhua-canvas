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

/**
 * 视口变矮时（输入框向上加高），把滚动位置下移同样的高度。
 * 这样用户正在阅读的最后几行仍停在输入框上方，而不是被新占用的空间裁掉。
 */
export function agentScrollTopAfterShrink(
  previous: Pick<AgentScrollMetrics, 'scrollTop' | 'clientHeight'>,
  nextClientHeight: number,
): number {
  const shrink = Math.max(0, previous.clientHeight - nextClientHeight)
  if (previous.scrollTop <= 0 || shrink === 0) return previous.scrollTop
  return previous.scrollTop + shrink
}
