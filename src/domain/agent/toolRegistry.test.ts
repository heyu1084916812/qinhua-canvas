import { describe, expect, it } from 'vitest'
import {
  AGENT_CONFIRM_TOOL_NAMES,
  AGENT_READ_TOOL_NAMES,
  AGENT_TOOL_DEFINITIONS,
  AGENT_WRITE_TOOL_NAMES,
  agentToolDefinitionOf,
  agentToolIdempotencyKey,
  agentToolsInCategory,
  isAgentToolName,
} from './toolRegistry'

describe('Agent tool registry', () => {
  it('registers every tool exactly once', () => {
    const names = AGENT_TOOL_DEFINITIONS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(20)
    expect([...AGENT_READ_TOOL_NAMES, ...AGENT_WRITE_TOOL_NAMES, ...AGENT_CONFIRM_TOOL_NAMES].sort()).toEqual(
      [...names].sort(),
    )
  })

  it('keeps confirmation and paid tools owned by the existing runtime', () => {
    expect(AGENT_CONFIRM_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'proposeTaskPlan',
        'requestTaskConfirmation',
        'updateNode',
        'runNode',
        'runFrom',
        'deleteEdges',
        'deleteNodes',
        'rememberMemory',
      ]),
    )
    expect(agentToolDefinitionOf('runNode')?.sideEffect).toBe('paid')
    expect(agentToolDefinitionOf('visualReview')).toMatchObject({
      access: 'read',
      terminalAfter: true,
    })
  })

  it('groups tools by their actual owner', () => {
    expect(agentToolsInCategory('harness-internal')).toEqual([
      'proposeTaskPlan',
      'updateTaskStep',
      'requestTaskConfirmation',
    ])
    expect(agentToolsInCategory('host-service')).toEqual(['rememberMemory'])
    expect(agentToolsInCategory('canvas')).toContain('readGraph')
    expect(agentToolsInCategory('canvas')).toContain('splitGrid')
  })

  it('rejects unknown tools and builds stable idempotency keys', () => {
    expect(isAgentToolName('readGraph')).toBe(true)
    expect(isAgentToolName('runShell')).toBe(false)
    expect(
      agentToolIdempotencyKey({
        jobId: 'job-1',
        stepId: 'step-2',
        toolCallId: 'call-3',
      }),
    ).toBe('agent:job-1:step-2:call-3')
  })
})
