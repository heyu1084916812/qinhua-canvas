import type { StreamChunk } from './ports'

/**
 * SSE 解析：web 与 memory 两个实现共用，便于脱离浏览器测试。
 * 协议：每行 `data: <payload>`；`[DONE]` 表示结束。
 * payload 为 JSON 且含 type 字段时按 StreamChunk 解析，否则当作一段 delta 文本。
 */
export function parseSSELine(line: string): StreamChunk | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  if (!trimmed.startsWith('data:')) return null

  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return { type: 'done' }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    if (typeof parsed.type === 'string') {
      return {
        type: parsed.type as StreamChunk['type'],
        ...(typeof parsed.text === 'string' ? { text: parsed.text } : {}),
        ...(parsed.toolCall ? { toolCall: parsed.toolCall as StreamChunk['toolCall'] } : {}),
      }
    }
    return { type: 'delta', text: payload }
  } catch {
    return { type: 'delta', text: payload }
  }
}

/** 把可能跨 chunk 截断的字节流切成完整行 */
export function createLineSplitter(): (chunk: string) => string[] {
  let buffer = ''
  return (chunk: string): string[] => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    return lines
  }
}
