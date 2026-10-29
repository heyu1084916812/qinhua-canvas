import { describe, expect, it } from 'vitest'
import {
  agentThinkingSummary,
  agentToolActivitySummary,
  conciseAgentRequest,
} from './agentActivitySummary'

describe('Agent activity summaries', () => {
  it('keeps a readable public summary instead of exposing hidden reasoning', () => {
    expect(agentThinkingSummary('做一套品牌视觉，先确认产品图。')).toBe(
      '正在理解你的要求：做一套品牌视觉，先确认产品图。',
    )
  })

  it('removes mention markup and bounds long prompts', () => {
    const text = `@[参考图](node:node_1) ${'很长的要求'.repeat(20)}`
    const summary = conciseAgentRequest(text)
    expect(summary.startsWith('参考图 很长的要求')).toBe(true)
    expect(Array.from(summary).length).toBeLessThanOrEqual(49)
  })

  it('names the current tool step when available', () => {
    expect(agentToolActivitySummary('已看画布')).toBe('正在核对画布：已看画布')
    expect(agentToolActivitySummary(undefined)).toBe('正在查看画布和结果')
  })
})
