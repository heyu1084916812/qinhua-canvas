import type { ChatMessage } from '../../domain/shared/execution/types'
import type { StoragePort, RowOf } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  enqueueAgentTurn,
  normalizeQueuedTurns,
  removeAgentTurn,
  takeNextAgentTurn,
  updateAgentTurnText,
  type QueuedAgentTurn,
} from '../../domain/agent/queuedTurn'
import {
  enqueueAgentSteer,
  normalizeAgentSteers,
  removeAgentSteers,
  type AgentSteer,
} from '../../domain/agent/steering'
import {
  normalizeStoredTaskPlan,
  type AgentTaskPlan,
} from '../../domain/agent/taskPlan'
import { confirmationSettlementMessages } from '../../domain/agent/confirmation'

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
  /** 已被队列泵领取、尚未最终完成的队首任务。 */
  activeTurnId?: string
  activeTurnStartedAt?: number
  /** 当前运行回合尚未送入模型上下文、或尚未完成写回的引导消息。 */
  pendingSteers: AgentSteer[]
  /** 重启后仍需恢复的确认卡。工具参数只存结构副本，不存执行结果。 */
  pendingConfirmation?: {
    callId: string
    name: string
    args: unknown
  }
  /** 当前会话最近一次获批的多阶段执行计划。 */
  taskPlan?: AgentTaskPlan
  /**
   * 可继续的长任务检查点。
   *
   * 消息与工具结果已经保存在 `messages`；这里只标记“上一段是安全暂停，不是失败”，
   * 页面重载后仍显示继续按钮，且继续时不会重新发起已完成的工具调用。
   */
  continuation?: {
    reason: 'max_steps'
    maxSteps: number
    createdAt: number
    /** 暂停任务来自队列时，保留原队列项 id。 */
    queuedTurnId?: string
  }
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
  /** 字段级更新；不会用 UI 的旧快照覆盖消息或队列。 */
  updateFields(
    id: string,
    patch: Partial<Omit<AgentSession, 'id' | 'projectId' | 'messages' | 'queuedTurns' | 'createdAt'>>,
  ): Promise<AgentSession | null>
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
  updateQueuedTurnText(
    id: string,
    turnId: string,
    text: string,
  ): Promise<AgentSession | null>
  promoteQueuedTurnToSteer(
    id: string,
    turnId: string,
    steerId: string,
  ): Promise<
    | { ok: true; session: AgentSession }
    | {
        ok: false
        reason: 'missing' | 'has_assets' | 'steer_full' | 'awaiting_confirmation'
      }
  >
  /**
   * 修复旧版本留下的坏状态：确认卡与待发送引导同时存在。
   *
   * 引导被转成普通排队项，确认调用补一条 canceled 工具结果后清除；
   * 返回 null 表示这条会话本来就不需要修复。
   */
  repairConfirmationSteerCollision(id: string): Promise<AgentSession | null>
  enqueueSteer(
    id: string,
    steer: AgentSteer,
  ): Promise<
    | { ok: true; session: AgentSession }
    | { ok: false; reason: 'missing' | 'empty' | 'full' }
  >
  removeSteers(id: string, steerIds: readonly string[]): Promise<AgentSession | null>
  /** 原子领取队首；任务仍留在队列，避免进程在启动前丢任务。 */
  claimNextQueuedTurn(id: string): Promise<{ session: AgentSession; turn: QueuedAgentTurn } | null>
  /** 结束已领取任务；完成时移出队列，失败 / 中断时保留供手动继续。 */
  finishActiveQueuedTurn(
    id: string,
    turnId: string,
    completed: boolean,
  ): Promise<AgentSession | null>
  /** 恢复时清掉进程中断留下的活动标记，不删除队列任务。 */
  releaseActiveTurn(id: string): Promise<AgentSession | null>
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
  const toSession = (row: RowOf<'agentSessions'>): AgentSession => {
    const taskPlan = normalizeStoredTaskPlan(row.taskPlan)
    return {
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
    pendingSteers: normalizeAgentSteers(row.pendingSteers),
    ...(typeof row.activeTurnId === 'string' && row.activeTurnId
      ? { activeTurnId: row.activeTurnId }
      : {}),
    ...(typeof row.activeTurnStartedAt === 'number' && row.activeTurnStartedAt > 0
      ? { activeTurnStartedAt: row.activeTurnStartedAt }
      : {}),
    ...(row.pendingConfirmation &&
    typeof row.pendingConfirmation === 'object' &&
    typeof (row.pendingConfirmation as { callId?: unknown }).callId === 'string' &&
    typeof (row.pendingConfirmation as { name?: unknown }).name === 'string'
      ? {
          pendingConfirmation: {
            callId: String((row.pendingConfirmation as { callId: string }).callId),
            name: String((row.pendingConfirmation as { name: string }).name),
            args: (row.pendingConfirmation as { args?: unknown }).args,
          },
        }
      : {}),
    ...(row.continuation &&
    typeof row.continuation === 'object' &&
    (row.continuation as { reason?: unknown }).reason === 'max_steps' &&
    typeof (row.continuation as { maxSteps?: unknown }).maxSteps === 'number'
      ? {
          continuation: {
            reason: 'max_steps' as const,
            maxSteps: Math.max(
              1,
              Math.trunc((row.continuation as { maxSteps: number }).maxSteps),
            ),
            createdAt:
              typeof (row.continuation as { createdAt?: unknown }).createdAt === 'number'
                ? (row.continuation as { createdAt: number }).createdAt
                : Number(row.updatedAt ?? 0),
            ...(typeof (row.continuation as { queuedTurnId?: unknown }).queuedTurnId === 'string' &&
            (row.continuation as { queuedTurnId: string }).queuedTurnId
              ? {
                  queuedTurnId: (row.continuation as { queuedTurnId: string }).queuedTurnId,
                }
              : {}),
          },
        }
      : {}),
    ...(taskPlan ? { taskPlan } : {}),
    messages: asMessages(row.messages),
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
    }
  }

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
        pendingSteers: [],
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

    async updateFields(id, patch) {
      return storage.transaction(['agentSessions'], async (tx) => {
        const rows = await tx.query('agentSessions', { id })
        if (!rows[0]) return null
        const next = { ...toSession(rows[0]), ...patch, updatedAt: Date.now() }
        await tx.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
        return next
      })
    },

    async saveMessages(id, messages) {
      return storage.transaction(['agentSessions'], async (tx) => {
        const rows = await tx.query('agentSessions', { id })
        if (!rows[0]) return null
        const next = { ...toSession(rows[0]), messages, updatedAt: Date.now() }
        await tx.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
        return next
      })
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

    async updateQueuedTurnText(id, turnId, text) {
      if (!text.trim()) return find(id)
      return storage.transaction(['agentSessions'], async (tx) => {
        const rows = await tx.query('agentSessions', { id })
        if (!rows[0]) return null
        const latest = toSession(rows[0])
        const next = {
          ...latest,
          queuedTurns: updateAgentTurnText(latest.queuedTurns, turnId, text),
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
        return next
      })
    },

    async promoteQueuedTurnToSteer(id, turnId, steerId) {
      return storage.transaction(['agentSessions'], async (tx) => {
        const rows = await tx.query('agentSessions', { id })
        if (!rows[0]) return { ok: false as const, reason: 'missing' as const }
        const latest = toSession(rows[0])
        if (latest.pendingConfirmation) {
          return { ok: false as const, reason: 'awaiting_confirmation' as const }
        }
        const turn = latest.queuedTurns.find((item) => item.id === turnId)
        if (!turn) return { ok: false as const, reason: 'missing' as const }
        if (turn.pendingAssetIds?.length) {
          return { ok: false as const, reason: 'has_assets' as const }
        }
        const steering = enqueueAgentSteer(latest.pendingSteers, {
          id: steerId,
          text: turn.text,
          createdAt: Date.now(),
        })
        if (!steering.ok) {
          return { ok: false as const, reason: 'steer_full' as const }
        }
        const next = {
          ...latest,
          pendingSteers: steering.steers,
          queuedTurns: removeAgentTurn(latest.queuedTurns, turnId),
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
        return { ok: true as const, session: next }
      })
    },

    async repairConfirmationSteerCollision(id) {
      return storage.transaction(['agentSessions'], async (tx) => {
        const rows = await tx.query('agentSessions', { id })
        if (!rows[0]) return null
        const latest = toSession(rows[0])
        if (!latest.pendingConfirmation || latest.pendingSteers.length === 0) {
          return null
        }

        let queuedTurns = normalizeQueuedTurns(latest.queuedTurns)
        const recoveredSteerIds = new Set<string>()
        let recoveredAll = true
        for (const steer of normalizeAgentSteers(latest.pendingSteers)) {
          const recovered = enqueueAgentTurn(queuedTurns, {
            id: `recovered-${steer.id}`,
            text: steer.text,
            createdAt: steer.createdAt,
            channelId: latest.channelId,
            model: latest.model,
            ...(latest.imageModel ? { imageModel: latest.imageModel } : {}),
            ...(latest.videoModel ? { videoModel: latest.videoModel } : {}),
            ...(latest.skillId ? { skillId: latest.skillId } : {}),
            ...(latest.autoRun ? { autoRun: true } : {}),
            ...(steer.imageNodeIds?.length
              ? { pendingAssetIds: [...steer.imageNodeIds] }
              : {}),
          })
          if (!recovered.ok) {
            recoveredAll = false
            break
          }
          queuedTurns = recovered.turns
          recoveredSteerIds.add(steer.id)
        }
        /*
         * 不做半恢复：队列已满时若先清确认卡、再把 steer 留在原地，
         * 会留下一个没有任务可挂靠的待发送消息。保持整行原状，等用户腾出队列后重试。
         */
        if (!recoveredAll) return null

        const next: AgentSession = {
          ...latest,
          messages: confirmationSettlementMessages(
            latest.messages,
            latest.pendingConfirmation,
            'canceled',
          ),
          queuedTurns,
          pendingSteers: [],
          pendingConfirmation: undefined,
          continuation: undefined,
          activeTurnId: undefined,
          activeTurnStartedAt: undefined,
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
        return next
      })
    },

    async enqueueSteer(id, steer) {
      const latest = await find(id)
      if (!latest) return { ok: false, reason: 'missing' }
      const queued = enqueueAgentSteer(latest.pendingSteers, steer)
      if (!queued.ok) return { ok: false, reason: queued.reason }
      const next = {
        ...latest,
        pendingSteers: queued.steers,
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
      return { ok: true, session: next }
    },

    async removeSteers(id, steerIds) {
      const latest = await find(id)
      if (!latest || steerIds.length === 0) return latest
      const next = {
        ...latest,
        pendingSteers: removeAgentSteers(latest.pendingSteers, steerIds),
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
      return next
    },

    async claimNextQueuedTurn(id) {
      return storage.transaction(['agentSessions'], async (tx) => {
        const rows = await tx.query('agentSessions', { id })
        if (!rows[0]) return null
        const latest = toSession(rows[0])
        if (latest.activeTurnId) return null
        const turn = takeNextAgentTurn(latest.queuedTurns).turn
        if (!turn) return null
        const session = {
          ...latest,
          activeTurnId: turn.id,
          activeTurnStartedAt: Date.now(),
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', session as unknown as RowOf<'agentSessions'>)
        return { session, turn }
      })
    },

    async finishActiveQueuedTurn(id, turnId, completed) {
      return storage.transaction(['agentSessions'], async (tx) => {
        const rows = await tx.query('agentSessions', { id })
        if (!rows[0]) return null
        const latest = toSession(rows[0])
        if (latest.activeTurnId !== turnId) return latest
        const next = {
          ...latest,
          queuedTurns: completed
            ? removeAgentTurn(latest.queuedTurns, turnId)
            : latest.queuedTurns,
          activeTurnId: undefined,
          activeTurnStartedAt: undefined,
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
        return next
      })
    },

    async releaseActiveTurn(id) {
      const latest = await find(id)
      if (!latest?.activeTurnId) return latest
      const next = {
        ...latest,
        activeTurnId: undefined,
        activeTurnStartedAt: undefined,
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', next as unknown as RowOf<'agentSessions'>)
      return next
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
      await storage.transaction(
        ['agentSessions', 'agentJobs', 'agentEvents'],
        async (tx) => {
          const jobs = await tx.query('agentJobs', { sessionId: id })
          const events = await tx.query('agentEvents', { sessionId: id })
          for (const event of events) await tx.delete('agentEvents', event.id)
          for (const job of jobs) await tx.delete('agentJobs', job.id)
          await tx.delete('agentSessions', id)
        },
      )
    },

    async contextFor(id, window = AGENT_CONTEXT_WINDOW) {
      const s = await find(id)
      if (!s) return []
      // 窗口从**尾部**取：最近说的话最要紧（§4.3）
      return s.messages.slice(Math.max(0, s.messages.length - window))
    },
  }
}
