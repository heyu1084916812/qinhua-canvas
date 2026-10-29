import type { JsonRpcRequest } from '../../features/shared/agent/HarnessAcpProtocol'
import { HarnessAcpClient } from '../../features/shared/agent/HarnessAcpClient'
import type { HarnessRuntimeEvent } from '../../features/shared/agent/HarnessAcpEvents'
import type {
  HarnessLocalProviderBridge,
} from '../../features/shared/agent/HarnessLocalProviderBridge'
import {
  createHarnessMcpToolBridge,
  type HarnessMcpToolCall,
} from '../../features/shared/agent/HarnessMcpToolBridge'
import {
  createHarnessRuntimePort,
  type HarnessRuntimeClient,
  type HarnessRuntimePort,
} from '../../features/shared/agent/HarnessRuntimePort'
import type { ToolDeclaration } from '../../domain/shared/execution/types'
import { createTauriAcpTransport } from './tauriAcpTransport'
import {
  startTauriHarnessProviderHost,
} from './tauriHarnessProviderHost'

export interface TauriHarnessSessionRuntime {
  sessionId: string
  clientSessionId: string
  prompt(text: string): Promise<unknown>
  cancel(): Promise<void>
  close(): Promise<void>
}

export interface OpenTauriHarnessSessionInput {
  sessionId: string
  cwd: string
  resume?: boolean
  provider: HarnessLocalProviderBridge
  tools: readonly ToolDeclaration[]
  executeTool(call: HarnessMcpToolCall): Promise<unknown>
  onEvent(event: HarnessRuntimeEvent): void
  onPermission?: (request: JsonRpcRequest) => Promise<unknown> | unknown
}

interface HarnessSessionRuntimeFactories {
  startProviderHost?: typeof startTauriHarnessProviderHost
  createRuntime?: (
    createClient: (input: {
      sessionId: string
      cwd: string
      provider?: { url: string; token: string }
    }) => HarnessRuntimeClient,
    onPermission?: (request: JsonRpcRequest) => Promise<unknown> | unknown,
  ) => HarnessRuntimePort
}

export async function openTauriHarnessSession(
  input: OpenTauriHarnessSessionInput,
  factories: HarnessSessionRuntimeFactories = {},
): Promise<TauriHarnessSessionRuntime> {
  const providerId = `provider-${input.sessionId}`
  const mcpBridge = createHarnessMcpToolBridge({
    tools: input.tools,
    execute: input.executeTool,
    serverName: 'qinghua-canvas',
    serverVersion: '1.0.0',
  })
  const startProviderHost =
    factories.startProviderHost ?? startTauriHarnessProviderHost
  const providerHost = await startProviderHost({
    providerId,
    provider: input.provider,
    tools: mcpBridge,
  })
  const createRuntime =
    factories.createRuntime ??
    ((createClient, onPermission) =>
      createHarnessRuntimePort({
        createClient,
        ...(onPermission ? { onPermission } : {}),
      }))
  const runtime = createRuntime(
    (clientInput) =>
      new HarnessAcpClient(
        createTauriAcpTransport({
          sessionId: clientInput.sessionId,
          cwd: clientInput.cwd,
          ...(clientInput.provider ? { provider: clientInput.provider } : {}),
        }),
      ),
    input.onPermission,
  )
  const unsubscribe = runtime.onEvent(input.onEvent)

  try {
    const session = await runtime.open({
      sessionId: input.sessionId,
      cwd: input.cwd,
      ...(input.resume ? { resume: true } : {}),
      provider: {
        url: providerHost.endpoint.baseUrl,
        token: providerHost.endpoint.token,
      },
      mcpServers: providerHost.mcp ? [providerHost.mcp] : [],
      ...(input.onPermission ? { onPermission: input.onPermission } : {}),
    })
    let closed = false
    return {
      sessionId: session.sessionId,
      clientSessionId: session.clientSessionId,
      prompt(text) {
        return runtime.prompt(session.sessionId, text)
      },
      cancel() {
        return runtime.cancel(session.sessionId)
      },
      async close() {
        if (closed) return
        closed = true
        unsubscribe()
        await runtime.close(session.sessionId).catch(() => null)
        await providerHost.stop().catch(() => null)
      },
    }
  } catch (error) {
    unsubscribe()
    await providerHost.stop().catch(() => null)
    throw error
  }
}
