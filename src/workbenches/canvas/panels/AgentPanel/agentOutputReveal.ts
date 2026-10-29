export const AGENT_REVEAL_TICK_MS = 24
export const AGENT_REVEAL_TARGET_TICKS = 110

export function agentRevealCharacters(text: string): string[] {
  return Array.from(text)
}

export function agentRevealChunkSize(totalCharacters: number): number {
  if (!Number.isFinite(totalCharacters) || totalCharacters <= 0) return 1
  return Math.max(1, Math.ceil(totalCharacters / AGENT_REVEAL_TARGET_TICKS))
}

export function nextAgentRevealLength(
  visibleCharacters: number,
  totalCharacters: number,
): number {
  return Math.min(
    Math.max(0, totalCharacters),
    Math.max(0, visibleCharacters) + agentRevealChunkSize(totalCharacters),
  )
}
