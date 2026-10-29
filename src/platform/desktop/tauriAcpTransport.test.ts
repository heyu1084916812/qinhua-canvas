import { describe, expect, it, vi } from 'vitest'
import type { TauriAcpBridge } from './tauriAcpTransport'
import { createTauriAcpTransport } from './tauriAcpTransport'

function fakeBridge() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  return {
    bridge: {
      start: vi.fn(async () => {}),
      write: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      listen: vi.fn(async <T>(event: string, handler: (payload: T) => void) => {
        const set = listeners.get(event) ?? new Set()
        set.add(handler as (payload: unknown) => void)
        listeners.set(event, set)
        return () => set.delete(handler as (payload: unknown) => void)
      }),
    } satisfies TauriAcpBridge,
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Tauri ACP transport', () => {
  it('starts once, maps stdout/stderr events, and closes the process', async () => {
    const fake = fakeBridge()
    const lines: string[] = []
    const diagnostics: string[] = []
    const transport = createTauriAcpTransport({
      sessionId: 's1',
      cwd: 'E:/project',
      bridge: fake.bridge,
    })
    transport.onLine((line) => lines.push(line))
    transport.onDiagnostic?.((line) => diagnostics.push(line))

    await transport.send('{"jsonrpc":"2.0"}\n')
    await transport.send('{"jsonrpc":"2.0","method":"x"}\n')
    expect(fake.bridge.start).toHaveBeenCalledTimes(1)
    expect(fake.bridge.start).toHaveBeenCalledWith('s1', 'E:/project')
    expect(fake.bridge.write).toHaveBeenCalledTimes(2)

    fake.emit('acp:stdout', { id: 's1', line: '{"jsonrpc":"2.0","id":1,"result":{}}' })
    fake.emit('acp:stderr', { id: 's1', line: 'diagnostic' })
    fake.emit('acp:stdout', { id: 'other', line: 'ignored' })
    expect(lines).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}'])
    expect(diagnostics).toEqual(['diagnostic'])

    await transport.close()
    expect(fake.bridge.stop).toHaveBeenCalledWith('s1')
  })

  it('waits for event listeners before starting the sidecar', async () => {
    const fake = fakeBridge()
    const transport = createTauriAcpTransport({
      sessionId: 's1',
      cwd: 'E:/project',
      bridge: fake.bridge,
    })
    transport.onLine(() => {})
    await transport.send('ping\n')
    await tick()
    expect(fake.bridge.listen).toHaveBeenCalledTimes(3)
    expect(fake.bridge.start).toHaveBeenCalledTimes(1)
    await transport.close()
  })
})
