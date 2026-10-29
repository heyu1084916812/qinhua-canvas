import { describe, expect, it } from 'vitest'
import {
  AGENT_JUMP_LATEST_THRESHOLD,
  agentDistanceFromBottom,
  agentShouldFollowLatest,
  agentShouldShowJumpLatest,
} from './agentConversationScroll'

describe('Agent conversation scroll position', () => {
  it('keeps following while the user is at the bottom', () => {
    expect(agentShouldFollowLatest({ scrollTop: 696, scrollHeight: 1200, clientHeight: 500 })).toBe(true)
    expect(agentShouldFollowLatest({ scrollTop: 630, scrollHeight: 1200, clientHeight: 500 })).toBe(false)
  })

  it('shows jump-to-latest only after moving away by three lines', () => {
    expect(
      agentShouldShowJumpLatest({
        scrollTop: 700 - AGENT_JUMP_LATEST_THRESHOLD + 1,
        scrollHeight: 1200,
        clientHeight: 500,
      }),
    ).toBe(false)
    expect(
      agentShouldShowJumpLatest({
        scrollTop: 700 - AGENT_JUMP_LATEST_THRESHOLD,
        scrollHeight: 1200,
        clientHeight: 500,
      }),
    ).toBe(true)
  })

  it('never returns a negative distance', () => {
    expect(agentDistanceFromBottom({ scrollTop: 800, scrollHeight: 1200, clientHeight: 500 })).toBe(0)
  })
})
