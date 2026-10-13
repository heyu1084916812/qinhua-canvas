/**
 * JSON 工具调用降级解析（Agent 设计文档 §7 路线 B）。
 *
 * 有些对话渠道不返回 OpenAI 的 `tool_calls`，但模型可以按提示词输出 JSON。
 * 这里只做**确定性解析**，不猜语义：
 * - `{"tool":"applyPlan","args":{...}}`
 * - `{"name":"applyPlan","arguments":{...}}`
 * - 裸的 applyPlan 对象（有 nodes + edges）
 * - ```json fenced code block
 * 解析不出来就返回 null，由上层如实拒绝。
 */
export interface JsonAgentAction {
  name: string
  args: unknown
}

export function parseJsonAgentAction(text: string): JsonAgentAction | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const candidates: string[] = []
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) candidates.push(fence[1].trim())
  candidates.push(trimmed)
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))

  for (const raw of candidates) {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const row = value as Record<string, unknown>

    if (typeof row.tool === 'string' && row.tool) {
      return { name: row.tool, args: row.args ?? {} }
    }
    if (typeof row.name === 'string' && row.name) {
      return { name: row.name, args: row.args ?? row.arguments ?? {} }
    }
    if (Array.isArray(row.nodes) && (row.edges === undefined || Array.isArray(row.edges))) {
      return { name: 'applyPlan', args: row }
    }
  }
  return null
}
