import { describe, expect, it, vi } from 'vitest'
import type { AcpLineTransport } from './HarnessAcpClient'
import { HarnessAcpClient } from './HarnessAcpClient'

function fakeTransport() {
  const listeners = new Set<(line: string) => void>()
  const sent: string[] = []
  const transport: AcpLineTransport = {
    async send(line) {
      sent.push(line)
    },
    async close() {},
    onLine(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    transport,
    sent,
    emit(value: unknown) {
      const line = JSON.stringify(value)
      for (const listener of listeners) listener(line)
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('HarnessAcpClient', () => {
  it('matches responses by id and sends ACP session calls', async () => {
    const fake = fakeTransport()
    const client = new HarnessAcpClient(fake.transport)
    const result = client.newSession({ cwd: 'E:/project' })
    await tick()
    expect(JSON.parse(fake.sent[0]!)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { cwd: 'E:/project', mcpServers: [] },
    })
    fake.emit({ jsonrpc: '2.0', id: 1, result: { sessionId: 'session-1' } })
    await expect(result).resolves.toEqual({ sessionId: 'session-1' })
    await client.close()
  })

  it('dispatches session updates and answers permission requests', async () => {
    const fake = fakeTransport()
    const client = new HarnessAcpClient(fake.transport)
    const updates = vi.fn()
    client.onNotification(updates)
    client.onRequest(() => ({ outcome: 'allow_once' }))

    fake.emit({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'session-1' },
    })
    await tick()
    expect(updates).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'session/update' }),
    )

    fake.emit({
      jsonrpc: '2.0',
      id: 'permission-1',
      method: 'session/request_permission',
      params: { sessionId: 'session-1' },
    })
    await tick()
    expect(JSON.parse(fake.sent[0]!)).toMatchObject({
      jsonrpc: '2.0',
      id: 'permission-1',
      result: { outcome: 'allow_once' },
    })
    await client.close()
  })

  it('rejects pending requests when the transport closes', async () => {
    const fake = fakeTransport()
    const client = new HarnessAcpClient(fake.transport)
    const pending = client.prompt('session-1', [{ type: 'text', text: '继续' }])
    await tick()
    await client.close()
    await expect(pending).rejects.toThrow('ACP 连接已关闭')
  })

  it('rejects pending requests when the sidecar exits unexpectedly', async () => {
    const fake = fakeTransport()
    let emitExit: (() => void) | null = null
    const client = new HarnessAcpClient({
      ...fake.transport,
      onExit(listener) {
        emitExit = listener
        return () => {
          emitExit = null
        }
      },
    })
    const pending = client.newSession({ cwd: 'E:/project' })
    await tick()
    const triggerExit = emitExit as unknown as (() => void) | null
    triggerExit?.()
    await expect(pending).rejects.toThrow('Harness ACP 进程已退出')
    await client.close()
  })
})
