import { describe, expect, it } from 'vitest'
import type { StoryboardShot } from './storyboard'
import { digitalHumanPlanOf } from './digitalHuman'

function shot(lines: StoryboardShot['lines']): StoryboardShot {
  return {
    id: 'shot-1',
    episodeId: 'ep-1',
    scene: 'scene',
    lines,
    durationSec: 5,
    prompt: '',
  }
}

describe('digitalHumanPlanOf', () => {
  it('allows a single line with audio without requiring a speaker', () => {
    const plan = digitalHumanPlanOf(
      shot([{ id: 'l1', text: 'hello', audioHash: 'audio-1' }]),
    )
    expect(plan.ok).toBe(true)
  })

  it('allows multiple finished lines from the same speaker', () => {
    const plan = digitalHumanPlanOf(
      shot([
        { id: 'l1', speakerId: 'char-1', text: 'one', audioHash: 'audio-1' },
        { id: 'l2', speakerId: 'char-1', text: 'two', audioHash: 'audio-2' },
      ]),
    )
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.lines.map((line) => line.id)).toEqual(['l1', 'l2'])
  })

  it('blocks multiple lines when any audio is missing', () => {
    const plan = digitalHumanPlanOf(
      shot([
        { id: 'l1', speakerId: 'char-1', text: 'one', audioHash: 'audio-1' },
        { id: 'l2', speakerId: 'char-1', text: 'two' },
      ]),
    )
    expect(plan).toEqual({ ok: false, reason: '先把这一镜的每句台词都生成配音' })
  })

  it('blocks multiple lines without an explicit shared speaker', () => {
    const plan = digitalHumanPlanOf(
      shot([
        { id: 'l1', text: 'one', audioHash: 'audio-1' },
        { id: 'l2', text: 'two', audioHash: 'audio-2' },
      ]),
    )
    expect(plan.ok).toBe(false)
  })

  it('blocks a multi-speaker shot', () => {
    const plan = digitalHumanPlanOf(
      shot([
        { id: 'l1', speakerId: 'char-1', text: 'one', audioHash: 'audio-1' },
        { id: 'l2', speakerId: 'char-2', text: 'two', audioHash: 'audio-2' },
      ]),
    )
    expect(plan.ok).toBe(false)
  })
})
