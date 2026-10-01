import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../../../app/providers/PlatformProvider'
import { useChannels } from '../../../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../../../app/providers/SkillStoreProvider'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import { createAgentSessionStore, type AgentSession } from '../../../../state/agent/sessionStore'
import { createPresetStore } from '../../../../state/project/presetStore'
import { assetNodeSize } from '../../../../domain/canvas/layout/assetNodeSize'
import { findFreeRect } from '../../../../domain/agent/landing'
import type { AgentNodeType } from '../../../../domain/agent/plan'
import { resolveDefaults } from '../../../../features/canvas/createNodeWithDefaults'
import {
  createAssetNode,
  importAssetFile,
  isImportableMedia,
} from '../../../../features/canvas/importAsset'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { useCanvasStore, useSelection } from '../../storeContext'
import { useViewportState } from '../../storeContext'
import type { TextRunRequest } from '../../../../platform/channels/types'
import { resumeAgentTurn, runAgentTurn, type AgentLoopOutcome, type AgentToolRequest } from '../../agent/agentLoop'
import { buildAgentSystemPromptWithContext } from '../../agent/agentSystemPrompt'
import {
  AGENT_TOOLS,
  executeConfirmedTool,
  executeReadTool,
  readGraphSummary,
  type AgentToolContext,
} from '../../agent/tools'
import styles from './AgentPanel.module.css'

