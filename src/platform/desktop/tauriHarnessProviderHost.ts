import type { UnlistenFn } from '@tauri-apps/api/event'
import type {
  HarnessLocalChatRequest,
  HarnessLocalProviderBridge,
} from '../../features/shared/agent/HarnessLocalProviderBridge'

interface ProviderRequestEvent {
  requestId: string
  method: string
  path: string
  body: string
}

interface ProviderEndpoint {
  baseUrl: string
  token: string
}

export interface TauriHarnessProviderBridge {
  start(): Promise<ProviderEndpoint>
  stop(): Promise<void>
  respond(requestId: string, status: number, body: string): Promise<void>
  listen(handler: (event: ProviderRequestEvent) => void): Promise<UnlistenFn>
}

export const defaultTauriHarnessProviderBridge: TauriHarnessProviderBridge = {
  async start() {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ProviderEndpoint>('acp_provider_start')
  },
  async stop() {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<boolean>('acp_provider_stop')
  },
  async respond(requestId, status, body) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<boolean>('acp_provider_respond', {
      requestId,
      status,
      body,
    })
  },
  async listen(handler) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<ProviderRequestEvent>('acp:provider-request', (event) =>
      handler(event.payload),
    )
  },
}

function completionBody(input: {
  request: HarnessLocalChatRequest
  text: string
  finishReason?: string
  toolCalls?: { id: string; name: string; args: string }[]
}): string {
  return JSON.stringify({
    id: input.request.requestId,
    object: 'chat.completion',
    model: input.request.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: input.text,
          ...(input.toolCalls?.length
            ? {
                tool_calls: input.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: {
                    name: call.name,
                    arguments: call.args,
                  },
                })),
              }
            : {}),
        },
        finish_reason: input.finishReason ?? 'stop',
      },
    ],
  })
}

export async function startTauriHarnessProviderHost(input: {
  provider: HarnessLocalProviderBridge
  bridge?: TauriHarnessProviderBridge
}): Promise<{
  endpoint: ProviderEndpoint
  stop: () => Promise<void>
}> {
  const bridge = input.bridge ?? defaultTauriHarnessProviderBridge
  const endpoint = await bridge.start()
  const unlisten = await bridge.listen((event) => {
    void (async () => {
      try {
        if (event.path === '/v1/models') {
          await bridge.respond(
            event.requestId,
            200,
            JSON.stringify({
              object: 'list',
              data: (await input.provider.listModels()).map((id) => ({
                id,
                object: 'model',
              })),
            }),
          )
          return
        }
        if (event.path === '/v1/chat/completions') {
          const body = JSON.parse(event.body) as Omit<
            HarnessLocalChatRequest,
            'requestId'
          >
          const result = await input.provider.complete({
            ...body,
            requestId: event.requestId,
          })
          await bridge.respond(
            event.requestId,
            200,
            completionBody({
              request: { ...body, requestId: event.requestId },
              text: result.text,
              ...(result.finishReason
                ? { finishReason: result.finishReason }
                : {}),
              ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
            }),
          )
          return
        }
        await bridge.respond(
          event.requestId,
          404,
          JSON.stringify({ error: { message: 'not found' } }),
        )
      } catch (error) {
        await bridge.respond(
          event.requestId,
          500,
          JSON.stringify({
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        )
      }
    })()
  })
  return {
    endpoint,
    async stop() {
      unlisten()
      await bridge.stop()
    },
  }
}
