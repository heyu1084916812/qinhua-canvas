import { describe, expect, it, vi } from 'vitest'
import { buildRoutePlan } from '../../../domain/project/routePlan'
import { AGENT_LOCAL_PROVIDER_ID, createModelRoutePort } from './ModelRoutePort'

describe('Agent ModelRoutePort', () => {
  it('forwards the logical model and capability to the existing RoutePlan', async () => {
    const plan = buildRoutePlan({
      capability: 'chat',
      logicalModel: 'GPT-6 Astra',
      policy: { strategy: 'priority' },
      channels: [],
    })
    const planner = vi.fn(async () => plan)
    const port = createModelRoutePort(planner)

    await expect(
      port.plan({ capability: 'chat', logicalModel: 'GPT-6 Astra' }),
    ).resolves.toBe(plan)
    expect(planner).toHaveBeenCalledWith({
      category: 'chat',
      logicalModel: 'GPT-6 Astra',
    })
  })

  it('keeps a single synthetic provider id', () => {
    expect(AGENT_LOCAL_PROVIDER_ID).toBe('qinghua-local')
  })
})
