import type { JsonRpcNotification, JsonRpcRequest } from './HarnessAcpProtocol'
import type { HarnessRuntimeEvent } from './HarnessAcpEvents'
import { harnessEventsFromAcpNotification } from './HarnessAcpEvents'

export interface HarnessSession {
  sessionId: string
  clientSessionId: string
  raw: unknown
}

export interface HarnessRuntimeClient {
  initialize(): Promise<unknown>
  newSession(input: { cwd: string; mcpServers?: unknown[] }): Promise<unknown>
  resumeSession(input: {
    sessionId: string
    cwd: string
    mcpServers?: unknown[]
  }): Promise<unknown>
  prompt(sessionId: string, prompt: unknown[]): Promise<unknown>
  cancel(sessionId: string): Promise<unknown>
  closeSession(sessionId: string): Promise<unknown>
  close(): Promise<void>
  onNotification(listener: (notification: JsonRpcNotification) => void): () => void
  onRequest(handler: (request: JsonRpcRequest) => Promise<unknown> | unknown): void
}

export interface HarnessRuntimePort {
  open(input: {
    sessionId: string
    cwd: string
    resume?: boolean
    mcpServers?: readonly unknown[]
    provider?: { url: string; token: string }
  }): Promise<HarnessSession>
  prompt(sessionId: string, text: string): Promise<unknown>
  cancel(sessionId: string): Promise<void>
  close(sessionId: string): Promise<void>
  onEvent(listener: (event: HarnessRuntimeEvent) => void): () => void
}

function sessionIdOf(result: unknown): string {
  if (!result || typeof result !== 'object') {
    throw new Error('ACP session 响应缺少 sessionId')
  }
  const row = result as Record<string, unknown>
  const sessionId =
    typeof row.sessionId === 'string'
      ? row.sessionId
      : typeof row.session_id === 'string'
        ? row.session_id
        : ''
  if (!sessionId) throw new Error('ACP session 响应缺少 sessionId')
  return sessionId
}

export function createHarnessRuntimePort(input: {
  createClient: (input: {
    sessionId: string
    cwd: string
    provider?: { url: string; token: string }
  }) => HarnessRuntimeClient
  onPermission?: (request: JsonRpcRequest) => Promise<unknown> | unknown
}): HarnessRuntimePort {
  const clients = new Map<
    string,
    { client: HarnessRuntimeClient; clientSessionId: string }
  >()
  const unsubscribers = new Map<string, () => void>()
  const listeners = new Set<(event: HarnessRuntimeEvent) => void>()

  const emit = (notification: JsonRpcNotification) => {
    for (const event of harnessEventsFromAcpNotification(notification)) {
      for (const listener of listeners) listener(event)
    }
  }

  return {
    async open(session) {
      if (clients.has(session.sessionId)) {
        throw new Error(`Harness 会话已存在：${session.sessionId}`)
      }
      const client = input.createClient(session)
      await client.initialize()
      client.onRequest(
        input.onPermission ??
          (() => ({ outcome: 'deny' })),
      )
      unsubscribers.set(
        session.sessionId,
        client.onNotification(emit),
      )
      const result = session.resume
        ? await client.resumeSession({
            sessionId: session.sessionId,
            cwd: session.cwd,
            mcpServers: [...(session.mcpServers ?? [])],
          })
        : await client.newSession({
            cwd: session.cwd,
            mcpServers: [...(session.mcpServers ?? [])],
          })
      const clientSessionId = sessionIdOf(result)
      clients.set(session.sessionId, { client, clientSessionId })
      return {
        sessionId: session.sessionId,
        clientSessionId,
        raw: result,
      }
    },
    async prompt(sessionId, text) {
      const record = clients.get(sessionId)
      if (!record) throw new Error(`Harness 会话不存在：${sessionId}`)
      return record.client.prompt(record.clientSessionId, [
        { type: 'text', text },
      ])
    },
    async cancel(sessionId) {
      const record = clients.get(sessionId)
      if (!record) return
      await record.client.cancel(record.clientSessionId)
    },
    async close(sessionId) {
      const record = clients.get(sessionId)
      if (!record) return
      clients.delete(sessionId)
      unsubscribers.get(sessionId)?.()
      unsubscribers.delete(sessionId)
      await record.client.closeSession(record.clientSessionId).catch(() => null)
      await record.client.close()
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
