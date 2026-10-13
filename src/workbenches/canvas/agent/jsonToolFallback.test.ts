import { describe, expect, it } from 'vitest'
import { parseJsonAgentAction } from './jsonToolFallback'

describe('parseJsonAgentAction', () => {
  it('解析标准 tool/args 形态', () => {
    expect(parseJsonAgentAction('{"tool":"readGraph","args":{"scope":"all"}}')).toEqual({
      name: 'readGraph',
      args: { scope: 'all' },
    })
  })

  it('解析 name/arguments 形态与 json 代码块', () => {
    expect(
      parseJsonAgentAction('```json\n{"name":"applyPlan","arguments":{"nodes":[],"edges":[]}}\n```'),
    ).toEqual({ name: 'applyPlan', args: { nodes: [], edges: [] } })
  })

  it('裸的 applyPlan 对象也认', () => {
    expect(parseJsonAgentAction('{"summary":"x","nodes":[],"edges":[]}')).toEqual({
      name: 'applyPlan',
      args: { summary: 'x', nodes: [], edges: [] },
    })
  })

  it('解析不出 JSON 时返回 null，不猜', () => {
    expect(parseJsonAgentAction('我无法调用工具')).toBeNull()
    expect(parseJsonAgentAction('')).toBeNull()
  })
})
