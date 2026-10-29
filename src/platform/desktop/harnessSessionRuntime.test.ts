import { describe, expect, it, vi } from 'vitest'
import type { HarnessRuntimeEvent } from '../../features/shared/agent/HarnessAcpEvents'
import type { HarnessRuntimePort } from '../../features/shared/agent/HarnessRuntimePort'
import { openTauriHarnessSession } from './harnessSessionRuntime'

const tools = [
  {
    name: 'readGraph',
    parameters: { type: 'object' },
  },
] as const

describe('Tauri Harness session runtime', () => {
  it('opens an isolated provider, passes ACP MCP/provider config, and closes all owners', async () => {
    let eventListener: ((event: HarnessRuntimeEvent) => void) | null = null
    let permission:
      | ((request: {
          jsonrpc: '2.0'
          id: string
          method: string
        }) => unknown)
      | undefined
    const runtime: HarnessRuntimePort = {
      open: vi.fn(async () => ({
        sessionId: 'local-1',
        clientSessionId: 'acp-1',
        raw: {},
      })),
      prompt: vi.fn(async () => ({ stopReason: 'end_turn' })),
      cancel: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      onEvent(listener) {
        eventListener = listener
        return () => {
          eventListener = null
        }
      },
    }
    const stopProvider = vi.fn(async () => {})
    const startProviderHost = vi.fn(async () => ({
      endpoint: {
        providerId: 'provider-local-1',
        baseUrl: 'http://127.0.0.1:4321',
        token: 'provider-token',
      },
      mcp: {
        name: 'qinghua-canvas',
        type: 'http' as const,
        url: 'http://127.0.0.1:4321/mcp',
        headers: [
          { name: 'Authorization', value: 'Bearer provider-token' },
        ],
      },
      stop: stopProvider,
    }))
    const onEvent = vi.fn()
    const executeTool = vi.fn(async () => ({ ok: true }))
    const onPermission = vi.fn(() => ({ outcome: 'allow_once' }))

    const session = await openTauriHarnessSession(
      {
        sessionId: 'local-1',
        cwd: 'E:/project',
        provider: {
          listModels: async () => ['qinghua-agent'],
          complete: vi.fn(),
        },
        tools,
        executeTool,
        onEvent,
        onPermission,
      },
      {
        startProviderHost,
        createRuntime(createClient, fallbackPermission) {
          permission = fallbackPermission as typeof permission
          void createClient
          return runtime
        },
      },
    )

    expect(startProviderHost).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'provider-local-1',
        tools: expect.objectContaining({ handle: expect.any(Function) }),
      }),
    )
    expect(runtime.open).toHaveBeenCalledWith({
      sessionId: 'local-1',
      cwd: 'E:/project',
      provider: {
        url: 'http://127.0.0.1:4321',
        token: 'provider-token',
      },
      mcpServers: [
        expect.objectContaining({
          name: 'qinghua-canvas',
          type: 'http',
        }),
      ],
      onPermission,
    })
    expect(permission).toBe(onPermission)
    const emit = eventListener as unknown as (
      event: HarnessRuntimeEvent,
    ) => void
    emit({
      kind: 'message',
      sessionId: 'local-1',
      messageId: 'm1',
      content: { type: 'text', text: '收到' },
    })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message', sessionId: 'local-1' }),
    )
    await session.prompt('继续')
    expect(runtime.prompt).toHaveBeenCalledWith('local-1', '继续')
    await session.cancel()
    expect(runtime.cancel).toHaveBeenCalledWith('local-1')
    await session.close()
    expect(runtime.close).toHaveBeenCalledWith('local-1')
    expect(stopProvider).toHaveBeenCalled()
  })
})
