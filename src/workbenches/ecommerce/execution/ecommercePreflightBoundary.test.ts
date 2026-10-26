import { describe, expect, it, vi } from 'vitest'
import {
  createEcommercePreflightBoundary,
  ECOMMERCE_CHANNEL_REMOVED_MESSAGE,
} from './ecommercePreflightBoundary'

describe('createEcommercePreflightBoundary', () => {
  it('blocks startup when the channel is removed during async preflight', async () => {
    const boundary = createEcommercePreflightBoundary()
    const startRun = vi.fn()
    let resolvePreflight!: (value: string) => void
    const pendingPreflight = new Promise<string>((resolve) => {
      resolvePreflight = resolve
    })

    const preflight = (async () => {
      await boundary.run(() => pendingPreflight)
      startRun()
    })()

    boundary.interrupt()
    resolvePreflight('resolved-after-channel-removal')

    await expect(preflight).rejects.toThrow(ECOMMERCE_CHANNEL_REMOVED_MESSAGE)
    expect(startRun).not.toHaveBeenCalled()
  })
})
