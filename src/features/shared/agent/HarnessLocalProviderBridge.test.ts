import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import { directTextTrace } from '../../../state/shared/directRun'
import { createHarnessLocalProviderBridge } from './HarnessLocalProviderBridge'

const request = {
  requestId: 'req-1',
  model: 'GPT-6 Astra',
  messages: [{ role: 'user' as const, content: '做一张主图' }],
  tools: [{ name: 'readGraph', parameters: { type: 'object' } }],
}

describe('HarnessLocalProviderBridge', () => {
  it('maps a fixed front-end model through the existing RoutePlan', async () => {
    const execute = vi.fn(async () => ({
      text: '开始建图',
      finishReason: 'stop' as const,
    }))
    const route = {
      channelId: 'channel-1',
      upstreamModel: 'upstream-chat-1',
      candidates: [{ channelId: 'channel-1', model: 'upstream-chat-1' }],
      routePlanId: 'plan-1',
      trace: directTextTrace({
        projectId: 'p1',
        workbench: 'canvas',
        subjectId: 's1',
        scopeId: 'session:s1',
        operationId: 'op-1',
        purpose: 'agent',
        channelId: 'channel-1',
        model: 'upstream-chat-1',
        prompt: '做一张主图',
      }),
    }
    const bridge = createHarnessLocalProviderBridge({
      execution: { execute },
      listModels: async () => ['GPT-6 Astra', 'GPT Image 2'],
      resolveRoute: async () => route,
    })

    await expect(bridge.listModels()).resolves.toEqual([
      'GPT-6 Astra',
      'GPT Image 2',
    ])
    await expect(bridge.complete(request)).resolves.toEqual({
      requestId: 'req-1',
      text: '开始建图',
      finishReason: 'stop',
    })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        model: 'upstream-chat-1',
        modelIsUpstream: true,
        messages: request.messages,
        tools: request.tools,
        routeCandidates: route.candidates,
        routePlanId: 'plan-1',
      }),
    )
  })

  it('accepts a Harness stream flag while the upstream stays safely non-streaming', async () => {
    const execute = vi.fn(async () => ({
      text: '完成',
      finishReason: 'stop' as const,
    }))
    const bridge = createHarnessLocalProviderBridge({
      execution: { execute },
      listModels: async () => [],
      resolveRoute: async () => ({
        channelId: 'channel-1',
        upstreamModel: 'upstream-chat-1',
        candidates: [{ channelId: 'channel-1', model: 'upstream-chat-1' }],
        routePlanId: 'plan-1',
        trace: directTextTrace({
          projectId: 'p1',
          workbench: 'canvas',
          subjectId: 's1',
          scopeId: 'session:s1',
          operationId: 'op-1',
          purpose: 'agent',
          channelId: 'channel-1',
          model: 'upstream-chat-1',
          prompt: '继续',
        }),
      }),
    })
    await expect(
      bridge.complete({ ...request, stream: true }),
    ).resolves.toMatchObject({ requestId: 'req-1', text: '完成' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('compacts old tool results before they enter the model request', async () => {
    let sentMessages: readonly ChatMessage[] = []
    const execute = vi.fn(
      async (input: { messages: readonly ChatMessage[] }) => {
        sentMessages = input.messages
        return {
          text: '继续',
          finishReason: 'stop' as const,
        }
      },
    )
    const route = {
      channelId: 'channel-1',
      upstreamModel: 'upstream-chat-1',
      candidates: [{ channelId: 'channel-1', model: 'upstream-chat-1' }],
      routePlanId: 'plan-1',
      trace: directTextTrace({
        projectId: 'p1',
        workbench: 'canvas',
        subjectId: 's1',
        scopeId: 'session:s1',
        operationId: 'op-1',
        purpose: 'agent',
        channelId: 'channel-1',
        model: 'upstream-chat-1',
        prompt: '继续',
      }),
    }
    const bridge = createHarnessLocalProviderBridge({
      execution: { execute },
      listModels: async () => [],
      resolveRoute: async () => route,
    })
    const messages = Array.from({ length: 5 }, (_, index) => ({
      role: 'tool' as const,
      content: `结果 ${index} ${'x'.repeat(8_000)}`,
      toolCallId: `call-${index}`,
      toolName: 'readGraph',
    }))

    await bridge.complete({ ...request, messages })

    expect(sentMessages[0]!.content).toContain('中间省略')
    expect(sentMessages[4]!.content).toContain('中间省略')
    expect(sentMessages[4]!.content.length).toBeGreaterThan(
      sentMessages[0]!.content.length,
    )
  })
})
