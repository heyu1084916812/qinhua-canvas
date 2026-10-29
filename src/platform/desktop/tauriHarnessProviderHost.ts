import type { UnlistenFn } from '@tauri-apps/api/event'
import type {
  HarnessLocalChatRequest,
  HarnessLocalProviderBridge,
} from '../../features/shared/agent/HarnessLocalProviderBridge'
import type { HarnessMcpToolBridge } from '../../features/shared/agent/HarnessMcpToolBridge'

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
  respond(
    requestId: string,
    status: number,
    body: string,
    contentType?: string,
  ): Promise<void>
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
  async respond(requestId, status, body, contentType) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<boolean>('acp_provider_respond', {
      requestId,
      status,
      body,
      ...(contentType ? { contentType } : {}),
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

function streamingCompletionBody(input: {
  request: HarnessLocalChatRequest
  text: string
  finishReason?: string
  toolCalls?: { id: string; name: string; args: string }[]
}): string {
  const base = {
    id: input.request.requestId,
    object: 'chat.completion.chunk',
    model: input.request.model,
  }
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`
  const parts = [chunk({ role: 'assistant' }, null)]
  if (input.text) parts.push(chunk({ content: input.text }, null))
  if (input.toolCalls?.length) {
    parts.push(
      chunk(
        {
          tool_calls: input.toolCalls.map((call, index) => ({
            index,
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.args },
          })),
        },
        null,
      ),
    )
  }
  parts.push(chunk({}, input.finishReason ?? 'stop'))
  parts.push('data: [DONE]\n\n')
  return parts.join('')
}

export async function startTauriHarnessProviderHost(input: {
  provider: HarnessLocalProviderBridge
  tools?: HarnessMcpToolBridge
  bridge?: TauriHarnessProviderBridge
}): Promise<{
  endpoint: ProviderEndpoint
  mcp?: {
    url: string
    headers: { Authorization: string }
  }
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
          const request = {
            ...body,
            requestId: event.requestId,
          }
          const result = await input.provider.complete(request)
          const responseBody = body.stream
            ? streamingCompletionBody({
                request,
                text: result.text,
                ...(result.finishReason
                  ? { finishReason: result.finishReason }
                  : {}),
                ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
              })
            : completionBody({
                request,
                text: result.text,
                ...(result.finishReason
                  ? { finishReason: result.finishReason }
                  : {}),
                ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
              })
          if (body.stream) {
            await bridge.respond(
              event.requestId,
              200,
              responseBody,
              'text/event-stream; charset=utf-8',
            )
          } else {
            await bridge.respond(event.requestId, 200, responseBody)
          }
          return
        }
        if (event.path === '/mcp' && input.tools) {
          const response = await input.tools.handle(JSON.parse(event.body))
          await bridge.respond(
            event.requestId,
            response ? 200 : 202,
            response ? JSON.stringify(response) : '',
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
    ...(input.tools
      ? {
          mcp: {
            url: `${endpoint.baseUrl}/mcp`,
            headers: { Authorization: `Bearer ${endpoint.token}` },
          },
        }
      : {}),
    async stop() {
      unlisten()
      await bridge.stop()
    },
  }
}
