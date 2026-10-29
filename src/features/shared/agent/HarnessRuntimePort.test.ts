import { describe, expect, it, vi } from 'vitest'
import type { JsonRpcNotification, JsonRpcRequest } from './HarnessAcpProtocol'
import type { HarnessRuntimeClient } from './HarnessRuntimePort'
import { createHarnessRuntimePort } from './HarnessRuntimePort'

function fakeClient() {
  let notify: ((message: JsonRpcNotification) => void) | null = null
  let handleRequest: ((request: JsonRpcRequest) => unknown) | null = null
  const client = {
    initialize: vi.fn(async () => ({})),
    newSession: vi.fn(async () => ({ sessionId: 'acp-session-1' })),
    resumeSession: vi.fn(async () => ({ sessionId: 'acp-session-1' })),
    prompt: vi.fn(async () => ({ stopReason: 'end_turn' })),
    cancel: vi.fn(async () => ({})),
    closeSession: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
    onNotification: vi.fn((listener) => {
      notify = listener
      return () => {
        notify = null
      }
    }),
    onRequest: vi.fn((handler) => {
      handleRequest = handler
    }),
  } satisfies HarnessRuntimeClient
  return {
    client,
    emit(message: JsonRpcNotification) {
      notify?.(message)
    },
    request(request: JsonRpcRequest) {
      return handleRequest?.(request)
    },
  }
}

describe('HarnessRuntimePort', () => {
  it('opens a session, forwards prompts by ACP id, and emits normalized updates', async () => {
    const fake = fakeClient()
    const events = vi.fn()
    const port = createHarnessRuntimePort({
      createClient: () => fake.client,
      onPermission: () => ({ outcome: 'allow_once' }),
    })
    port.onEvent(events)

    await expect(
      port.open({
        sessionId: 'local-s1',
        cwd: 'E:/project',
        mcpServers: [
          {
            name: 'qinghua-canvas',
            command: 'mcp-server',
            args: [],
            env: [],
          },
        ],
      }),
    ).resolves.toMatchObject({
      sessionId: 'local-s1',
      clientSessionId: 'acp-session-1',
    })
    expect(fake.client.newSession).toHaveBeenCalledWith({
      cwd: 'E:/project',
      mcpServers: [
        {
          name: 'qinghua-canvas',
          command: 'mcp-server',
          args: [],
          env: [],
        },
      ],
    })
    await port.prompt('local-s1', '做一张主图')
    expect(fake.client.prompt).toHaveBeenCalledWith('acp-session-1', [
      { type: 'text', text: '做一张主图' },
    ])
    fake.emit({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'acp-session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'm1',
          content: { type: 'text', text: '开始生成' },
        },
      },
    })
    expect(events).toHaveBeenCalledWith({
      kind: 'message',
      sessionId: 'acp-session-1',
      messageId: 'm1',
      content: { type: 'text', text: '开始生成' },
    })
    expect(
      fake.request({
        jsonrpc: '2.0',
        id: 'permission-1',
        method: 'session/request_permission',
      }),
    ).toEqual({ outcome: 'allow_once' })

    await port.close('local-s1')
    expect(fake.client.closeSession).toHaveBeenCalledWith('acp-session-1')
    expect(fake.client.close).toHaveBeenCalled()
  })
})
