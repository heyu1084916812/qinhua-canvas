import type { ChatMessage } from '../../../domain/shared/execution/types'

/**
 * 上下文窗口的安全裁剪。
 *
 * 窗口按消息条数从尾部截取时，可能正好从一段工具调用中间开始：
 * `assistant(tool_calls)` 被截到窗口外，只剩后面的 `tool` 结果。
 * OpenAI 形状里 tool 结果必须跟一条发起它的 assistant 调用配对；Gemini 网关
 * 转成 `function_response` 时还会直接报 `name` 缺失。
 *
 * 这里只做一件事：**丢掉没有对应 assistant tool_call 的孤儿 tool 消息**。
 * 全量历史不改，界面与落库仍保留它；只有这一次发给模型的窗口变干净。
 */
export function trimOrphanToolMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const callIds = new Set<string>()
  const out: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (call.id) callIds.add(call.id)
      }
    }
    if (message.role === 'tool' && (!message.toolCallId || !callIds.has(message.toolCallId))) {
      continue
    }
    out.push(message)
  }
  return out
}
