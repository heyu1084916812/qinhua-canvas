const SUMMARY_LIMIT = 48

export function conciseAgentRequest(text: string): string {
  const normalized = text
    .replace(/@\[([^\]]*)\]\((?:node|model|skill|preset):[^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  const characters = Array.from(normalized)
  return characters.length > SUMMARY_LIMIT
    ? `${characters.slice(0, SUMMARY_LIMIT).join('')}…`
    : normalized
}

export function agentThinkingSummary(text: string): string {
  const request = conciseAgentRequest(text)
  return request ? `正在理解你的要求：${request}` : '正在理解你的要求'
}

export function agentToolActivitySummary(stepLabel: string | undefined): string {
  return stepLabel ? `正在核对画布：${stepLabel}` : '正在查看画布和结果'
}
