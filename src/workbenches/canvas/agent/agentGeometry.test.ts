import { describe, expect, it } from 'vitest'
import { avoidRectOverlap, intersectsRect } from './agentGeometry'

describe('avoidRectOverlap', () => {
  it('keeps an explicit non-overlapping position unchanged', () => {
    const desired = { x: 40, y: 60, w: 200, h: 120 }
    expect(avoidRectOverlap(desired, [{ x: 400, y: 60, w: 200, h: 120 }])).toEqual(
      desired,
    )
  })

  it('chooses the nearest free side instead of always pushing far right', () => {
    const desired = { x: 100, y: 100, w: 200, h: 120 }
    const occupied = [{ x: 80, y: 80, w: 240, h: 160 }]
    const moved = avoidRectOverlap(desired, occupied, 24)

    expect(intersectsRect(moved, occupied[0]!)).toBe(false)
    expect(moved).toEqual({ x: 100, y: 264, w: 200, h: 120 })
  })

  it('can move left when that is the closest free side', () => {
    const desired = { x: 300, y: 100, w: 200, h: 120 }
    const occupied = [
      { x: 330, y: 80, w: 240, h: 400 },
      { x: 300, y: 0, w: 200, h: 80 },
    ]
    const moved = avoidRectOverlap(desired, occupied, 24)

    expect(moved).toEqual({ x: 106, y: 100, w: 200, h: 120 })
  })
})
