import { describe, expect, it } from 'vitest'
import {
  agentRevealCharacters,
  agentRevealChunkSize,
  nextAgentRevealLength,
} from './agentOutputReveal'

describe('Agent output reveal', () => {
  it('splits by Unicode code point instead of UTF-16 halves', () => {
    expect(agentRevealCharacters('A😀B')).toEqual(['A', '😀', 'B'])
  })

  it('adapts chunk size so long answers still finish promptly', () => {
    expect(agentRevealChunkSize(20)).toBe(1)
    expect(agentRevealChunkSize(1100)).toBe(10)
  })

  it('never reveals beyond the final text', () => {
    expect(nextAgentRevealLength(0, 7)).toBe(1)
    expect(nextAgentRevealLength(6, 7)).toBe(7)
    expect(nextAgentRevealLength(7, 7)).toBe(7)
  })
})
