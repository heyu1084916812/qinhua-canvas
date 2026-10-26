/**
 * Agent 会话里的待执行回合。
 *
 * 任务在入队时冻结模型、技能和附件引用。之后用户改面板设置，只影响下一次
 * 新任务，不会悄悄改变已经排在队里的任务。
 */
export interface QueuedAgentTurn {
  id: string
  text: string
  createdAt: number
  channelId: string
  model: string
  imageModel?: string
  videoModel?: string
  skillId?: string
  autoRun?: boolean
  pendingAssetIds?: string[]
}

export const AGENT_QUEUE_LIMIT = 20

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** 旧会话没有这个字段；损坏的条目丢弃，不让一条坏行拖垮整个队列。 */
export function normalizeQueuedTurns(value: unknown): QueuedAgentTurn[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item): QueuedAgentTurn[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const id = nonEmptyString(row.id)
    const text = nonEmptyString(row.text)?.trim() ?? null
    const model = nonEmptyString(row.model)
    if (!id || !text || !model || seen.has(id)) return []
    seen.add(id)
    const channelId = typeof row.channelId === 'string' ? row.channelId : ''
    const imageModel = nonEmptyString(row.imageModel)
    const videoModel = nonEmptyString(row.videoModel)
    const skillId = nonEmptyString(row.skillId)
    const pendingAssetIds = Array.isArray(row.pendingAssetIds)
      ? [...new Set(row.pendingAssetIds.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))]
      : []
    return [{
      id,
      text,
      createdAt: typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
        ? row.createdAt
        : 0,
      channelId,
      model,
      ...(imageModel ? { imageModel } : {}),
      ...(videoModel ? { videoModel } : {}),
      ...(skillId ? { skillId } : {}),
      ...(row.autoRun === true ? { autoRun: true } : {}),
      ...(pendingAssetIds.length > 0 ? { pendingAssetIds } : {}),
    }]
  }).slice(0, AGENT_QUEUE_LIMIT)
}

export type EnqueueAgentTurnResult =
  | { ok: true; turns: QueuedAgentTurn[] }
  | { ok: false; reason: 'empty' | 'full'; turns: QueuedAgentTurn[] }

export function enqueueAgentTurn(
  current: readonly QueuedAgentTurn[] | undefined,
  turn: QueuedAgentTurn,
): EnqueueAgentTurnResult {
  const turns = normalizeQueuedTurns(current)
  if (!turn.text.trim()) return { ok: false, reason: 'empty', turns }
  if (turns.length >= AGENT_QUEUE_LIMIT) return { ok: false, reason: 'full', turns }
  return { ok: true, turns: [...turns, { ...turn, text: turn.text.trim() }] }
}

export function removeAgentTurn(
  current: readonly QueuedAgentTurn[] | undefined,
  turnId: string,
): QueuedAgentTurn[] {
  return normalizeQueuedTurns(current).filter((turn) => turn.id !== turnId)
}

export function takeNextAgentTurn(
  current: readonly QueuedAgentTurn[] | undefined,
): { turn: QueuedAgentTurn | null; turns: QueuedAgentTurn[] } {
  const turns = normalizeQueuedTurns(current)
  const [turn, ...rest] = turns
  return { turn: turn ?? null, turns: rest }
}

/**
 * 队列任务要按入队时冻结的设置执行，而不是沿用用户此刻在面板里新选的设置。
 * `messages` 仍取会话最新值，待执行任务本身不会提前进入模型上下文。
 */
export function sessionForQueuedTurn<T extends {
  channelId: string
  model: string
  imageModel?: string
  videoModel?: string
  skillId?: string
  autoRun?: boolean
  pendingAssetIds?: string[]
}>(session: T, turn: QueuedAgentTurn): T {
  return {
    ...session,
    channelId: turn.channelId,
    model: turn.model,
    ...(turn.imageModel ? { imageModel: turn.imageModel } : { imageModel: undefined }),
    ...(turn.videoModel ? { videoModel: turn.videoModel } : { videoModel: undefined }),
    ...(turn.skillId ? { skillId: turn.skillId } : { skillId: undefined }),
    ...(turn.autoRun === true ? { autoRun: true } : { autoRun: false }),
    ...(turn.pendingAssetIds?.length
      ? { pendingAssetIds: [...turn.pendingAssetIds] }
      : { pendingAssetIds: [] }),
  } as T
}

/** 队列项在 UI 上显示的安全短文本；不把内部 mention token 原样露出来。 */
export function queuedTurnPreview(text: string, max = 80): string {
  const plain = text
    .replace(/@\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}
