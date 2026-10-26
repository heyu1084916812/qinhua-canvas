import { describe, expect, it, vi } from 'vitest'
import { createNodeScopedRunCancellation } from './nodeScopedRunCancellation'

describe('nodeScopedRunCancellation', () => {
  it('cancels only the plan associated with the selected node', () => {
    const cancellation = createNodeScopedRunCancellation()
    const cancelPlan = vi.fn()

    cancellation.trackPlan('plan-a', ['node-a'])
    cancellation.trackPlan('plan-b', ['node-b'])

    expect(cancellation.cancelForNode('node-a', cancelPlan)).toEqual(['plan-a'])
    expect(cancelPlan).toHaveBeenCalledTimes(1)
    expect(cancelPlan).toHaveBeenCalledWith('plan-a')
  })

  it('tracks a carrier node and drops all links when the plan finishes', () => {
    const cancellation = createNodeScopedRunCancellation()
    const cancelPlan = vi.fn()

    cancellation.trackPlan('plan-a', ['source-node'])
    cancellation.addTarget('plan-a', 'carrier-node')

    expect(cancellation.cancelForNode('carrier-node', cancelPlan)).toEqual(['plan-a'])

    cancellation.release('plan-a')
    expect(cancellation.cancelForNode('source-node', cancelPlan)).toEqual([])
    expect(cancellation.cancelForNode('carrier-node', cancelPlan)).toEqual([])
    expect(cancelPlan).toHaveBeenCalledTimes(1)
  })
})
