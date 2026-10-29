import { describe, expect, it } from 'vitest'
import {
  AGENT_JUMP_LATEST_THRESHOLD,
  agentDistanceFromBottom,
  agentScrollTopAfterShrink,
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

  it('compensates the exact height lost when the composer grows', () => {
    expect(
      agentScrollTopAfterShrink(
        { scrollTop: 640, clientHeight: 500 },
        380,
      ),
    ).toBe(760)
    expect(
      agentScrollTopAfterShrink(
        { scrollTop: 0, clientHeight: 500 },
        380,
      ),
    ).toBe(0)
    expect(
      agentScrollTopAfterShrink(
        { scrollTop: 320, clientHeight: 380 },
        500,
      ),
    ).toBe(320)
  })
})
