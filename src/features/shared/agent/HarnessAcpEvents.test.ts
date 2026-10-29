import { describe, expect, it } from 'vitest'
import { harnessEventsFromAcpNotification } from './HarnessAcpEvents'

describe('Harness ACP event adapter', () => {
  it('maps thought, message, tool and usage updates', () => {
    expect(
      harnessEventsFromAcpNotification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 's1',
          update: {
            sessionUpdate: 'agent_thought_chunk',
            messageId: 'm1',
            content: { type: 'text', text: '分析' },
          },
        },
      }),
    ).toEqual([
      { kind: 'thought', sessionId: 's1', messageId: 'm1', text: '分析' },
    ])
    expect(
      harnessEventsFromAcpNotification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 's1',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call-1',
            title: 'readGraph',
            status: 'in_progress',
            rawInput: { scope: 'all' },
          },
        },
      }),
    ).toEqual([
      {
        kind: 'toolCall',
        sessionId: 's1',
        toolCallId: 'call-1',
        title: 'readGraph',
        status: 'in_progress',
        input: { scope: 'all' },
      },
    ])
    expect(
      harnessEventsFromAcpNotification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 's1',
          update: { sessionUpdate: 'usage_update', used: 120, size: 1000 },
        },
      }),
    ).toEqual([{ kind: 'usage', sessionId: 's1', used: 120, size: 1000 }])
  })

  it('keeps unknown updates instead of silently dropping them', () => {
    expect(
      harnessEventsFromAcpNotification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 's1',
          update: { sessionUpdate: 'future_update', value: 1 },
        },
      }),
    ).toEqual([
      {
        kind: 'unknown',
        sessionId: 's1',
        update: { sessionUpdate: 'future_update', value: 1 },
      },
    ])
  })
})
