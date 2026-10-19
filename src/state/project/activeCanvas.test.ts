import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeCanvasId,
  forgetActiveCanvas,
  getActiveCanvasRevision,
  rememberActiveCanvas,
  subscribeActiveCanvas,
} from './activeCanvas'

describe('activeCanvas selection', () => {
  beforeEach(() => {
    forgetActiveCanvas()
  })

  it('记住与清除都会通知订阅者并推进 revision', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActiveCanvas(listener)
    const before = getActiveCanvasRevision()

    rememberActiveCanvas('p1')
    expect(activeCanvasId()).toBe('p1')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getActiveCanvasRevision()).toBe(before + 1)

    forgetActiveCanvas()
    expect(activeCanvasId()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
  })
})
