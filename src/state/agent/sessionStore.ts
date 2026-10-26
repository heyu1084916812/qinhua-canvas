import type { ChatMessage } from '../../domain/shared/execution/types'
import type { StoragePort, RowOf } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  enqueueAgentTurn,
  normalizeQueuedTurns,
  removeAgentTurn,
  takeNextAgentTurn,
  type QueuedAgentTurn,
} from '../../domain/agent/queuedTurn'

/**
 * Agent 会话存储（设计文档 §8 / §12）。
 *
 * 两条要求直接决定这份代码的形状：
 *
 * ① **会话绑定项目**（§8）：一个会话属于一张画布。列表按 `projectId` 过滤 ——
 *    「在 A 项目问 B 项目的画布」从查询条件上就不可能发生。
 * ② **记忆隔离**（§8.2）：历史与上下文分开。表里存**全部历史**（展示回溯用），
 *    而 `contextFor` 每次只从**这一个会话**的记录里取窗口 ——
 *    隔离靠「按会话 id 查」，不靠「记得清空」。后者一旦漏调，就会出现
 *    「它知道我没在这个会话里说过的事」，而那正是多会话最经典的 bug。
 */

export interface AgentSession {
  id: string
  /** 属于哪个项目（画布）。会话列表按它过滤 */
  projectId: string
  title: string
  /** 本会话用的渠道与模型（§8「每个会话可单独选模型」） */
  channelId: string
  /** 对话模型 = **agent 自己**跑的那个 LLM（用户 2026-10-03：「对话模型就是这个 agent 的 llm 模型」） */
  model: string
  /**
   * 用户点选的**图片 / 视频模型**（用户 2026-10-03：「我创作面板有什么模型就用什么模型，
   * 分了图片和视频…也就是说模型有三个选项」）。
   *
   * 它们不参与 agent 自己的推理，而是**建生成节点时用的配方**：计划里那个节点是
   * 文生图还是图生视频，就按对应这一类套上去（见 `modelForGenerated`）。
   */
  imageModel?: string
  videoModel?: string
  /**
   * 本会话启用的技能（设计文档 §14 M4）。
   *
   * 存 **id** 而不是正文快照：技能在技能库里可以随时改，存正文等于把那一刻冻结住，
   * 用户改完技能、老会话却还用旧版 —— 与画布节点上的 `skillId` 同一口径。
   */
  skillId?: string
  /**
   * **自动生成**（用户 2026-10-02：参考产品图一的「手动生成 / 自动生成」）。
   *
   * `false` / 缺省 = 手动：写与花钱的动作都停下等确认（设计文档 §9 的默认值，
   * **必须是默认** —— 默认自动花钱不是本项目愿意替用户做的决定）。
   * `true` = 自动：agent 请求执行 / 落地时不再打断，它自己往下跑。
   */
  autoRun?: boolean
  /**
   * **回读轮数**（用户 2026-10-14 参考产品图二：「回读这个抄一下」）。
   *
   * 发给模型的**上下文窗口**：只带最近 N 条消息。更早的仍留在库里（`messages`
   * 始终是全量，界面照常回看）—— 窗口只决定「这次问模型时它看得到多少」。
   * 不设 = `AGENT_CONTEXT_WINDOW`（20）。
   *
   * 为什么需要一道闸：Agent 每一轮都会往历史里追加工具结果，跑完一批节点之后
   * 单条 tool 消息可能非常大；窗口管的是「条数不无限增长」，
   * 单条的体积仍要靠别的办法（见 §4.3 的说明）。
   */
  contextWindow?: number
  /**
   * 用户随对话给出的素材（设计文档 §8「输入：文字 + 可选图片」）。
   *
   * 存的是**画布上的节点 id**，不是文件字节：素材一进来就落成画布上的节点
   * （复用既有的导入链路），这样 agent 能用 `attach` 复用同一条素材，
   * 而不是把图片塞进对话上下文里再让它猜。
   */
  pendingAssetIds?: string[]
  /**
   * 当前回合尚未结束时，用户继续提交的任务。
   *
   * 队列随会话落库，切走会话或关闭面板不会丢；任务真正开始时才取队首。
   */
  queuedTurns: QueuedAgentTurn[]
  /** **全部历史**（展示与回溯）。发给模型的是它的窗口，见 `contextFor` */
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 发给模型的上下文窗口：保留最近 N 条（设计文档 §4.3） */
export const AGENT_CONTEXT_WINDOW = 20

export interface AgentSessionStore {
  /** 列某个项目的会话（新的在前） */
  list(projectId: string): Promise<AgentSession[]>
  get(id: string): Promise<AgentSession | null>
  create(input: {
    projectId: string
    channelId: string
    /** 对话模型（agent 自己的 LLM） */
    model: string
    title?: string
    /** 建生成节点时默认用的图片 / 视频模型（用户 2026-10-03 的三档选择） */
    imageModel?: string
    videoModel?: string
    /** 新建会话时可直接带入的技能；仍保持单技能契约 */
    skillId?: string
  }): Promise<AgentSession>
  save(session: AgentSession): Promise<void>
  /**
   * 只更新历史消息。
   *
   * 回合执行期间用户可能继续入队；如果结束时拿开局那份旧 session 整行覆盖，
   * 后入队的任务会被悄悄抹掉。所有后台写回都走这里，只改自己拥有的字段。
   */
  saveMessages(id: string, messages: ChatMessage[]): Promise<AgentSession | null>
  clearPendingAssetIds(id: string, assetIds: readonly string[]): Promise<AgentSession | null>
  enqueueTurn(
    id: string,
    turn: QueuedAgentTurn,
  ): Promise<{ ok: true; session: AgentSession } | { ok: false; reason: 'missing' | 'empty' | 'full' }>
  removeQueuedTurn(id: string, turnId: string): Promise<AgentSession | null>
  takeNextQueuedTurn(id: string): Promise<{ session: AgentSession; turn: QueuedAgentTurn } | null>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  /**
   * 某个会话**此刻该发给模型的消息**。
   *
   * 只取这一个会话的，且按窗口截断 —— 这是「记忆隔离」在代码上的落点。
   */
  contextFor(id: string, window?: number): Promise<ChatMessage[]>
}

const asMessages = (v: unknown): ChatMessage[] => (Array.isArray(v) ? (v as ChatMessage[]) : [])

export function createAgentSessionStore(storage: StoragePort): AgentSessionStore {
  const toSession = (row: RowOf<'agentSessions'>): AgentSession => ({
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    title: String(row.title ?? '新对话'),
    channelId: String(row.channelId ?? ''),
    model: String(row.model ?? ''),
    ...(typeof row.imageModel === 'string' && row.imageModel ? { imageModel: row.imageModel } : {}),
    ...(typeof row.videoModel === 'string' && row.videoModel ? { videoModel: row.videoModel } : {}),
    ...(typeof row.skillId === 'string' && row.skillId ? { skillId: row.skillId } : {}),
    ...(row.autoRun === true ? { autoRun: true } : {}),
    ...(typeof row.contextWindow === 'number' && row.contextWindow > 0
      ? { contextWindow: row.contextWindow }
      : {}),
    ...(Array.isArray(row.pendingAssetIds) && row.pendingAssetIds.length > 0
      ? { pendingAssetIds: row.pendingAssetIds.filter((x): x is string => typeof x === 'string') }
      : {}),
    queuedTurns: normalizeQueuedTurns(row.queuedTurns),
    messages: asMessages(row.messages),
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  })

  const find = async (id: string): Promise<AgentSession | null> => {
    const rows = await storage.query('agentSessions', { id })
    return rows[0] ? toSession(rows[0]) : null
  }

  return {
    get: find,

    async list(projectId) {
      const rows = await storage.query('agentSessions', { projectId })
      return rows.map(toSession).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async create({ projectId, channelId, model, title, imageModel, videoModel, skillId }) {
      const now = Date.now()
      const session: AgentSession = {
        id: createId('chat'),
        projectId,
        title: title?.trim() || '新对话',
        channelId,
        model,
        ...(imageModel ? { imageModel } : {}),
        ...(videoModel ? { videoModel } : {}),
        ...(skillId ? { skillId } : {}),
        queuedTurns: [],
        messages: [],
        createdAt: now,
        updatedAt: now,
      }
      await storage.put('agentSessions', session as unknown as RowOf<'agentSessions'>)
      return session
    },

    async save(session) {
      await storage.put(
        'agentSessions',
        { ...session, updatedAt: Date.now() } as unknown as RowOf<'agentSessions'>,
      )
    },

    async saveMessages(id, messages) {
      const latest = await find(id)
      if (!latest) return null
      const next = { ...latest, messages, updatedAt: Date.now() }
      await storage.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
      return next
    },

    async clearPendingAssetIds(id, assetIds) {
      const latest = await find(id)
      if (!latest) return null
      const sent = new Set(assetIds)
      const pending = (latest.pendingAssetIds ?? []).filter((assetId) => !sent.has(assetId))
      const next = {
        ...latest,
        ...(pending.length > 0 ? { pendingAssetIds: pending } : { pendingAssetIds: undefined }),
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
      return next
    },

    async enqueueTurn(id, turn) {
      const latest = await find(id)
      if (!latest) return { ok: false, reason: 'missing' }
      const queued = enqueueAgentTurn(latest.queuedTurns, turn)
      if (!queued.ok) return { ok: false, reason: queued.reason }
      const next = { ...latest, queuedTurns: queued.turns, updatedAt: Date.now() }
      await storage.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
      return { ok: true, session: next }
    },

    async removeQueuedTurn(id, turnId) {
      const latest = await find(id)
      if (!latest) return null
      const next = {
        ...latest,
        queuedTurns: removeAgentTurn(latest.queuedTurns, turnId),
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
      return next
    },

    async takeNextQueuedTurn(id) {
      const latest = await find(id)
      if (!latest) return null
      const next = takeNextAgentTurn(latest.queuedTurns)
      if (!next.turn) return null
      const session = { ...latest, queuedTurns: next.turns, updatedAt: Date.now() }
      await storage.put('agentSessions', session as unknown as RowOf<'agentSessions'>)
      return { session, turn: next.turn }
    },

    async rename(id, title) {
      const s = await find(id)
      if (!s) return
      await storage.put(
        'agentSessions',
        { ...s, title: title.trim() || s.title, updatedAt: Date.now() } as unknown as RowOf<'agentSessions'>,
      )
    },

    async remove(id) {
      await storage.delete('agentSessions', id)
    },

    async contextFor(id, window = AGENT_CONTEXT_WINDOW) {
      const s = await find(id)
      if (!s) return []
      // 窗口从**尾部**取：最近说的话最要紧（§4.3）
      return s.messages.slice(Math.max(0, s.messages.length - window))
    },
  }
}
