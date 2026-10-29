export type JsonRpcId = string | number

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure

export function encodeAcpMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`
}

export function decodeAcpMessage(line: string): JsonRpcMessage {
  const value = JSON.parse(line) as Record<string, unknown>
  if (!value || typeof value !== 'object' || value.jsonrpc !== '2.0') {
    throw new Error('ACP 消息必须是 JSON-RPC 2.0 对象')
  }
  const hasMethod = typeof value.method === 'string' && value.method.length > 0
  const hasId = typeof value.id === 'string' || typeof value.id === 'number'
  if (hasMethod) {
    if (hasId) {
      return {
        jsonrpc: '2.0',
        id: value.id as JsonRpcId,
        method: String(value.method),
        ...('params' in value ? { params: value.params } : {}),
      }
    }
    return {
      jsonrpc: '2.0',
      method: String(value.method),
      ...('params' in value ? { params: value.params } : {}),
    }
  }
  if (!('id' in value)) throw new Error('ACP 消息缺少 id 或 method')
  if ('result' in value) {
    return {
      jsonrpc: '2.0',
      id: value.id as JsonRpcId,
      result: value.result,
    }
  }
  if (value.error && typeof value.error === 'object') {
    const error = value.error as Record<string, unknown>
    if (typeof error.code !== 'number' || typeof error.message !== 'string') {
      throw new Error('ACP 错误响应缺少 code 或 message')
    }
    return {
      jsonrpc: '2.0',
      id:
        value.id === null || typeof value.id === 'string' || typeof value.id === 'number'
          ? (value.id as JsonRpcId | null)
          : null,
      error: {
        code: error.code,
        message: error.message,
        ...('data' in error ? { data: error.data } : {}),
      },
    }
  }
  throw new Error('无法识别的 ACP JSON-RPC 消息')
}
