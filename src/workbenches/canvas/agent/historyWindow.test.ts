import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import { trimOrphanToolMessages } from './historyWindow'

describe('trimOrphanToolMessages', () => {
  it('窗口从 tool 结果中间开始时，丢掉前面的孤儿结果', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', toolCallId: 'call_hidden', toolName: 'readGraph', content: '{"ok":true}' },
      { role: 'user', content: '继续' },
    ]
    expect(trimOrphanToolMessages(messages)).toEqual([
      { role: 'user', content: '继续' },
    ])
  })

  it('窗口从 assistant 工具调用开始时整段丢掉，等当前用户回合重新起头', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'readGraph', args: '{}' }],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'readGraph', content: '{"ok":true}' },
      { role: 'assistant', content: '看完了' },
    ]
    expect(trimOrphanToolMessages(messages)).toEqual([])
  })

  it('从完整 user 回合开始后，后续工具调用和结果原样保留', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '检查画布' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'readGraph', args: '{}' }],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'readGraph', content: '{"ok":true}' },
      { role: 'assistant', content: '看完了' },
    ]
    expect(trimOrphanToolMessages(messages)).toEqual(messages)
  })

  it('tool 自带 name 但没有发起调用也丢掉：名字不能替代配对关系', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', toolCallId: 'ghost', toolName: 'readGraph', content: '{}' },
      { role: 'user', content: 'hi' },
    ]
    expect(trimOrphanToolMessages(messages)).toEqual([
      { role: 'user', content: 'hi' },
    ])
  })
})
