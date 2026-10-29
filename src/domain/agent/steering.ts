import type { ChatMessage } from '../shared/execution/types'

/**
 * 运行中引导不会启动第二个回合，只会在下一次模型调用前插入当前回合。
 * 条目冻结正文与图片节点引用，避免用户发送后继续改输入框影响已提交内容。
 */
export interface AgentSteer {
  id: string
  text: string
  createdAt: number
  imageNodeIds?: string[]
}

export const AGENT_STEER_LIMIT = 20

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeAgentSteers(value: unknown): AgentSteer[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .flatMap((item): AgentSteer[] => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const id = nonEmptyString(row.id)
      const text = nonEmptyString(row.text)
      if (!id || !text || seen.has(id)) return []
      seen.add(id)
      const imageNodeIds = Array.isArray(row.imageNodeIds)
        ? [
            ...new Set(
              row.imageNodeIds.filter(
                (nodeId): nodeId is string =>
                  typeof nodeId === 'string' && nodeId.trim() !== '',
              ),
            ),
          ]
        : []
      return [
        {
          id,
          text,
          createdAt:
            typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
              ? Math.max(0, row.createdAt)
              : 0,
          ...(imageNodeIds.length > 0 ? { imageNodeIds } : {}),
        },
      ]
    })
    .slice(0, AGENT_STEER_LIMIT)
}

export function enqueueAgentSteer(
  current: readonly AgentSteer[] | undefined,
  steer: AgentSteer,
):
  | { ok: true; steers: AgentSteer[] }
  | { ok: false; reason: 'empty' | 'full'; steers: AgentSteer[] } {
  const steers = normalizeAgentSteers(current)
  const text = steer.text.trim()
  if (!text) return { ok: false, reason: 'empty', steers }
  if (steers.length >= AGENT_STEER_LIMIT) {
    return { ok: false, reason: 'full', steers }
  }
  return {
    ok: true,
    steers: [...steers, { ...steer, text }],
  }
}

export function removeAgentSteers(
  current: readonly AgentSteer[] | undefined,
  steerIds: readonly string[],
): AgentSteer[] {
  const removed = new Set(steerIds)
  return normalizeAgentSteers(current).filter((steer) => !removed.has(steer.id))
}

export function steerMessagesOf(
  steers: readonly AgentSteer[],
  stripMarkup: (text: string) => string,
): ChatMessage[] {
  return steers.map((steer) => ({
    role: 'user',
    content: stripMarkup(steer.text),
    display: steer.text,
    createdAt: steer.createdAt,
    ...(steer.imageNodeIds?.length
      ? { imageNodeIds: [...steer.imageNodeIds] }
      : {}),
  }))
}