/**
 * 画布右侧的 Agent 对话窗（设计文档 §7 / §8）。
 *
 * 界面把循环的三种「停法」如实呈现出来 —— 这是设计里最容易被做糊的一处：
 * 只有一个转圈的话，用户分不清它是**在想**、**在建**、还是**在等他点确认**。
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'toolRunning' }
  | { kind: 'awaitingConfirm'; request: AgentToolRequest }
  | { kind: 'executing' }
  | { kind: 'error'; message: string }

const STATUS_LABEL: Record<Status['kind'], string> = {
  idle: '',
  thinking: '思考中',
  toolRunning: '正在看画布',
  awaitingConfirm: '等你确认',
  executing: '正在执行',
  error: '出错',
}

export function AgentPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const platform = usePlatform()
  const channels = useChannels()
  const store = useCanvasStore()
  const selection = useSelection()
  const viewport = useViewportState()
  const execution = useCanvasExecution()
  const skills = useSkillsOptional()

  const sessions = useMemo(() => createAgentSessionStore(platform.storage), [platform])
  const presets = useMemo(() => createPresetStore(platform.storage), [platform])

  const [list, setList] = useState<AgentSession[]>([])
  const [current, setCurrent] = useState<AgentSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [draft, setDraft] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const enabled = channels.enabledChannels()
  /** 技能列表：内置 + 我的。放在 `send` 之前 —— 它要在拼系统提示词时用到 */
  const allSkills = useMemo(
    () => [...skills.builtinSkills, ...skills.userSkills],
    [skills.builtinSkills, skills.userSkills],
  )
  const chatModelsOf = useCallback(
    (channelId: string) =>
      (channels.getState().channels.find((c) => c.id === channelId)?.models ?? []).filter(
        (m) => m.category === 'chat',
      ),
    [channels],
  )

  /**
   * 新会话该用哪个模型：默认模型 → 该渠道第一个对话模型。
   *
   * **必须有这层回落**：只存了「默认模型」而没选过时，新会话会带着空模型开出来，
   * 用户第一句话就被「还没选模型」挡住 —— 开箱即不能用。冒烟 G95 抓到过这一条。
   */
  const defaultModelFor = useCallback(
    (channelId: string, saved?: string) =>
      saved && chatModelsOf(channelId).some((m) => m.id === saved)
        ? saved
        : (chatModelsOf(channelId)[0]?.id ?? ''),
    [chatModelsOf],
  )

  /** 载入会话列表；没有就按默认模型建一个（设计文档 §8「新建会话用默认模型」） */
  const refresh = useCallback(async () => {
    const rows = await sessions.list(projectId)
    setList(rows)
    return rows
  }, [sessions, projectId])

  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = await refresh()
      if (!alive) return
      if (rows.length > 0) {
        setCurrent(rows[0]!)
        setMessages(rows[0]!.messages)
        return
      }
      const saved = await presets.loadAgentDefault()
      const fallbackChannel = saved?.channelId ?? enabled[0]?.id ?? ''
      const created = await sessions.create({
        projectId,
        channelId: fallbackChannel,
        model: defaultModelFor(fallbackChannel, saved?.model),
      })
      if (!alive) return
      setList([created])
      setCurrent(created)
      setMessages([])
    })()
    return () => {
      alive = false
    }
    // 依赖只列 projectId：这里做的是「项目换了就重建会话列表」，
    // 把 refresh / sessions 列进来会让它在每次保存后重跑，把正在进行的对话打断
  }, [projectId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, status])

  const persist = useCallback(
    async (session: AgentSession, next: ChatMessage[]) => {
      await sessions.save({ ...session, messages: next })
      await refresh()
    },
    [sessions, refresh],
  )

  const switchTo = useCallback(
    async (session: AgentSession) => {
      setCurrent(session)
      // 记忆隔离：切会话就是**换一整套上下文**，不是接着上一个聊（§8.2）
      setMessages(session.messages)
      setStatus({ kind: 'idle' })
      setDraft('')
    },
    [],
  )

  const toolCtx = useCallback(
    (origin: { x: number; y: number }): AgentToolContext => ({
      store,
      origin,
      selectedIds: () => selection,
      runNodes: async (ids) => {
        const out: { nodeId: string; ok: boolean; error?: string }[] = []
        for (const id of ids) {
          try {
            await execution.runNode(id)
            out.push({ nodeId: id, ok: true })
          } catch (e) {
            out.push({ nodeId: id, ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }
        return out
      },
      /**
       * agent 建的节点要和**手建的**用同一套默认值（渠道 + 模型 + 生成参数）。
       *
       * 共用一个 `resolveDefaults`，不是抄一份逻辑：抄的那份迟早漂移，
       * 而这条漂移的后果（agent 建的生成节点点了没反应）正是用户会当成 bug 报的。
       */
      defaultsForNewNode: async (types) => {
        const out: Partial<Record<AgentNodeType, Record<string, unknown>>> = {}
        for (const type of types) out[type] = await resolveDefaults({ channels, type })
        return out
      },
    }),
    [store, selection, execution, channels],
  )

  const loopDeps = useCallback(
    (session: AgentSession) => ({
      adapter: {
        completeText: (req: TextRunRequest, signal: AbortSignal) =>
          channels.completeWithTools({
            channelId: req.channelId,
            model: req.model,
            tools: req.tools ?? AGENT_TOOLS,
            messages: req.messages ?? [],
            signal,
          }),
      },
      channelId: session.channelId,
      model: session.model,
      tools: AGENT_TOOLS,
      executeRead: (name: string, args: unknown) =>
        executeReadTool(name, args, toolCtx(originOf(viewport))),
      signal: abortRef.current?.signal ?? new AbortController().signal,
    }),
    [channels, viewport, toolCtx],
  )

  /** 把循环的结果落到界面上：回答就显示，要确认就出预览卡，刹车/报错就说清楚 */
  const handleOutcome = useCallback(
    async (session: AgentSession, outcome: AgentLoopOutcome) => {
      setMessages(outcome.messages)
      await persist(session, outcome.messages)
      if (outcome.kind === 'message') setStatus({ kind: 'idle' })
      else if (outcome.kind === 'confirm') {
        setStatus({ kind: 'awaitingConfirm', request: outcome.request })
      } else if (outcome.kind === 'stopped') {
        setStatus({ kind: 'error', message: outcome.reason })
      } else setStatus({ kind: 'error', message: outcome.message })
    },
    [persist],
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !current) return
    if (!current.channelId || !current.model) {
      setStatus({ kind: 'error', message: '还没选模型：先在上面选一个对话模型' })
      return
    }
    setDraft('')
    abortRef.current = new AbortController()
    setStatus({ kind: 'thinking' })

    const summary = readGraphSummary(store, 'all', selection)
    /**
     * 系统提示词（设计文档 §4.1 / §8 / §14 M4）= 通用三段 + 随对话给的素材 + 本会话启用的技能。
     *
     * 技能负责「怎么做」，agent 负责「真的去做」—— 所以不是让技能自己执行，
     * 而是把它当作**这次规划的规范**：技能里的阶段就是 agent 要建到画布上的步骤。
     * 按 id 现取正文，技能改了这里跟着变（与画布节点上的 `skillId` 同一口径）。
     *
     * 拼接本身放在 `buildAgentSystemPromptWithContext` 里，不在这儿现拼：
     * 「技能正文到底进没进提示词」只能靠发出去的消息证明，抽成纯函数才有单测。
     */
    const skill = current.skillId ? allSkills.find((s) => s.id === current.skillId) : undefined
    const system = buildAgentSystemPromptWithContext(
      summary,
      { model: current.model },
      {
        assetIds: current.pendingAssetIds ?? [],
        ...(skill ? { skill: { name: skill.name, content: skill.content } } : {}),
      },
    )
    const withSystem: ChatMessage[] = [
      { role: 'system', content: system },
      ...messages,
      { role: 'user', content: text },
    ]
    setMessages(withSystem)
    const outcome = await runAgentTurn(withSystem, loopDeps(current))
    await handleOutcome(current, outcome)
  }, [draft, current, messages, store, selection, loopDeps, handleOutcome, allSkills])

  const confirm = useCallback(async () => {
    if (status.kind !== 'awaitingConfirm' || !current) return
    const { request } = status
    setStatus({ kind: 'executing' })
    const result = await executeConfirmedTool(request.name, request.args, toolCtx(originOf(viewport)))
    setStatus({ kind: 'thinking' })
    const outcome = await resumeAgentTurn(
      messages,
      request.callId,
      result,
      loopDeps(current),
    )
    await handleOutcome(current, outcome)
  }, [status, current, viewport, messages, toolCtx, loopDeps, handleOutcome])

  /** 取消也要回填 —— 不回填模型会以为自己已经建好了（设计文档 §4） */
  const cancel = useCallback(async () => {
    if (status.kind !== 'awaitingConfirm' || !current) return
    const { request } = status
    setStatus({ kind: 'thinking' })
    const outcome = await resumeAgentTurn(
      messages,
      request.callId,
      { ok: false, error: '用户取消了这次操作' },
      loopDeps(current),
    )
    await handleOutcome(current, outcome)
  }, [status, current, messages, loopDeps, handleOutcome])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStatus({ kind: 'idle' })
  }, [])

  const newSession = useCallback(async () => {
    const saved = await presets.loadAgentDefault()
    const channelId = saved?.channelId ?? enabled[0]?.id ?? ''
    const created = await sessions.create({
      projectId,
      channelId,
      model: defaultModelFor(channelId, saved?.model),
    })
    await refresh()
    await switchTo(created)
  }, [presets, sessions, projectId, enabled, refresh, switchTo, defaultModelFor])

  const setModel = useCallback(
    async (patch: Partial<Pick<AgentSession, 'channelId' | 'model'>>) => {
      if (!current) return
      const next = { ...current, ...patch }
      setCurrent(next)
      await sessions.save(next)
    },
    [current, sessions],
  )

  const saveDefault = useCallback(async () => {
    if (!current) return
    await presets.saveAgentDefault({ channelId: current.channelId, model: current.model })
    setIsDefault(true)
  }, [current, presets])

  /**
   * 本会话启用的技能（设计文档 §14 M4）。
   *
   * 存 **id** 不存正文：技能在库里改了，会话跟着用新版 ——
   * 与画布节点上的 `skillId` 同一口径（存正文等于把那一刻冻结住）。
   */
  const setSkill = useCallback(
    async (skillId: string) => {
      if (!current) return
      const next: AgentSession = { ...current, skillId: skillId || undefined }
      setCurrent(next)
      await sessions.save(next)
    },
    [current, sessions],
  )

  /**
   * 用户给素材：**先落成画布上的节点**，再记进会话（设计文档 §8）。
   *
   * 为什么不把图片塞进对话上下文：agent 要用它时得能 `attach` 到那个节点上
   * （复用、不重复建）。只塞上下文的话，模型只能「知道有这么一张图」，
   * 却指不到画布上的任何东西，最后还是自己再建一个 —— 那就重复了。
   */
  const attachFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !current) return
      const deps = { platform, store, projectId }
      const added: string[] = []
      for (const file of Array.from(files)) {
        if (!isImportableMedia(file.type)) continue
        const asset = await importAssetFile(deps, file)
        if (!asset) continue
        /**
         * 落位要**避开已有节点**。不避的话，拖进来的素材会压在画布上原有的节点上 ——
         * 实测过一次：素材盖在模板的提示词节点上，两张叠一起看不清。
         */
        const size = assetNodeSize({ width: asset.width, height: asset.height })
        const existing = store
          .getSnapshot()
          .nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
        const spot = findFreeRect({ ...size, ...originOf(viewport) }, existing)
        const id = createAssetNode(deps, asset, { x: spot.x, y: spot.y })
        if (id) added.push(id)
      }
      if (added.length === 0) return
      const next: AgentSession = {
        ...current,
        pendingAssetIds: [...(current.pendingAssetIds ?? []), ...added],
      }
      setCurrent(next)
      await sessions.save(next)
    },
    [current, platform, store, projectId, viewport, sessions],
  )

  const dropAsset = useCallback(
    async (id: string) => {
      if (!current) return
      const next: AgentSession = {
        ...current,
        pendingAssetIds: (current.pendingAssetIds ?? []).filter((x) => x !== id),
      }
      setCurrent(next)
      await sessions.save(next)
    },
    [current, sessions],
  )

  const visible = messages.filter((m) => m.role !== 'system')
  const pendingPlan = previewOf(status)

  return (
    <aside
      className={styles.panel}
      data-agent-panel
      /* 拖图进来就是「给 agent 一张素材」（设计文档 §8） */
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void attachFiles(e.dataTransfer?.files ?? null)
      }}
    >
      <header className={styles.head}>
        <span className={styles.title}>助手</span>
        <button type="button" className={styles.iconBtn} onClick={onClose} title="收起" data-agent-close>
          ✕
        </button>
      </header>

      <div className={styles.row}>
        <select
          className={styles.select}
          value={current?.id ?? ''}
          onChange={(e) => {
            const hit = list.find((s) => s.id === e.target.value)
            if (hit) void switchTo(hit)
          }}
          data-agent-session-list
        >
          {list.map((s) => (
            <option key={s.id} value={s.id} data-agent-session={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button type="button" className={styles.smallBtn} onClick={() => void newSession()} data-agent-new>
          新建
        </button>
      </div>

      <div className={styles.row}>
        <select
          className={styles.select}
          value={current?.channelId ?? ''}
          onChange={(e) => {
            const channelId = e.target.value
            void setModel({ channelId, model: chatModelsOf(channelId)[0]?.id ?? '' })
          }}
          data-agent-channel
        >
          {enabled.length === 0 && <option value="">（没有可用渠道）</option>}
          {enabled.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={current?.model ?? ''}
          onChange={(e) => void setModel({ model: e.target.value })}
          data-agent-model
        >
          {chatModelsOf(current?.channelId ?? '').map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={() => void saveDefault()}
          title="把这个模型作为以后新建会话的默认值"
          data-agent-set-default
        >
          {isDefault ? '已设默认' : '设默认'}
        </button>
      </div>

      {/* 技能：选了它，agent 就按这份技能的阶段来规划（设计文档 §14 M4） */}
      <div className={styles.row}>
        <select
          className={styles.select}
          value={current?.skillId ?? ''}
          onChange={(e) => void setSkill(e.target.value)}
          data-agent-skill
        >
          <option value="">不使用技能</option>
          {allSkills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.source === 'builtin' ? '（内置）' : ''}
            </option>
          ))}
        </select>
      </div>

      {/*
        随对话给的素材（设计文档 §8）：拖进面板、或点「加素材」。
        落成画布节点后在这里显示成可移除的标签 —— 用户可以随时反悔。
      */}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={() => fileRef.current?.click()}
          data-agent-add-asset
        >
          加素材
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          data-agent-file
          onChange={(e) => {
            void attachFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className={styles.chips}>
          {(current?.pendingAssetIds ?? []).map((id) => (
            <span key={id} className={styles.chip} data-agent-asset={id}>
              <span className={styles.chipText}>{id}</span>
              <button
                type="button"
                className={styles.chipBtn}
                title="移除这张素材"
                onClick={() => void dropAsset(id)}
                data-agent-asset-remove={id}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.messages} ref={scrollRef} data-agent-messages>
        {visible.length === 0 && (
          <p className={styles.hint}>
            说一句你想要什么，我会把它建成画布上的工作流。
          </p>
        )}
        {visible.map((m, i) => (
          <div key={i} className={m.role === 'user' ? styles.msgUser : styles.msgBot} data-agent-message={m.role}>
            {m.content || (m.toolCalls?.length ? `（请求调用 ${m.toolCalls.map((c) => c.name).join('、')}）` : '')}
          </div>
        ))}
        {status.kind !== 'idle' && (
          <div className={styles.statusLine} data-agent-status={status.kind}>
            {STATUS_LABEL[status.kind]}
            {status.kind === 'error' ? `：${status.message}` : ''}
          </div>
        )}
      </div>

      {pendingPlan && (
        <div className={styles.preview} data-agent-preview={pendingPlan.tool}>
          <p className={styles.previewTitle}>{pendingPlan.title}</p>
          <ul className={styles.previewList}>
            {pendingPlan.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <div className={styles.row}>
            <button type="button" className={styles.primary} onClick={() => void confirm()} data-agent-confirm>
              {pendingPlan.action}
            </button>
            <button type="button" className={styles.smallBtn} onClick={() => void cancel()} data-agent-cancel>
              取消
            </button>
          </div>
        </div>
      )}

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          value={draft}
          placeholder="说一句你想要什么…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          data-agent-input
        />
        {status.kind === 'thinking' || status.kind === 'executing' ? (
          <button type="button" className={styles.smallBtn} onClick={stop} data-agent-stop>
            停止
          </button>
        ) : (
          <button type="button" className={styles.primary} onClick={() => void send()} data-agent-send>
            发送
          </button>
        )}
      </div>
    </aside>
  )
}

/** 新节点落在视口中心偏左 —— 你正在看的地方，建出来的东西才在你眼前（§6） */
function originOf(vp: { x: number; y: number }): { x: number; y: number } {
  return { x: vp.x + 120, y: vp.y + 120 }
}

/** 确认卡里要显示什么 —— 让用户**在花钱之前**看清将要发生什么（§9） */
function previewOf(
  status: Status,
): { tool: string; title: string; lines: string[]; action: string } | null {
  if (status.kind !== 'awaitingConfirm') return null
  const { name, args } = status.request
  const a = (args ?? {}) as Record<string, unknown>
  if (name === 'applyPlan') {
    const nodes = Array.isArray(a.nodes) ? a.nodes.length : 0
    const edges = Array.isArray(a.edges) ? a.edges.length : 0
    const attach = Array.isArray(a.attach) ? a.attach.length : 0
    return {
      tool: name,
      title: typeof a.summary === 'string' ? a.summary : '要建的工作流',
      lines: [
        `新建 ${nodes} 个节点、${edges} 条连线`,
        ...(attach > 0 ? [`复用画布上已有的 ${attach} 个节点`] : []),
      ],
      action: '建到画布上',
    }
  }
  if (name === 'runNode') {
    const ids = Array.isArray(a.nodeIds) ? a.nodeIds.length : 0
    return { tool: name, title: '要开始生成', lines: [`跑 ${ids} 个节点（会花钱）`], action: '开始生成' }
  }
  if (name === 'updateNode') {
    return {
      tool: name,
      title: '要改节点参数',
      lines: [`节点 ${String(a.nodeId ?? '')}`, ...Object.keys((a.data ?? {}) as object).map((k) => `改 ${k}`)],
      action: '应用改动',
    }
  }
  return { tool: name, title: name, lines: [], action: '执行' }
}
