import type { ChatMessage } from '../../domain/shared/execution/types'
import type { StoragePort, RowOf } from '../../platform/ports'
import { createId } from '../../shared/id'

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
  model: string
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
  create(input: { projectId: string; channelId: string; model: string; title?: string }): Promise<AgentSession>
  save(session: AgentSession): Promise<void>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  /** 删项目时连带删它的会话（会话脱离项目没有意义） */
  removeByProject(projectId: string): Promise<void>
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
    messages: asMessages(row.messages),
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  })

  const find = async (id: string): Promise<AgentSession | null> => {
    const rows = await storage.query('agentSessions', { id })
    return rows[0] ? toSession(rows[0]) : null
  }

  return {
    async list(projectId) {
      const rows = await storage.query('agentSessions', { projectId })
      return rows.map(toSession).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async create({ projectId, channelId, model, title }) {
      const now = Date.now()
      const session: AgentSession = {
        id: createId('chat'),
        projectId,
        title: title?.trim() || '新对话',
        channelId,
        model,
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

    async removeByProject(projectId) {
      const rows = await storage.query('agentSessions', { projectId })
      for (const row of rows) await storage.delete('agentSessions', String(row.id))
    },

    async contextFor(id, window = AGENT_CONTEXT_WINDOW) {
      const s = await find(id)
      if (!s) return []
      // 窗口从**尾部**取：最近说的话最要紧（§4.3）
      return s.messages.slice(Math.max(0, s.messages.length - window))
    },
  }
}
