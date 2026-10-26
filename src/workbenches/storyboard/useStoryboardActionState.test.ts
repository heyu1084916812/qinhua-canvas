import { describe, expect, it, vi } from 'vitest'
import { createStoryboardActionStateStore } from './useStoryboardActionState'

describe('storyboard action state', () => {
  it('locks by action and subject, not with one global lock', () => {
    const store = createStoryboardActionStateStore()

    const voiceA = store.tryAcquire('voice', 'line-a')
    const voiceB = store.tryAcquire('voice', 'line-b')
    const digitalA = store.tryAcquire('digital-human', 'shot-a')
    const editA = store.tryAcquire('video-edit', 'shot-a')
    const extendA = store.tryAcquire('video-extend', 'shot-a')

    expect(voiceA).not.toBeNull()
    expect(voiceB).not.toBeNull()
    expect(digitalA).not.toBeNull()
    expect(editA).not.toBeNull()
    expect(extendA).not.toBeNull()
    expect(store.tryAcquire('voice', 'line-a')).toBeNull()
    expect(store.tryAcquire('video-edit', 'shot-a')).toBeNull()
    expect(store.tryAcquire('video-edit', 'shot-b')).not.toBeNull()
  })

  it('publishes immutable snapshots and releases each lease once', () => {
    const store = createStoryboardActionStateStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const before = store.getBusy()
    const lease = store.tryAcquire('video-upscale', 'shot-a')!

    expect(store.getBusy()).not.toBe(before)
    expect(store.getBusy().videoUpscale).toEqual({ 'shot-a': true })
    expect(listener).toHaveBeenCalledTimes(1)

    lease.release()
    lease.release()
    expect(store.getBusy().videoUpscale).toEqual({})
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    const second = store.tryAcquire('video-upscale', 'shot-a')!
    second.release()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
