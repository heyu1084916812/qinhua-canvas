import { describe, expect, it, vi } from 'vitest'
import { directTextTrace } from '../../../state/shared/directRun'
import type { AgentRouteExecutionRequest } from './RouteExecutionPort'
import { createRouteExecutionPort } from './RouteExecutionPort'

describe('RouteExecutionPort', () => {
  it('forwards one frozen route-execution request without rewriting it', async () => {
    const request = {
      channelId: 'channel-1',
      model: 'upstream-model',
      modelIsUpstream: true,
      tools: [],
      messages: [{ role: 'user', content: '做一张主图' }],
      signal: new AbortController().signal,
      routeCandidates: [{ channelId: 'channel-1', model: 'upstream-model' }],
      routePlanId: 'plan-1',
      trace: directTextTrace({
        projectId: 'p1',
        workbench: 'canvas',
        subjectId: 's1',
        scopeId: 'session:s1',
        operationId: 'op-1',
        purpose: 'agent',
        channelId: 'channel-1',
        model: 'upstream-model',
        prompt: '做一张主图',
      }),
    } satisfies AgentRouteExecutionRequest
    const result = { text: '完成', toolCalls: [] }
    const execute = vi.fn(async () => result)
    const port = createRouteExecutionPort(execute)

    await expect(port.execute(request)).resolves.toBe(result)
    expect(execute).toHaveBeenCalledWith(request)
  })

  it('propagates execution errors unchanged for the caller-owned retry policy', async () => {
    const port = createRouteExecutionPort(async () => {
      throw new Error('结果未知，不自动重发')
    })

    await expect(
      port.execute({
        channelId: 'channel-1',
        model: 'model-1',
        tools: [],
        messages: [],
        signal: new AbortController().signal,
        trace: directTextTrace({
          projectId: 'p1',
          workbench: 'canvas',
          subjectId: 's1',
          scopeId: 'session:s1',
          operationId: 'op-1',
          purpose: 'agent',
          channelId: 'channel-1',
          model: 'model-1',
          prompt: '',
        }),
      }),
    ).rejects.toThrow('结果未知')
  })
})
