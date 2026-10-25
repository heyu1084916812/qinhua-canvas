import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installScrollActivity, SCROLL_ACTIVITY_IDLE_MS } from './scrollActivity'

describe('installScrollActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts idle, activates on captured scroll, and hides after one second', () => {
    const root = { dataset: {} as Record<string, string | undefined> }
    let listener: EventListener = () => {
      throw new Error('scroll listener not installed')
    }
    const target = {
      addEventListener: vi.fn((_type: string, next: EventListener) => {
        listener = next
      }),
      removeEventListener: vi.fn(),
    }

    const cleanup = installScrollActivity({ root, target, idleMs: 50 })

    expect(root.dataset.scrollActive).toBe('false')
    expect(target.addEventListener).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function),
      expect.objectContaining({ capture: true, passive: true }),
    )

    listener(new Event('scroll'))
    expect(root.dataset.scrollActive).toBe('true')

    vi.advanceTimersByTime(49)
    expect(root.dataset.scrollActive).toBe('true')
    vi.advanceTimersByTime(1)
    expect(root.dataset.scrollActive).toBe('false')

    cleanup()
  })

  it('restarts the idle timer on each scroll and resets on cleanup', () => {
    const root = { dataset: {} as Record<string, string | undefined> }
    let listener: EventListener = () => {
      throw new Error('scroll listener not installed')
    }
    const target = {
      addEventListener: vi.fn((_type: string, next: EventListener) => {
        listener = next
      }),
      removeEventListener: vi.fn(),
    }

    const cleanup = installScrollActivity({
      root,
      target,
      idleMs: SCROLL_ACTIVITY_IDLE_MS,
    })

    listener(new Event('scroll'))
    vi.advanceTimersByTime(900)
    listener(new Event('scroll'))
    vi.advanceTimersByTime(900)
    expect(root.dataset.scrollActive).toBe('true')

    vi.advanceTimersByTime(100)
    expect(root.dataset.scrollActive).toBe('false')

    listener(new Event('scroll'))
    expect(root.dataset.scrollActive).toBe('true')
    cleanup()
    expect(root.dataset.scrollActive).toBe('false')
    expect(target.removeEventListener).toHaveBeenCalledWith(
      'scroll',
      listener,
      expect.objectContaining({ capture: true, passive: true }),
    )
  })
})
