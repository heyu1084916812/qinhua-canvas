import type { JsonRpcNotification } from './HarnessAcpProtocol'

export type HarnessRuntimeEvent =
  | { kind: 'thought'; sessionId: string; messageId?: string; text: string }
  | { kind: 'message'; sessionId: string; messageId?: string; content: unknown }
  | {
      kind: 'toolCall'
      sessionId: string
      toolCallId: string
      title: string
      status: string
      input?: unknown
    }
  | {
      kind: 'toolUpdate'
      sessionId: string
      toolCallId: string
      status: string
      content?: unknown
    }
  | { kind: 'usage'; sessionId: string; used: number; size: number }
  | { kind: 'unknown'; sessionId: string; update: unknown }

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

export function harnessEventsFromAcpNotification(
  notification: JsonRpcNotification,
): readonly HarnessRuntimeEvent[] {
  if (notification.method !== 'session/update') return []
  const params = objectOf(notification.params)
  const sessionId =
    typeof params?.sessionId === 'string' ? params.sessionId : ''
  if (!sessionId) return []
  const update = objectOf(params?.update)
  const sessionUpdate =
    typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : ''
  if (sessionUpdate === 'agent_thought_chunk') {
    const content = objectOf(update?.content)
    return [
      {
        kind: 'thought',
        sessionId,
        ...(typeof update?.messageId === 'string'
          ? { messageId: update.messageId }
          : {}),
        text: typeof content?.text === 'string' ? content.text : '',
      },
    ]
  }
  if (sessionUpdate === 'agent_message_chunk') {
    return [
      {
        kind: 'message',
        sessionId,
        ...(typeof update?.messageId === 'string'
          ? { messageId: update.messageId }
          : {}),
        content: update?.content,
      },
    ]
  }
  if (sessionUpdate === 'tool_call') {
    return [
      {
        kind: 'toolCall',
        sessionId,
        toolCallId:
          typeof update?.toolCallId === 'string' ? update.toolCallId : '',
        title: typeof update?.title === 'string' ? update.title : '工具调用',
        status: typeof update?.status === 'string' ? update.status : 'in_progress',
        ...('rawInput' in (update ?? {}) ? { input: update?.rawInput } : {}),
      },
    ]
  }
  if (sessionUpdate === 'tool_call_update') {
    return [
      {
        kind: 'toolUpdate',
        sessionId,
        toolCallId:
          typeof update?.toolCallId === 'string' ? update.toolCallId : '',
        status: typeof update?.status === 'string' ? update.status : 'completed',
        ...('content' in (update ?? {}) ? { content: update?.content } : {}),
      },
    ]
  }
  if (sessionUpdate === 'usage_update') {
    return [
      {
        kind: 'usage',
        sessionId,
        used: typeof update?.used === 'number' ? update.used : 0,
        size: typeof update?.size === 'number' ? update.size : 0,
      },
    ]
  }
  return [{ kind: 'unknown', sessionId, update }]
}
