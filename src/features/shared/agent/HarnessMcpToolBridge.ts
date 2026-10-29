import {
  isAgentToolName,
  type AgentToolName,
} from '../../../domain/agent/toolRegistry'
import type { ToolDeclaration } from '../../../domain/shared/execution/types'

type JsonRpcId = string | number

export interface McpJsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface McpJsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface McpJsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type McpJsonRpcResponse = McpJsonRpcSuccess | McpJsonRpcFailure

export interface HarnessMcpToolBridge {
  handle(request: unknown): Promise<McpJsonRpcResponse | null>
}

export interface HarnessMcpToolCall {
  name: AgentToolName
  args: unknown
  callId: string
}

const PROTOCOL_VERSION = '2025-03-26'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requestOf(value: unknown): McpJsonRpcRequest | null {
  if (!isRecord(value) || value.jsonrpc !== '2.0') return null
  if (typeof value.method !== 'string' || !value.method.trim()) return null
  if (
    'id' in value &&
    typeof value.id !== 'string' &&
    typeof value.id !== 'number'
  ) {
    return null
  }
  return value as unknown as McpJsonRpcRequest
}

function toolResult(value: unknown): Record<string, unknown> {
  const text =
    typeof value === 'string'
      ? value
      : value === undefined
        ? 'null'
        : JSON.stringify(value)
  return {
    content: [{ type: 'text', text }],
    isError: false,
  }
}

function toolFailure(error: unknown): Record<string, unknown> {
  return {
    content: [
      {
        type: 'text',
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  }
}

function callIdOf(params: Record<string, unknown>, fallback: string): string {
  const meta = isRecord(params._meta) ? params._meta : {}
  const value = meta['qinghua/toolCallId'] ?? meta.toolCallId ?? params.toolCallId
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * Minimal MCP tools bridge. The transport is deliberately outside this module:
 * ACP may connect through stdio or loopback HTTP without changing tool semantics.
 */
export function createHarnessMcpToolBridge(input: {
  tools: readonly ToolDeclaration[]
  execute: (call: HarnessMcpToolCall) => Promise<unknown>
  serverName?: string
  serverVersion?: string
}): HarnessMcpToolBridge {
  const tools = new Map<string, ToolDeclaration>()
  for (const tool of input.tools) {
    if (!isAgentToolName(tool.name)) {
      throw new Error(`Harness MCP 不能暴露未登记工具：${tool.name}`)
    }
    if (tools.has(tool.name)) {
      throw new Error(`Harness MCP 工具重复登记：${tool.name}`)
    }
    tools.set(tool.name, tool)
  }
  let nextCall = 1

  return {
    async handle(raw) {
      const request = requestOf(raw)
      if (!request) {
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid JSON-RPC request' },
        }
      }
      if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') {
        return null
      }
      if (request.id === undefined) return null

      const success = (result: unknown): McpJsonRpcSuccess => ({
        jsonrpc: '2.0',
        id: request.id!,
        result,
      })
      const failure = (code: number, message: string): McpJsonRpcFailure => ({
        jsonrpc: '2.0',
        id: request.id!,
        error: { code, message },
      })

      if (request.method === 'initialize') {
        return success({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: input.serverName ?? 'qinghua-canvas',
            version: input.serverVersion ?? '1.0.0',
          },
        })
      }
      if (request.method === 'ping') return success({})
      if (request.method === 'tools/list') {
        return success({
          tools: [...tools.values()].map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.parameters,
          })),
        })
      }
      if (request.method !== 'tools/call') {
        return failure(-32601, `Method not found: ${request.method}`)
      }

      const params = isRecord(request.params) ? request.params : {}
      const name = typeof params.name === 'string' ? params.name : ''
      if (!isAgentToolName(name) || !tools.has(name)) {
        return success(
          toolFailure(new Error(`未登记或当前不可用的工具：${name || '(empty)'}`)),
        )
      }
      const callId = callIdOf(params, `mcp-${nextCall++}`)
      try {
        const result = await input.execute({
          name,
          args: params.arguments ?? {},
          callId,
        })
        return success(toolResult(result))
      } catch (error) {
        return success(toolFailure(error))
      }
    },
  }
}
