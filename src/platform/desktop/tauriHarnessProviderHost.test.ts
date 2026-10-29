import { describe, expect, it, vi } from 'vitest'
import { createHarnessMcpToolBridge } from '../../features/shared/agent/HarnessMcpToolBridge'
import type { TauriHarnessProviderBridge } from './tauriHarnessProviderHost'
import { startTauriHarnessProviderHost } from './tauriHarnessProviderHost'

function fakeBridge() {
  let handler: ((event: {
    requestId: string
    method: string
    path: string
    body: string
  }) => void) | null = null
  return {
    bridge: {
      start: vi.fn(async () => ({
        baseUrl: 'http://127.0.0.1:1234',
        token: 'token',
      })),
      stop: vi.fn(async () => {}),
      respond: vi.fn(async () => {}),
      listen: vi.fn(async (next) => {
        handler = next
        return () => {
          handler = null
        }
      }),
    } satisfies TauriHarnessProviderBridge,
    emit(event: {
      requestId: string
      method: string
      path: string
      body: string
    }) {
      handler?.(event)
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Tauri Harness provider host', () => {
  it('serves models and converts chat results to OpenAI-compatible JSON', async () => {
    const fake = fakeBridge()
    const provider = {
      listModels: vi.fn(async () => ['GPT-6 Astra']),
      complete: vi.fn(async () => ({
        requestId: 'provider-1',
        text: '开始',
        finishReason: 'tool_calls' as const,
        toolCalls: [{ id: 'call-1', name: 'readGraph', args: '{"scope":"all"}' }],
      })),
    }
    const tools = createHarnessMcpToolBridge({
      tools: [
        {
          name: 'readGraph',
          description: '读取画布',
          parameters: { type: 'object' },
        },
      ],
      execute: vi.fn(async () => ({ nodes: 2 })),
    })
    const host = await startTauriHarnessProviderHost({
      provider,
      tools,
      bridge: fake.bridge,
    })
    expect(host.endpoint.baseUrl).toBe('http://127.0.0.1:1234')
    expect(host.mcp).toEqual({
      name: 'qinghua-canvas',
      type: 'http',
      url: 'http://127.0.0.1:1234/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer token' }],
    })

    fake.emit({
      requestId: 'models-1',
      method: 'GET',
      path: '/v1/models',
      body: '',
    })
    await tick()
    expect(fake.bridge.respond).toHaveBeenNthCalledWith(
      1,
      'models-1',
      200,
      expect.stringContaining('GPT-6 Astra'),
    )

    fake.emit({
      requestId: 'provider-1',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'GPT-6 Astra',
        messages: [{ role: 'user', content: '读画布' }],
      }),
    })
    await tick()
    expect(fake.bridge.respond).toHaveBeenNthCalledWith(
      2,
      'provider-1',
      200,
      expect.stringContaining('"tool_calls"'),
    )

    fake.emit({
      requestId: 'mcp-1',
      method: 'POST',
      path: '/mcp',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    })
    await tick()
    expect(fake.bridge.respond).toHaveBeenNthCalledWith(
      3,
      'mcp-1',
      200,
      expect.stringContaining('"readGraph"'),
    )

    fake.emit({
      requestId: 'stream-1',
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'GPT-6 Astra',
        stream: true,
        messages: [{ role: 'user', content: '流式读取' }],
      }),
    })
    await tick()
    expect(fake.bridge.respond).toHaveBeenNthCalledWith(
      4,
      'stream-1',
      200,
      expect.stringMatching(/^data: .*data: \[DONE\]/s),
      'text/event-stream; charset=utf-8',
    )
    await host.stop()
    expect(fake.bridge.stop).toHaveBeenCalled()
  })
})
