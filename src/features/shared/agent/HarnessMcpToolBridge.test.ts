import { describe, expect, it, vi } from 'vitest'
import { createHarnessMcpToolBridge } from './HarnessMcpToolBridge'

const tools = [
  {
    name: 'readGraph',
    description: '读取画布',
    parameters: {
      type: 'object',
      properties: { scope: { type: 'string' } },
      required: ['scope'],
    },
  },
] as const

describe('Harness MCP tool bridge', () => {
  it('initializes and publishes only registered tool schemas', async () => {
    const bridge = createHarnessMcpToolBridge({
      tools,
      execute: vi.fn(),
    })

    await expect(
      bridge.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    ).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'qinghua-canvas' },
      },
    })

    const listed = await bridge.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(listed).toMatchObject({
      result: {
        tools: [
          {
            name: 'readGraph',
            description: '读取画布',
            inputSchema: tools[0].parameters,
          },
        ],
      },
    })
  })

  it('executes a registered tool and returns MCP text content', async () => {
    const execute = vi.fn(async () => ({ nodes: 2 }))
    const bridge = createHarnessMcpToolBridge({ tools, execute })

    const response = await bridge.handle({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'readGraph',
        arguments: { scope: 'all' },
        _meta: { 'qinghua/toolCallId': 'persisted-call' },
      },
    })

    expect(execute).toHaveBeenCalledWith({
      name: 'readGraph',
      args: { scope: 'all' },
      callId: 'persisted-call',
    })
    expect(response).toMatchObject({
      result: {
        content: [{ type: 'text', text: '{"nodes":2}' }],
        isError: false,
      },
    })
  })

  it('returns tool failures to the model without breaking the MCP connection', async () => {
    const bridge = createHarnessMcpToolBridge({
      tools,
      execute: vi.fn(async () => {
        throw new Error('画布读取失败')
      }),
    })

    const response = await bridge.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'readGraph', arguments: { scope: 'all' } },
    })

    expect(response).toMatchObject({
      result: {
        content: [{ type: 'text', text: '画布读取失败' }],
        isError: true,
      },
    })
  })

  it('rejects an unregistered tool without calling the executor', async () => {
    const execute = vi.fn()
    const bridge = createHarnessMcpToolBridge({ tools, execute })

    const response = await bridge.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'deleteEverything', arguments: {} },
    })

    expect(execute).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      result: {
        content: [{ type: 'text', text: expect.stringContaining('未登记') }],
        isError: true,
      },
    })
  })

  it('accepts notifications without producing a JSON-RPC response', async () => {
    const bridge = createHarnessMcpToolBridge({
      tools,
      execute: vi.fn(),
    })

    await expect(
      bridge.handle({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    ).resolves.toBeNull()
  })

  it('refuses to expose a tool missing from the central registry', () => {
    expect(() =>
      createHarnessMcpToolBridge({
        tools: [
          {
            name: 'rawShell',
            parameters: { type: 'object' },
          },
        ],
        execute: vi.fn(),
      }),
    ).toThrow('不能暴露未登记工具')
  })
})
