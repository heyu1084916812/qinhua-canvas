import type { UnlistenFn } from '@tauri-apps/api/event'
import type { AcpLineTransport } from '../../features/shared/agent/HarnessAcpClient'

interface AcpLinePayload {
  id: string
  line: string
}

interface AcpExitPayload {
  id: string
}

export interface TauriAcpBridge {
  start(id: string, cwd: string): Promise<void>
  write(id: string, line: string): Promise<void>
  stop(id: string): Promise<void>
  listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>
}

export const defaultTauriAcpBridge: TauriAcpBridge = {
  async start(id, cwd) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('acp_start', { id, cwd })
  },
  async write(id, line) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('acp_write', { id, line })
  },
  async stop(id) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<boolean>('acp_stop', { id })
  },
  async listen<T>(event: string, handler: (payload: T) => void) {
    const { listen } = await import('@tauri-apps/api/event')
    // Tauri wraps the serialized payload under `payload`.
    return listen<T>(event, (value) => handler(value.payload))
  },
}

export function createTauriAcpTransport(input: {
  sessionId: string
  cwd: string
  bridge?: TauriAcpBridge
}): AcpLineTransport {
  const bridge = input.bridge ?? defaultTauriAcpBridge
  const lineListeners = new Set<(line: string) => void>()
  const diagnosticListeners = new Set<(line: string) => void>()
  const exitListeners = new Set<() => void>()
  const unlisten: UnlistenFn[] = []
  let listenersReady: Promise<void> | null = null
  let startReady: Promise<void> | null = null
  let closed = false

  const ensureListeners = (): Promise<void> => {
    if (listenersReady) return listenersReady
    listenersReady = Promise.all([
      bridge.listen<AcpLinePayload>('acp:stdout', (payload) => {
        if (payload.id === input.sessionId) {
          for (const listener of lineListeners) listener(payload.line)
        }
      }),
      bridge.listen<AcpLinePayload>('acp:stderr', (payload) => {
        if (payload.id === input.sessionId) {
          for (const listener of diagnosticListeners) listener(payload.line)
        }
      }),
      bridge.listen<AcpExitPayload>('acp:exit', (payload) => {
        if (payload.id === input.sessionId) {
          for (const listener of exitListeners) listener()
        }
      }),
    ]).then((listeners) => {
      unlisten.push(...listeners)
    })
    return listenersReady
  }

  const ensureStarted = (): Promise<void> => {
    if (startReady) return startReady
    startReady = ensureListeners().then(() =>
      bridge.start(input.sessionId, input.cwd),
    )
    return startReady
  }

  return {
    async send(line) {
      if (closed) throw new Error('ACP 传输已关闭')
      await ensureStarted()
      await bridge.write(input.sessionId, line)
    },
    async close() {
      if (closed) return
      closed = true
      for (const off of unlisten.splice(0)) off()
      await bridge.stop(input.sessionId)
    },
    onLine(listener) {
      lineListeners.add(listener)
      void ensureListeners()
      return () => lineListeners.delete(listener)
    },
    onDiagnostic(listener) {
      diagnosticListeners.add(listener)
      void ensureListeners()
      return () => diagnosticListeners.delete(listener)
    },
    onExit(listener) {
      exitListeners.add(listener)
      void ensureListeners()
      return () => exitListeners.delete(listener)
    },
  }
}
