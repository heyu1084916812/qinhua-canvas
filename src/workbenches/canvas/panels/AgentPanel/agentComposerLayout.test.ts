import { describe, expect, it } from 'vitest'
import {
  AGENT_COMPOSER_HEIGHT_MAX,
  AGENT_COMPOSER_HEIGHT_MIN,
  agentComposerMaxHeight,
  clampAgentComposerHeight,
  parseAgentComposerHeight,
  resizedAgentComposerHeight,
} from './agentComposerLayout'

describe('Agent composer layout', () => {
  it('keeps the current composer height as the minimum', () => {
    expect(AGENT_COMPOSER_HEIGHT_MIN).toBe(104)
    expect(clampAgentComposerHeight(80, 700)).toBe(AGENT_COMPOSER_HEIGHT_MIN)
  })

  it('allows growth up to 360px and tightens against the panel height', () => {
    expect(clampAgentComposerHeight(240, 700)).toBe(240)
    expect(clampAgentComposerHeight(999, 700)).toBe(AGENT_COMPOSER_HEIGHT_MAX)
    expect(agentComposerMaxHeight(400)).toBe(224)
    expect(agentComposerMaxHeight(200)).toBe(AGENT_COMPOSER_HEIGHT_MIN)
  })

  it('grows when the top handle moves upward', () => {
    expect(resizedAgentComposerHeight(104, 500, 420, 700)).toBe(184)
    expect(resizedAgentComposerHeight(184, 500, 650, 700)).toBe(AGENT_COMPOSER_HEIGHT_MIN)
  })

  it('restores valid stored values and safely ignores corrupt values', () => {
    expect(parseAgentComposerHeight('228', 700)).toBe(228)
    expect(parseAgentComposerHeight('oops', 700)).toBe(AGENT_COMPOSER_HEIGHT_MIN)
    expect(parseAgentComposerHeight(null, 700)).toBe(AGENT_COMPOSER_HEIGHT_MIN)
  })
})
