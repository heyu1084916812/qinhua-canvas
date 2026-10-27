import { beforeEach, describe, expect, it } from 'vitest'
import {
  activeQueueTurnOf,
  claimSessionActivity,
  clearQueueDrain,
  isSessionActivityActive,
  releaseSessionActivity,
  requestQueueDrain,
  shouldDrainQueue,
  subscribeSessionRelease,
} from './sessionActivity'

describe('Agent session activity', () => {
  beforeEach(() => {
    releaseSessionActivity('chat-a')
    releaseSessionActivity('chat-b')
    clearQueueDrain('chat-a')
    clearQueueDrain('chat-b')
  })

  it('同一会话只能有一个活动回合，其他会话仍可并行', () => {
    expect(claimSessionActivity('chat-a')).toBe(true)
    expect(claimSessionActivity('chat-a')).toBe(false)
    expect(claimSessionActivity('chat-b')).toBe(true)
    expect(isSessionActivityActive('chat-a')).toBe(true)
    expect(isSessionActivityActive('chat-b')).toBe(true)
  })

  it('旧回合只能释放自己的队列任务，不能误解锁后续回合', () => {
    expect(claimSessionActivity('chat-a', 'turn-1')).toBe(true)
    expect(activeQueueTurnOf('chat-a')).toBe('turn-1')
    releaseSessionActivity('chat-a', 'turn-2')
    expect(isSessionActivityActive('chat-a')).toBe(true)
    releaseSessionActivity('chat-a', 'turn-1')
    expect(isSessionActivityActive('chat-a')).toBe(false)
  })

  it('排队继续意图跨面板重挂保留', () => {
    requestQueueDrain('chat-a')
    expect(shouldDrainQueue('chat-a')).toBe(true)
    clearQueueDrain('chat-a')
    expect(shouldDrainQueue('chat-a')).toBe(false)
  })

  it('活动回合释放时通知新挂载的面板继续队列', () => {
    const seen: string[] = []
    const unsubscribe = subscribeSessionRelease((sessionId) => seen.push(sessionId))
    claimSessionActivity('chat-a')
    releaseSessionActivity('chat-a')
    unsubscribe()
    expect(seen).toEqual(['chat-a'])
  })
})
