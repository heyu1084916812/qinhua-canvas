import {
  decodeAcpMessage,
  encodeAcpMessage,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from './HarnessAcpProtocol'

export interface AcpLineTransport {
  send(line: string): Promise<void>
  close(): Promise<void>
  onLine(listener: (line: string) => void): () => void
}

export interface AcpRequestHandler {
  (request: JsonRpcRequest): Promise<unknown> | unknown
}

export class AcpRequestError extends Error {
  constructor(readonly response: JsonRpcFailure) {
    super(response.error.message)
    this.name = 'AcpRequestError'
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class HarnessAcpClient {
  private pending = new Map<JsonRpcId, PendingRequest>()
  private listeners = new Set<(message: JsonRpcNotification) => void>()
  private requestHandler: AcpRequestHandler | null = null
  private nextId = 1
  private unsubscribeTransport: () => void
  private closed = false

  constructor(private readonly transport: AcpLineTransport) {
    this.unsubscribeTransport = transport.onLine((line) => void this.handleLine(line))
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('ACP 连接已关闭'))
    const id = this.nextId++
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      void this.transport.send(encodeAcpMessage(message)).catch((error) => {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error('ACP 连接已关闭'))
    return this.transport.send(
      encodeAcpMessage({
        jsonrpc: '2.0',
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    )
  }

  onNotification(listener: (message: JsonRpcNotification) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onRequest(handler: AcpRequestHandler): void {
    this.requestHandler = handler
  }

  initialize(): Promise<unknown> {
    return this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    })
  }

  newSession(input: { cwd: string; mcpServers?: unknown[] }): Promise<unknown> {
    return this.request('session/new', {
      cwd: input.cwd,
      mcpServers: input.mcpServers ?? [],
    })
  }

  listSessions(input: { cwd?: string; cursor?: string } = {}): Promise<unknown> {
    return this.request('session/list', input)
  }

  resumeSession(input: { sessionId: string; cwd: string; mcpServers?: unknown[] }): Promise<unknown> {
    return this.request('session/resume', {
      sessionId: input.sessionId,
      cwd: input.cwd,
      mcpServers: input.mcpServers ?? [],
    })
  }

  closeSession(sessionId: string): Promise<unknown> {
    return this.request('session/close', { sessionId })
  }

  prompt(sessionId: string, prompt: unknown[]): Promise<unknown> {
    return this.request('session/prompt', { sessionId, prompt })
  }

  cancel(sessionId: string): Promise<unknown> {
    return this.request('session/cancel', { sessionId })
  }

  setConfigOption(sessionId: string, configId: string, value: string): Promise<unknown> {
    return this.request('session/set_config_option', {
      sessionId,
      configId,
      value,
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.unsubscribeTransport()
    for (const request of this.pending.values()) {
      request.reject(new Error('ACP 连接已关闭'))
    }
    this.pending.clear()
    this.listeners.clear()
    await this.transport.close()
  }

  private async handleLine(line: string): Promise<void> {
    let message: JsonRpcMessage
    try {
      message = decodeAcpMessage(line)
    } catch {
      return
    }
    if ('method' in message) {
      if ('id' in message) {
        await this.handleRequest(message)
      } else {
        for (const listener of this.listeners) listener(message)
      }
      return
    }
    if (message.id === null) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if ('error' in message) {
      pending.reject(new AcpRequestError(message))
    } else {
      pending.resolve(message.result)
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.requestHandler) {
      await this.replyError(request.id, -32601, `未注册 ACP 请求处理器：${request.method}`)
      return
    }
    try {
      const result = await this.requestHandler(request)
      await this.transport.send(
        encodeAcpMessage({ jsonrpc: '2.0', id: request.id, result: result ?? null }),
      )
    } catch (error) {
      await this.replyError(
        request.id,
        -32603,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private replyError(id: JsonRpcId, code: number, message: string): Promise<void> {
    return this.transport.send(
      encodeAcpMessage({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      }),
    )
  }
}
