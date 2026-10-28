import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAgentDeliveryModeForTest,
  getAgentDeliveryMode,
  setAgentDeliveryMode,
  subscribeAgentDeliveryMode,
} from './agentDelivery'

describe('Agent delivery preference', () => {
  beforeEach(() => {
    __resetAgentDeliveryModeForTest()
  })

  it('defaults to steer and notifies subscribers only on change', () => {
    expect(getAgentDeliveryMode()).toBe('steer')
    const listener = vi.fn()
    const unsubscribe = subscribeAgentDeliveryMode(listener)

    setAgentDeliveryMode('steer')
    expect(listener).not.toHaveBeenCalled()

    setAgentDeliveryMode('queue')
    expect(getAgentDeliveryMode()).toBe('queue')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    setAgentDeliveryMode('steer')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('falls back to steer for corrupt values', () => {
    setAgentDeliveryMode('queue')
    setAgentDeliveryMode('unexpected')
    expect(getAgentDeliveryMode()).toBe('steer')
  })
})
