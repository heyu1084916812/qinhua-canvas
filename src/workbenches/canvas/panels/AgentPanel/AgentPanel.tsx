import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../../../app/providers/PlatformProvider'
import { useChannels } from '../../../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../../../app/providers/SkillStoreProvider'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import { createAgentSessionStore, type AgentSession } from '../../../../state/agent/sessionStore'
import { createPresetStore } from '../../../../state/project/presetStore'
import { assetNodeSize } from '../../../../domain/canvas/layout/assetNodeSize'
import { findFreeRect } from '../../../../domain/agent/landing'
import type { AgentNodeType } from '../../../../domain/agent/plan'
import {
  channelIdForLogical,
  panelModelOptions,
  presetOf,
  toLogicalName,
} from '../../../../domain/project/modelCatalog'
import { resolveDefaults } from '../../../../features/canvas/createNodeWithDefaults'
import {
  createAssetNode,
  importAssetFile,
  isImportableMedia,
  type ImportedAsset,
} from '../../../../features/canvas/importAsset'
import { AssetMenu } from '../AssetMenu'
import { createAssetLibraryRepository } from '../../../../state/project/assetLibraryRepository'
import { createAssetLibraryStore } from '../../../../state/project/assetLibraryStore'
import { SkillMenu } from './SkillMenu'
import { parseSkillMarkdown } from '../../../../domain/prompt/skill'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { useCanvasStore, useGraph, useSelection } from '../../storeContext'
import { useViewportState } from '../../storeContext'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
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
import {
  IconAuto,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconDelete,
  IconImage,
  IconManual,
  IconMention,
  IconModelCube,
  IconPlus,
  IconRename,
  IconSettings,
  IconSkill,
} from '../../toolbar/icons'
import { toConversation } from './conversation'
import { loadAssetUrl, useAsset } from '../../hooks/useAsset'
import { ModelIcon } from '../../../../features/shared/modelIcon/ModelIcon'
/**
 * 参数控件与档位表**与创作面板共用同一份**（不各写一套）。
 *
 * 这正是两条老教训：① 档位各写一份的话，用户在生成节点上看到 21:9、
 * 到对话窗发现没有这一档，就会以为功能坏了；② 原生 `<select>` 的展开层由浏览器
 * 绘制，既不受画布浮层规范约束、也点不动（用户 2026-10-02：「太简陋了」）——
 * 所以对话窗直接复用 `ParamPicker` 那套「chip + 浮层」。
 */
import { ParamPicker } from '../ParamPicker'
import {
  MentionEditor,
  mentionToken,
  parseMentions,
  stripMentionMarkup,
  type MentionEditorHandle,
} from '../../text/MentionEditor'
import { MarkdownBlocks } from '../../text/MarkdownBlocks'
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

/**
 * 自动模式下**一轮对话最多自动执行几次**。
 *
 * 「确认 → 执行 → 再确认」是可能绕圈的（模型每步都想再往下走一步）。
 * 到顶就退回手动，把最后那张确认卡留给用户 —— 总比无限花钱好。
 */
const AUTO_RUN_LIMIT = 6

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
  /**
   * 素材库（用户 2026-10-03：「加素材…分两个功能，点击后本地上传和素材库添加」）。
   *
   * 素材库 store 原先只在素材页里就地建；这里按同一套工厂再建一份（同一个
   * `platform.storage`、同一张 `assetLibrary` 表）—— 不新增全局 provider，
   * 因为画布页与素材页本来就各用各的一份，读的是同一份数据。
   */
  const library = useMemo(
    () => createAssetLibraryStore(createAssetLibraryRepository(platform.storage)),
    [platform],
  )
  const libraryAssets = useSyncExternalStore(
    library.subscribe,
    () => library.getState().assets,
    () => library.getState().assets,
  )

  const [list, setList] = useState<AgentSession[]>([])
  const [current, setCurrent] = useState<AgentSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [draft, setDraft] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  /** 订阅全量渠道：设置页改完立刻反映（与创作面板同一条口径） */
  const allChannels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  /** 会话改名：就地编辑，Enter 提交 / Esc 取消（不弹原生 prompt —— 那会打断画布操作） */
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 删除会话走两步：第一次点只是「准备好」，第二次点才真删（对齐库里其他删除入口） */
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** 「已设默认」的提示框只闪一次，用完即收 */
  const [defaultSaved, setDefaultSaved] = useState(false)
  /** 展开看细节的步骤（工具调用 id 集合）。默认全收起 —— 对话流先保持干净 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /**
   * 当前展开的参数浮层（模型 / 技能 / 参数三选一）。
   *
   * 「开新关旧」由这一个 key 保证，与创作面板同一条口径 —— 各管各的 boolean
   * 会出现两个浮层同时挂在屏幕上、点哪个都不对。
   */
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** 技能导入的两个输入：**.md 文件**与**文件夹**（浏览器只允许二选一，故分成两个） */
  const skillFileRef = useRef<HTMLInputElement | null>(null)
  const skillDirRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<MentionEditorHandle | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /**
   * 已启用渠道。`useMemo` 不是为了省那一次 filter，而是为了让**依赖它的
   * 回调**（选模型时要顺带定渠道）保持稳定 —— 不 memo 的话每次渲染都是新数组，
   * `useCallback` 的依赖永不相等，回调每帧重建。
   */
  const enabled = useMemo(() => channels.enabledChannels(), [channels, allChannels])
  /** 技能列表：内置 + 我的。放在 `send` 之前 —— 它要在拼系统提示词时用到 */
  const allSkills = useMemo(
    () => [...skills.builtinSkills, ...skills.userSkills],
    [skills.builtinSkills, skills.userSkills],
  )
  /**
   * 对话模型下拉的**数据源**：与创作面板同一套「前端显示名」（§7.4.1 / modelCatalog）。
   *
   * 为什么不用「渠道里勾选的原始 ID」：用户在面板上看到的是「GPT-6 Astra」
   * 「Agnes 2.5 Pro」这类显示名；这里要是一串 `agnes-2.5-pro`、`mock-chat-1`，
   * 同一个模型就变成两个名字，还得让用户记住哪个 ID 对应哪条渠道 —— 这不是选模型，
   * 是考古。`panelModelOptions` 本身就是「固定清单显示名在前 + 渠道勾选模型的
   * 归一显示名在后」，与生成节点那侧完全同源。
   */
  /**
   * 对话窗的模型清单：**只列当前真的跑得起来的那些**。
   *
   * 与创作面板的差别（用户 2026-10-02：「agnes 的是不是多了」）：那边留着一批
   * 「固定显示名」是为了**先把名字选好、再去后台配映射**；对话窗不是这个场景 ——
   * 这里的模型**下一句话就要发请求**。列一个没有渠道能提供的模型，用户选中之后
   * 只会得到一句「没有渠道提供模型」，白点一次。
   *
   * 判据就是选模型时用的那一条（`channelIdForLogical`）：能解析出渠道 = 能跑。
   * 两处共用同一份搜索，不会出现「这里列得出来、那里选不动」。
   */
  const modelOptionsByKind = useMemo(() => {
    const pick = (category: 'image' | 'video' | 'chat') =>
      panelModelOptions(allChannels, category).filter(
        (n) => channelIdForLogical(enabled, n) !== undefined,
      )
    return { image: pick('image'), video: pick('video'), chat: pick('chat') }
  }, [allChannels, enabled])
  const chatModelOptions = modelOptionsByKind.chat
  /** 会话存的模型名 → 逻辑显示名（老会话存过上游 ID 的在这里归一） */
  const shownModel = useMemo(
    () => toLogicalName(allChannels, current?.model ?? ''),
    [allChannels, current?.model],
  )

  /**
   * 技能 chip 的文案：只进 `aria-label`（悬停 / 读屏可见）。
   *
   * 工具条上那两枚按用户 2026-10-02 的要求是**只有图标**的按钮，
   * 名字不占地方，但无障碍名不能跟着省。
   */
  const skillLabel = useMemo(() => {
    const id = current?.skillId
    if (!id) return '技能'
    return allSkills.find((s) => s.id === id)?.name ?? '技能'
  }, [current?.skillId, allSkills])

  /**
   * 新会话该用哪个模型：默认模型 → 该渠道第一个对话模型。
   *
   * **必须有这层回落**：只存了「默认模型」而没选过时，新会话会带着空模型开出来，
   * 用户第一句话就被「还没选模型」挡住 —— 开箱即不能用。冒烟 G95 抓到过这一条。
   *
   * 存的是**逻辑显示名**：发请求前由渠道映射翻译成上游 ID（channelStore 已接）。
   * 显示名不在选项里（渠道模型被删 / 名单变了）才退到第一个选项。
   */
  const defaultModelFor = useCallback(
    (options: readonly string[], saved?: string) =>
      saved && options.includes(saved) ? saved : (options[0] ?? ''),
    [],
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
      /**
       * 渠道 store 是应用级单例、挂载时统一 load；但**新建画布页**这条路径
       * 可能先于 load 完成就读 enabledChannels —— 那一刻 enabled 为空，
       * 新会话会带着空渠道开出来，第一句话就报「还没选模型」。
       * 这里补一次 await load（幂等），把时序缝上。
       */
      await channels.load()
      const rows = await refresh()
      if (!alive) return
      if (rows.length > 0) {
        setCurrent(rows[0]!)
        setMessages(rows[0]!.messages)
        return
      }
      /**
       * 用**刚刚读到的**渠道，而不是本次渲染闭包里的 `enabled`：effect 只在
       * projectId 变化时跑，那个 `enabled` 可能是挂载那一帧的快照 ——
       * 渠道还没 load 完时它就是空的，新会话会带着空模型开出来。
       */
      const liveChannels = channels.getState().channels
      const liveEnabled = liveChannels.filter((c) => c.enabled)
      const livePick = (category: 'image' | 'video' | 'chat') =>
        panelModelOptions(liveChannels, category).filter(
          (n) => channelIdForLogical(liveEnabled, n) !== undefined,
        )
      const liveModelOptions = livePick('chat')
      const saved = await presets.loadAgentDefault()
      const fallbackChannel = saved?.channelId ?? liveEnabled[0]?.id ?? ''
      const created = await sessions.create({
        projectId,
        channelId: fallbackChannel,
        model: defaultModelFor(liveModelOptions, saved?.model),
        imageModel: livePick('image')[0] ?? '',
        videoModel: livePick('video')[0] ?? '',
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
      // 换了会话，之前「准备好删了」的那个状态不该跟过来
      setRenaming(false)
      setConfirmDelete(false)
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
      /**
       * 生成节点用哪个模型：按计划里那个节点的 `data.mode` 选图片档还是视频档。
       *
       * 渠道由模型名**反查**（`channelIdForLogical`）—— 换了模型就得跟着换渠道，
       * 否则会发出「A 渠道 + B 渠道的模型」这种请求，报错还看不懂。
       */
      recipeForGenerated: (type, node) => {
        if (type !== 'generation') return undefined
        const kind = node.data.mode === 'video' ? 'video' : 'image'
        const model = kind === 'video' ? current?.videoModel : current?.imageModel
        if (!model) return undefined
        const channelId = channelIdForLogical(enabled, model, current?.channelId)
        return channelId ? { channelId, model } : undefined
      },
    }),
    [store, selection, execution, channels, current, enabled],
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
      /**
       * 确认**之前**的预检（用户 2026-10-02：「重复让我确认新建工作流，重复了三次，
       * 但是我的画布中没有」）。计划本身落不了地时，别让用户白点一次确认 ——
       * 直接把问题回给模型，让它在同一轮里自己改；同一轮里它要是还发同一版，
       * 循环自己的指纹刹车会把这一轮停下来。
       */
      precheck: (name: string, args: unknown) => {
        if (name !== 'runNode') return { ok: true as const }
        /** 节点都不在画布上，就别让用户点「批准运行」了（他批的是一团空气） */
        const args2 = (args ?? {}) as { nodeIds?: unknown }
        const ids = Array.isArray(args2.nodeIds) ? args2.nodeIds.map(String) : []
        const existing = new Set(store.getSnapshot().nodes.map((n) => n.id))
        const missing = ids.filter((id) => !existing.has(id))
        return missing.length > 0
          ? { ok: false as const, result: { ok: false, problems: missing.map((id) => `节点不存在：${id}`) } }
          : { ok: true as const }
      },
      /**
       * 建图类（applyPlan）**直接落地**，不等确认 —— 用户 2026-10-02 的口径：
       * 「他直接给我新建进去，但是生成与否需要让我确认，取消后也不会撤回
       * 已经新建到画布中的工作流」。
       */
      executeWrite: (name: string, args: unknown) =>
        executeConfirmedTool(name, args, toolCtx(originOf(viewport))),
      executeRead: (name: string, args: unknown) =>
        executeReadTool(name, args, toolCtx(originOf(viewport))),
      signal: abortRef.current?.signal ?? new AbortController().signal,
    }),
    [channels, viewport, toolCtx, store],
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
    /** 这句话里 @ 引用了什么（节点 / 模型）。空数组就不加那一段 */
    const mentions = parseMentions(text)
    /** 用户点选的三档模型里的图片 / 视频那两个（对话模型由 `inherited` 报） */
    const mediaModels = {
      ...(current.imageModel ? { image: current.imageModel } : {}),
      ...(current.videoModel ? { video: current.videoModel } : {}),
    }
    const system = buildAgentSystemPromptWithContext(
      summary,
      { model: current.model },
      {
        assetIds: current.pendingAssetIds ?? [],
        ...(skill ? { skill: { name: skill.name, content: skill.content } } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(Object.keys(mediaModels).length > 0 ? { mediaModels } : {}),
      },
    )
    const withSystem: ChatMessage[] = [
      { role: 'system', content: system },
      ...messages,
      /**
       * 发给模型的是**去掉存储形态**的正文：`@[小猫钓鱼](node:node_x)` → `@小猫钓鱼`。
       * 引用指向谁由上面那段 mentions 讲清楚（带 id），正文里不必再夹一串括号。
       */
      { role: 'user', content: stripMentionMarkup(text) },
    ]
    setMessages(withSystem)
    let outcome = await runAgentTurn(withSystem, loopDeps(current))
    /**
     * **自动生成**：agent 请求落地 / 执行时不再停下等确认，直接把这一步做完再继续。
     *
     * 与手动那条路（`handleOutcome` 里的 `awaitingConfirm` → 用户点确认）是同一件事，
     * 区别只在**要不要问**。上限见 `AUTO_RUN_LIMIT`：到顶退回手动，把最后那张
     * 确认卡留给用户。
     */
    let autoSteps = 0
    while (outcome.kind === 'confirm' && current.autoRun === true && autoSteps < AUTO_RUN_LIMIT) {
      autoSteps += 1
      setStatus({ kind: 'executing' })
      const done = await executeConfirmedTool(
        outcome.request.name,
        outcome.request.args,
        toolCtx(originOf(viewport)),
      )
      setMessages(outcome.messages)
      outcome = await resumeAgentTurn(
        outcome.messages,
        outcome.request.callId,
        done,
        loopDeps(current),
      )
    }
    await handleOutcome(current, outcome)
  }, [draft, current, messages, store, selection, loopDeps, handleOutcome, allSkills, toolCtx, viewport])

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
      model: defaultModelFor(chatModelOptions, saved?.model),
      imageModel: modelOptionsByKind.image[0] ?? '',
      videoModel: modelOptionsByKind.video[0] ?? '',
    })
    await refresh()
    await switchTo(created)
  }, [
    presets,
    sessions,
    projectId,
    enabled,
    refresh,
    switchTo,
    defaultModelFor,
    chatModelOptions,
    modelOptionsByKind,
  ])

  /**
   * 存会话上的任意字段：模型、技能、素材标签、比例 / 画质 / 质量都走这一条。
   *
   * `list` 必须**跟着一起改**：切走再切回时 `switchTo` 取的是 `list` 里的那一行，
   * 不同步的话「刚选好的模型 / 比例」会在切回时变回旧值 —— 而用户看到的是
   * 「选了下拉自己变回去」，只会当成功能坏了。更糟的是那份旧行会被下一次保存
   * 整份写回去，把库里的新值也冲掉。
   */
  const patchSession = useCallback(
    async (patch: Partial<AgentSession>) => {
      if (!current) return
      const next = { ...current, ...patch }
      setCurrent(next)
      setList((prev) => prev.map((s) => (s.id === next.id ? next : s)))
      await sessions.save(next)
    },
    [current, sessions],
  )

  /**
   * 选模型：**同时**把渠道定下来。
   *
   * 用户 2026-10-02 拍板把「选渠道」这一档从对话窗去掉（「不要有选择渠道」）——
   * 用户眼里只有模型名，渠道是实现细节。但发请求必须带渠道，所以这里在选模型
   * 的同时解析出「哪条渠道能提供它」，而不是留个空让用户自己去配。
   *
   * 当前会话已经在用的渠道若能提供这个模型就**不换**（`preferChannelId`）：
   * 同一个模型在多条渠道都有时，换渠道会让它突然走另一条线，用户没要求这件事。
   */
  const pickModel = useCallback(
    async (model: string) => {
      if (!current) return
      const channelId =
        channelIdForLogical(enabled, model, current.channelId) ?? current.channelId
      await patchSession({ model, channelId })
    },
    [current, enabled, patchSession],
  )

  /**
   * 图片 / 视频模型的点选（用户 2026-10-03：「我创作面板有什么模型就用什么模型，
   * 分了图片和视频…也就是说模型有三个选项」）。
   *
   * 只改会话上对应那一档 —— **对话模型不受影响**（那是 agent 自己跑的 LLM，
   * 与「建出来的生成节点用哪个模型」是两件事）。
   */
  const setModelKind = useCallback(
    async (key: 'imageModel' | 'videoModel', model: string) => {
      await patchSession({ [key]: model })
    },
    [patchSession],
  )

  /**
   * 手动 / 自动生成（用户 2026-10-02，参考产品图一那一档）。
   *
   * 「自动」= agent 请求落地 / 执行时**不再停下等确认**。默认必须是手动 ——
   * 默认替你花钱不是本项目愿意做的决定（设计文档 §9）。
   */
  const setAutoRun = useCallback(
    async (autoRun: boolean) => {
      await patchSession({ autoRun })
    },
    [patchSession],
  )

  /**
   * 在输入框里插入一个 @ 引用（引用菜单里选完之后调它）。
   *
   * 走编辑器自己的 `insertMention`，而不是往 `draft` 里拼字符串：
   * 引用要落在**光标处**、要带 chip 的存储形态，这两件事只有编辑器知道。
   */
  const insertMention = useCallback((kind: 'node' | 'model', id: string, label: string) => {
    editorRef.current?.insertMention(mentionToken(kind, id, label))
  }, [])

  /** 开始改名：把当前标题放进草稿，选中整段方便直接覆盖 */
  const startRename = useCallback(() => {
    if (!current) return
    setTitleDraft(current.title)
    setRenaming(true)
    setConfirmDelete(false)
  }, [current])

  /** 切某一步的展开态（参考产品的「图片节点已创建 ⌄」——细节默认收起） */
  const toggleStep = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /**
   * 提交改名。
   *
   * 空标题**不改**（回到原名）：允许存成空串的话，会话列表里会出现一行看不见的条目 ——
   * 那种「东西还在但认不出它是谁」的状态比拒绝一次输入糟得多。
   */
  const commitRename = useCallback(async () => {
    if (!current) return
    const title = titleDraft.trim()
    setRenaming(false)
    if (!title || title === current.title) return
    await sessions.rename(current.id, title)
    const rows = await refresh()
    const hit = rows.find((s) => s.id === current.id)
    if (hit) setCurrent(hit)
  }, [current, titleDraft, sessions, refresh])

  /**
   * 删除会话（两步确认）。
   *
   * 删掉的正好是当前会话时，必须**当场换一个**：留着 current 指向一条已不存在的记录，
   * 界面上会继续显示它、下一句话还会往它的 id 上写 —— 那是最难查的一类不一致。
   * 一条都不剩时直接开一条新的，保证「至少有一个会话」这条不变式。
   */
  const deleteSession = useCallback(async () => {
    if (!current) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    await sessions.remove(current.id)
    const rows = await refresh()
    if (rows.length > 0) await switchTo(rows[0]!)
    else await newSession()
  }, [current, confirmDelete, sessions, refresh, switchTo, newSession])

  /**
   * 把**画布上选中的节点**当素材给这次对话（设计文档 §8「输入：文字 + 可选图片」）。
   *
   * 与拖图不同：这些节点早就落库了，不需要再导一次，直接把 id 记进会话 ——
   * agent 会用同一套 `attach` 复用它们。
   */
  const attachSelection = useCallback(async () => {
    if (!current || selection.length === 0) return
    const exist = new Set(store.getSnapshot().nodes.map((n) => n.id))
    const picked = selection.filter((id) => exist.has(id))
    if (picked.length === 0) {
      store.notify('选中的不是画布上的节点')
      return
    }
    const merged = [...new Set([...(current.pendingAssetIds ?? []), ...picked])]
    await patchSession({ pendingAssetIds: merged })
  }, [current, selection, store, patchSession])

  const saveDefault = useCallback(async () => {
    if (!current) return
    await presets.saveAgentDefault({ channelId: current.channelId, model: current.model })
    setIsDefault(true)
    setDefaultSaved(true)
  }, [current, presets])

  /**
   * 本会话启用的技能（设计文档 §14 M4）。
   *
   * 存 **id** 不存正文：技能在库里改了，会话跟着用新版 ——
   * 与画布节点上的 `skillId` 同一口径（存正文等于把那一刻冻结住）。
   */
  const setSkill = useCallback(
    async (skillId: string) => {
      await patchSession({ skillId: skillId || undefined })
    },
    [patchSession],
  )

  const navigate = useNavigate()

  /**
   * 导入技能（用户 2026-10-03：「导入已有 skill（通过设定好的 skill 流程去解析 md
   * 文件或者文件夹）」）。
   *
   * 解析与落库**复用技能库那一页同一套**（`parseSkillMarkdown` + `skills.create`），
   * 一处都没另写。逐个独立成败：一个文件格式不对，不该让同批的其余几个也失败。
   */
  const importSkills = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      let ok = 0
      const failed: string[] = []
      for (const file of Array.from(files)) {
        if (!/\.(md|markdown|txt)$/i.test(file.name)) continue
        try {
          const parsed = parseSkillMarkdown(
            await file.text(),
            file.name.replace(/\.(md|markdown|txt)$/i, ''),
          )
          if (!parsed.ok) {
            failed.push(`${file.name}：${parsed.error}`)
            continue
          }
          await skills.create(parsed.skill)
          ok += 1
        } catch (e) {
          failed.push(`${file.name}：${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await skills.reload()
      setOpenPicker(null)
      store.notify(
        failed.length === 0
          ? `已导入 ${ok} 条技能`
          : `导入 ${ok} 条，${failed.length} 条失败：${failed[0]}`,
      )
    },
    [skills, store],
  )

  /**
   * 去技能库。
   *
   * 「创建新的 Skill」与「全部」都走这里：**编辑一份技能**（写正文、改名字、
   * 复制内置）只有在技能库那一页才有完整界面，在这里再搭一个编辑器是重复建设。
   */
  const openSkillLibrary = useCallback(() => {
    setOpenPicker(null)
    navigate('/skills')
  }, [navigate])

  /**
   * 把一份素材落到画布上，**避开已有节点**。
   *
   * 抽出来是因为现在有**两条**入口：本地上传（`attachFiles`）与素材库添加
   * （`addFromLibrary`）。两处各写一遍落位与建节点，迟早有一条忘了避让、
   * 把新素材压在别人节点上 —— 那种「两张图叠一起」2026-10-01 实测踩过一次。
   */
  const placeAsset = useCallback(
    (asset: ImportedAsset): string | null => {
      const size = assetNodeSize({ width: asset.width, height: asset.height })
      const existing = store
        .getSnapshot()
        .nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
      const spot = findFreeRect({ ...size, ...originOf(viewport) }, existing)
      return createAssetNode({ platform, store, projectId }, asset, { x: spot.x, y: spot.y })
    },
    [platform, store, projectId, viewport],
  )

  /**
   * 从**素材库**挑一个加进这次对话（用户 2026-10-03：「加素材…分两个功能，
   * 点击后本地上传和素材库添加」）。
   *
   * 与本地导入走**同一条落位链路**（`placeAsset`），也记进 `pendingAssetIds` ——
   * 对 agent 来说两者没有区别，都是「画布上那个素材节点」，用 attach 复用即可。
   */
  const addFromLibrary = useCallback(
    async (hash: string) => {
      const asset = library.getState().assets.find((a) => a.hash === hash)
      if (!current || !asset) return
      const id = placeAsset({
        hash: asset.hash,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
      })
      if (!id) return
      await patchSession({ pendingAssetIds: [...(current.pendingAssetIds ?? []), id] })
    },
    [current, library, patchSession, placeAsset],
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
        const id = placeAsset(asset)
        if (id) added.push(id)
      }
      if (added.length === 0) return
      await patchSession({
        pendingAssetIds: [...(current.pendingAssetIds ?? []), ...added],
      })
    },
    [current, platform, store, projectId, patchSession, placeAsset],
  )

  const dropAsset = useCallback(
    async (id: string) => {
      if (!current) return
      await patchSession({
        pendingAssetIds: (current.pendingAssetIds ?? []).filter((x) => x !== id),
      })
    },
    [current, patchSession],
  )

  /**
   * 对话流：把原始消息翻成「气泡 / 正文 / 步骤卡」三种条目。
   *
   * 不直接用 `messages.filter(role !== 'system')` 渲染 —— 那样 `tool` 消息会把
   * 一整屏 JSON 打给用户。翻成人话这件事放在 `conversation.ts` 的纯函数里，
   * 因为「哪一步该说什么」是产品口径，得能断言。
   */
  const items = useMemo(() => toConversation(messages), [messages])
  /** 节点 id → 产物 hash：步骤卡据此把这一步产出的图**内嵌**显示（图变更时跟着刷） */
  const graph = useGraph()
  const hashOfNode = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of graph.nodes) {
      const hash = (n.data as { assetHash?: unknown }).assetHash
      if (typeof hash === 'string' && hash) map.set(n.id, hash)
    }
    return map
  }, [graph])

  /**
   * @ 引用里的**节点缩略图**（用户 2026-10-03，参考产品图六：chip 上要看得见那张图）。
   *
   * 编辑器是**命令式建的 DOM**、拿不到 `useAsset` 这类 hook，所以图在这里取：
   * 按草稿里出现过的节点 id 去 `assets` 表读一次，缓存成 `nodeId → objectURL`，
   * 再用版本号通知编辑器**就地**把图补进槽位。
   */
  const thumbCacheRef = useRef(new Map<string, string>())
  const [thumbVersion, setThumbVersion] = useState(0)
  const thumbOf = useCallback(
    (nodeId: string) => thumbCacheRef.current.get(nodeId) ?? null,
    [],
  )

  useEffect(() => {
    const refs = parseMentions(draft).filter((m) => m.kind === 'node')
    if (refs.length === 0) return
    let alive = true
    void (async () => {
      let added = false
      for (const r of refs) {
        if (thumbCacheRef.current.has(r.id)) continue
        const hash = hashOfNode.get(r.id)
        if (!hash) continue
        const meta = await loadAssetUrl(platform, hash)
        if (!alive || !meta.url) continue
        thumbCacheRef.current.set(r.id, meta.url)
        added = true
      }
      if (added && alive) setThumbVersion((v) => v + 1)
    })()
    return () => {
      alive = false
    }
  }, [draft, hashOfNode, platform])

  /** 卸载时把建出来的 objectURL 回收掉（不回收就是一路泄漏） */
  useEffect(
    () => () => {
      for (const url of thumbCacheRef.current.values()) URL.revokeObjectURL(url)
      thumbCacheRef.current.clear()
    },
    [],
  )

  const pendingPlan = previewOf(status, store)

  return (
    <aside
      className={styles.panel}
      data-agent-panel
      /**
       * Esc **先关参数浮层**（与创作面板同一条口径：想收起下拉，结果把整块面板
       * 一起关掉是最容易踩的那一脚）。
       *
       * 两条纪律，都是从创作面板那边学来的：
       * ① 浮层开着的 Esc 只关浮层，**不关对话窗** —— 对话窗是常驻面板，
       *    在输入框里按 Esc 本意多半是「算了」，不该把整块面板收走；
       * ② 消费掉就 `preventDefault()` 声明出来。`NodeFollowBar` 挂在 window 上
       *    监听 Esc 并清空选中，不声明的话一次 Esc 会做两件事。
       */
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !openPicker) return
        e.preventDefault()
        setOpenPicker(null)
      }}
      /* 拖图进来就是「给 agent 一张素材」（设计文档 §8） */
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void attachFiles(e.dataTransfer?.files ?? null)
      }}
    >
      {/*
        头部：会话名 + 一排图标钮（新建 / 改名 / 删除 / 收起）。

        参考产品（liblib.tv）就是这么排的：标题占左，动作收成图标。
        本面板不到 400px 宽，四项文字按钮一排会把会话名挤到看不清 ——
        图标 + title 提示，鼠标停上去才知道是什么，这点与画布工具栏同一口径。
      */}
      <header className={styles.head}>
        {renaming ? (
          <>
            <input
              className={styles.titleInput}
              value={titleDraft}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              data-agent-title-input
            />
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void commitRename()}
              title="保存名字"
              data-agent-rename-save
            >
              <IconCheck size={16} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setRenaming(false)}
              title="放弃改名"
              data-agent-rename-cancel
            >
              <IconClose size={16} />
            </button>
          </>
        ) : (
          <>
            <select
              className={styles.titleSelect}
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
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void newSession()}
              title="新建对话"
              data-agent-new
            >
              <IconPlus size={16} />
            </button>
            {/*
              「设为默认模型」放在**头部**、不留在输入区工具条里：
              它是**会话级的偏好**（决定以后新建会话用哪个模型），不是「这一次
              要发出去的东西」。用户 2026-10-02 明确要求工具条只留三件事
              （模型 / 技能 / 参数），把它挪到会话动作那一排最自然。
            */}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void saveDefault()}
              title={isDefault ? '已是默认模型' : '把这个模型设为以后新建会话的默认值'}
              data-agent-set-default
            >
              {defaultSaved ? <IconCheck size={16} /> : <IconSettings size={16} />}
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={startRename}
              disabled={!current}
              title="给这条对话改名"
              data-agent-rename
            >
              <IconRename size={16} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void deleteSession()}
              disabled={!current}
              title={confirmDelete ? '再点一次就删掉' : '删除这条对话'}
              data-agent-delete
            >
              {confirmDelete ? <span className={styles.confirmText}>确认删除</span> : <IconDelete size={16} />}
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              title="收起助手"
              data-agent-close
            >
              <IconClose size={16} />
            </button>
          </>
        )}
      </header>

      <div className={styles.messages} ref={scrollRef} data-agent-messages>
        {items.length === 0 && (
          <p className={styles.hint}>
            说一句你想要什么，我会把它建成画布上的工作流。
          </p>
        )}
        {items.map((item, i) => {
          if (item.kind === 'user') {
            return (
              <div key={i} className={styles.msgUser} data-agent-message="user">
                {item.text}
              </div>
            )
          }
          if (item.kind === 'text') {
            return (
              <div key={i} className={styles.msgBot} data-agent-message="assistant">
                {/*
                  助手回复走 Markdown 渲染（用户 2026-10-02：模型回的
                  `- **看看画布现状**` 把星号和杠原样打在界面上）。
                  与提示词节点**共用同一个渲染器** —— 见 `MarkdownBlocks` 的说明。
                */}
                <MarkdownBlocks source={item.text} />
              </div>
            )
          }
          /** 步骤卡：一行标题 + 可展开的明细；涉及到的节点把产物缩略图直接嵌进来 */
          const thumbs = item.nodeIds
            .map((id) => ({ id, hash: hashOfNode.get(id) }))
            .filter((x): x is { id: string; hash: string } => Boolean(x.hash))
          const isOpen = expanded.has(item.id)
          const hasDetail = item.lines.length > 0 || thumbs.length > 0
          return (
            <div
              key={i}
              className={item.failed ? styles.stepFailed : styles.step}
              data-agent-step={item.tool}
              /* 失败与否不能只靠 CSS 类名 —— 那是哈希过的，断言不到 */
              {...(item.failed ? { 'data-agent-step-failed': '' } : {})}
            >
              <button
                type="button"
                className={styles.stepHead}
                data-agent-step-detail={item.tool}
                onClick={() => hasDetail && toggleStep(item.id)}
                title={hasDetail ? (isOpen ? '收起细节' : '看这一步的细节') : item.label}
              >
                <span className={styles.stepLabel}>{item.label}</span>
                {hasDetail && (
                  <span className={isOpen ? styles.chevronUp : styles.chevronDown}>
                    <IconChevronDown size={14} />
                  </span>
                )}
              </button>
              {/*
                **失败的那一条不折叠**：原因藏在折叠层里等于没报 —— 用户会以为是
                「它又问了我一遍」而不是「这件事被拒了，因为……」（2026-10-02 报的
                那个「重复确认」的现象里，被拒的理由就一直没露出来过）。
              */}
              {(isOpen || item.failed) && item.lines.length > 0 && (
                <ul className={styles.stepLines}>
                  {item.lines.map((l, k) => (
                    <li key={k}>{l}</li>
                  ))}
                </ul>
              )}
              {isOpen && thumbs.length > 0 && (
                <div className={styles.thumbs}>
                  {thumbs.map((t) => (
                    <span key={t.id} className={styles.thumb} data-agent-thumb={t.id}>
                      <StepThumb hash={t.hash} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {status.kind !== 'idle' && (
          <div className={styles.statusLine} data-agent-status={status.kind}>
            {STATUS_LABEL[status.kind]}
            {status.kind === 'error' ? `：${status.message}` : ''}
          </div>
        )}
      </div>

      {/*
        确认卡：**放在对话流里、当一条步骤**，而不是贴在输入框上方的独立弹层。
        参考产品（liblib.tv）就是把「是否运行节点「小猫钓鱼」生成图片？」
        这条确认当成对话时间线的一部分，批准动作也是时间线里的一个小按钮 ——
        确认过之后它留在原地（能看到「批准过」），而不是整个消失。
      */}
      {pendingPlan && (
        <div className={styles.step} data-agent-preview={pendingPlan.tool}>
          <div className={styles.stepHead}>
            <span className={styles.stepLabel}>{pendingPlan.title}</span>
          </div>
          <ul className={styles.stepLines}>
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

      {/*
        输入区：一个圆角盒子，**上正文、下工具条**（参考产品 liblib.tv 的对话框形态）。

        正文用 `MentionEditor`（contenteditable）而不是 `textarea`：用户 2026-10-02
        要「@ 引用的节点 / 模型在输入框里呈现为一个矩形、作为文本内容的一部分」，
        而 `textarea` 只能显示纯文本，做不到「一个矩形夹在文字中间」。
        素材标签也收在盒子里 —— 它们是「这次要说出去的东西」，不是面板参数。
      */}
      <div className={styles.composer} data-agent-composer>
        {/*
          这一行装「这次对话挂上的东西」：**技能**与**素材**。

          技能也显示成 chip（用户 2026-10-03：「选择后就能用这个 skill，也是在 agent
          的对话框中显示出来代表我用了这个 skill」）—— 与 @ 引用同一套「用了什么，
          一眼看得见」，而不是只在菜单里打个勾。
        */}
        {(current?.skillId || (current?.pendingAssetIds ?? []).length > 0) && (
          <div className={styles.chips}>
            {current?.skillId && (
              <span className={styles.chip} data-agent-skill-chip={current.skillId}>
                <IconSkill size={12} />
                <span className={styles.chipText}>{skillLabel}</span>
                <button
                  type="button"
                  className={styles.chipBtn}
                  title="这次不用这个技能"
                  onClick={() => void setSkill('')}
                  data-agent-skill-chip-remove
                >
                  ✕
                </button>
              </span>
            )}
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
        )}

        <MentionEditor
          ref={editorRef}
          value={draft}
          onChange={setDraft}
          placeholder="开始你的创作，或者 @ 引用工作流 / 节点 / 资源"
          onEnter={() => void send()}
          /** 刚打出 `@` → 直接开引用菜单（参考产品就是「打 @ 就出」） */
          onMentionTrigger={() => setOpenPicker('agent-mention')}
          /** 节点引用的缩略图：宿主取图，编辑器就地补进 chip 的槽位 */
          thumbOf={thumbOf}
          thumbVersion={thumbVersion}
        />

        <div className={styles.bar}>
          <div className={styles.barPills}>
            {/*
              加素材：**两条路**（用户 2026-10-03：「加素材是要的，他分两个功能，
              点击后本地上传和素材库添加，也是要有图标」）。

              菜单复用画布既有的 `AssetMenu`（图标 + 文案）—— 与节点素材右上角那个
              是同一个组件，只是这次朝**上**展开（工具条在面板底部）。
            */}
            <span className={styles.addWrap}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setOpenPicker(openPicker === 'agent-asset' ? null : 'agent-asset')}
                title="加素材（本地上传 / 素材库）"
                data-agent-add-asset
              >
                <IconPlus size={16} />
              </button>
              {openPicker === 'agent-asset' && (
                <AssetMenu
                  anchor="above"
                  onClose={() => setOpenPicker(null)}
                  items={[
                    {
                      id: 'upload',
                      label: '本地上传',
                      hint: '从这台电脑选图片或视频',
                      icon: 'upload',
                      onSelect: () => fileRef.current?.click(),
                    },
                    {
                      id: 'library',
                      label: '素材库添加',
                      hint: '从「我的素材」里挑一个',
                      icon: 'library',
                      onSelect: () => {
                        setOpenPicker('agent-library')
                        void library.load()
                      },
                    },
                  ]}
                />
              )}
              {openPicker === 'agent-library' && (
                <div
                  className={styles.library}
                  data-agent-library
                  role="dialog"
                  aria-label="从素材库添加"
                >
                  {libraryAssets.length === 0 ? (
                    <span className={styles.libraryEmpty}>
                      素材库还是空的：去「我的素材」收藏几张再用
                    </span>
                  ) : (
                    libraryAssets.map((a) => (
                      <button
                        key={a.hash}
                        type="button"
                        className={styles.libraryItem}
                        title={a.prompt ?? a.mime}
                        data-agent-library-item={a.hash}
                        onClick={() => {
                          void addFromLibrary(a.hash)
                          setOpenPicker(null)
                        }}
                      >
                        <LibraryThumb hash={a.hash} />
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    className={styles.libraryClose}
                    onClick={() => setOpenPicker(null)}
                    aria-label="关闭素材库"
                    data-agent-library-close
                  >
                    <IconClose size={12} />
                  </button>
                </div>
              )}
            </span>
            {/*
              画布上已经有的节点，不必再导一遍 —— 直接把选中的记进这次对话（§8）。
              没选中时置灰而不是隐藏：隐藏了用户不知道有这个入口。
            */}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void attachSelection()}
              disabled={selection.length === 0}
              title={selection.length === 0 ? '先在画布上选中节点' : '把选中的节点当作这次的素材'}
              data-agent-pick-selection
            >
              <IconImage size={16} />
            </button>

            {/*
              工具条剩下的四件事（用户 2026-10-02 第二轮）：
              **@ 引用 / 模型 / 技能 / 手动·自动**。

              三处形态上的决定都是用户点名的：
              ① 「模型用一个 3d 建模的图标展示，立体的方形」「skill 也是用一个图标展示」
                 ⇒ 这两枚 chip **只显示图标、不写字**（`triggerIcon` + `label=""`），
                 名字进 `aria-label`（悬停 / 读屏可见），列表里照旧带名字与厂商 logo；
              ② 「参数去掉，只保留模型的选项」⇒ 比例 / 画质 / 质量那一枚**整个撤掉**
                 （会话字段与提示词那段仍留着，见 §8：入口先撤、口径不撤，
                 免得下次要加回来时又得从提示词一路重接）；
              ③ 「手动和自动用图标进行替换，选中能替换」⇒ 图标本身跟着**当前档位**换
                 （手 / 循环箭头），不是只在菜单里高亮。
            */}

            {/*
              @ 引用：一个浮层里两段 —— **节点**（这张画布上的）与**模型**。
              选完插进输入框成为一颗矩形 chip，是文本内容的一部分（`MentionEditor`）。
            */}
            <ParamPicker
              name="agent-mention"
              ariaLabel="引用画布里的节点或模型"
              label=""
              triggerIcon={<IconMention size={16} />}
              size="compact"
              closeOnSelect
              sections={[
                {
                  name: 'node',
                  label: '节点',
                  variant: 'list',
                  options: graph.nodes.map((n) => ({
                    value: `node:${n.id}`,
                    label: (n.title ?? '').trim() || n.type,
                    hint: n.type,
                  })),
                  value: '',
                  emptyHint: '这张画布上还没有节点',
                  onSelect: (v) => {
                    const id = v.slice('node:'.length)
                    const hit = graph.nodes.find((n) => n.id === id)
                    insertMention('node', id, (hit?.title ?? '').trim() || id)
                  },
                },
                {
                  name: 'model',
                  label: '模型',
                  variant: 'list',
                  options: chatModelOptions.map((n) => {
                    const preset = presetOf(n)
                    return {
                      value: `model:${n}`,
                      label: n,
                      ...(preset ? { icon: <ModelIcon vendor={preset.vendor} /> } : {}),
                    }
                  }),
                  value: '',
                  emptyHint: '还没有可用的对话模型',
                  onSelect: (v) => {
                    const name = v.slice('model:'.length)
                    insertMention('model', name, name)
                  },
                },
              ]}
              open={openPicker === 'agent-mention'}
              onToggle={() => setOpenPicker(openPicker === 'agent-mention' ? null : 'agent-mention')}
              onClose={() => setOpenPicker(null)}
            />

            {/*
              模型**三档**（用户 2026-10-03：「我创作面板有什么模型就用什么模型，
              分了图片和视频，然后给我加一个对话模型的选项…也就是说模型有三个选项」）：
                · 图片 / 视频 = agent **建出来的生成节点**用哪个模型；
                · 对话       = **agent 自己**跑的那个 LLM。
              清单与创作面板**同一份数据源**（`panelModelOptions`：固定显示名在前 +
              渠道勾选的归一显示名），再按「有没有渠道真能提供它」筛一道。
            */}
            <ParamPicker
              name="agent-model"
              ariaLabel={`模型（图片 ${current?.imageModel || '未选'} / 视频 ${
                current?.videoModel || '未选'
              } / 对话 ${shownModel || '未选'}）`}
              label=""
              triggerIcon={<IconModelCube size={16} />}
              size="compact"
              closeOnSelect
              sections={[
                {
                  name: 'image',
                  label: '图片',
                  variant: 'list',
                  options: withModelIcons(modelOptionsByKind.image),
                  value: current?.imageModel ?? '',
                  emptyHint: '没有可用的图片模型',
                  onSelect: (v) => void setModelKind('imageModel', v),
                },
                {
                  name: 'video',
                  label: '视频',
                  variant: 'list',
                  options: withModelIcons(modelOptionsByKind.video),
                  value: current?.videoModel ?? '',
                  emptyHint: '没有可用的视频模型',
                  onSelect: (v) => void setModelKind('videoModel', v),
                },
                {
                  name: 'chat',
                  label: '对话',
                  variant: 'list',
                  options: withModelIcons(chatModelOptions),
                  value: shownModel,
                  emptyHint: '没有可用的对话模型：去后台设置里勾选',
                  onSelect: (v) => void pickModel(v),
                },
              ]}
              open={openPicker === 'agent-model'}
              onToggle={() => setOpenPicker(openPicker === 'agent-model' ? null : 'agent-model')}
              onClose={() => setOpenPicker(null)}
            />

            {/*
              技能：图标按钮 + **技能菜单**（用户 2026-10-03，参考产品图三 / 图四）。
              菜单里能按「通用 / 我的」分类、搜索、创建、导入（.md 或文件夹）；
              「全部」去技能库那一页。
            */}
            <span className={styles.addWrap}>
              <button
                type="button"
                className={styles.iconBtn}
                title={current?.skillId ? `技能：${skillLabel}` : '选择技能'}
                aria-label={`这份技能决定 agent 把哪些阶段建到画布上（当前：${skillLabel}）`}
                data-agent-skill-open
                onClick={() => setOpenPicker(openPicker === 'agent-skill' ? null : 'agent-skill')}
              >
                <IconSkill size={16} />
              </button>
              {openPicker === 'agent-skill' && (
                <SkillMenu
                  builtin={skills.builtinSkills}
                  user={skills.userSkills}
                  activeId={current?.skillId ?? null}
                  onSelect={(id) => {
                    void setSkill(id ?? '')
                    setOpenPicker(null)
                  }}
                  onCreateNew={openSkillLibrary}
                  onImportFiles={() => skillFileRef.current?.click()}
                  onImportFolder={() => skillDirRef.current?.click()}
                  onOpenLibrary={openSkillLibrary}
                  onClose={() => setOpenPicker(null)}
                />
              )}
              <input
                ref={skillFileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown"
                multiple
                hidden
                data-agent-skill-file
                onChange={(e) => {
                  void importSkills(e.target.files)
                  e.target.value = ''
                }}
              />
              {/*
                文件夹导入用 `webkitdirectory`：它与 `accept` 互斥（设了它就只能选目录），
                所以和上面那个文件输入**分成两个**，而不是硬塞进一个。
              */}
              <input
                ref={skillDirRef}
                type="file"
                multiple
                hidden
                data-agent-skill-dir
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(e) => {
                  void importSkills(e.target.files)
                  e.target.value = ''
                }}
              />
            </span>

            {/*
              手动 / 自动生成（参考产品图一那一档）：两个候选各带一句后果说明。
              图标跟着当前档位换 —— 「选中能替换」指的就是这一枚。
            */}
            <ParamPicker
              name="agent-autorun"
              ariaLabel={
                current?.autoRun
                  ? '自动生成：不再逐步询问'
                  : '手动生成：每次生成前问你一句'
              }
              label=""
              triggerIcon={current?.autoRun ? <IconAuto size={16} /> : <IconManual size={16} />}
              size="compact"
              variant="list"
              options={[
                {
                  value: 'manual',
                  label: '手动生成',
                  hint: '每次生成前询问',
                  icon: <IconManual size={16} />,
                },
                {
                  value: 'auto',
                  label: '自动生成',
                  hint: '直接消耗积分',
                  icon: <IconAuto size={16} />,
                },
              ]}
              value={current?.autoRun ? 'auto' : 'manual'}
              open={openPicker === 'agent-autorun'}
              onToggle={() =>
                setOpenPicker(openPicker === 'agent-autorun' ? null : 'agent-autorun')
              }
              onClose={() => setOpenPicker(null)}
              onSelect={(v) => void setAutoRun(v === 'auto')}
            />
          </div>

          {/*
            发送钮的形态与**内容**有关（像参考产品：没写字就只是个圆点，写了才是可点的上箭头），
            与「是否在执行」无关 —— 执行中它变成停止，这一层含义独立表达。
          */}
          {status.kind === 'thinking' || status.kind === 'executing' ? (
            <button
              type="button"
              className={`${styles.send} ${styles.sendBusy}`}
              onClick={stop}
              title="停止"
              data-agent-stop
            >
              <IconClose size={16} />
            </button>
          ) : draft.trim() ? (
            <button
              type="button"
              className={`${styles.send} ${styles.sendActive}`}
              onClick={() => void send()}
              title="发送"
              data-agent-send
            >
              <IconArrowUp size={16} />
            </button>
          ) : (
            <span className={styles.sendIdle} data-agent-send-idle aria-hidden="true" />
          )}
        </div>

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
      </div>
    </aside>
  )
}

/** 步骤卡里嵌的一张小图：直接用画布那套「按 hash 取素材」的钩子，不另写一条取图链路 */
function StepThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return <span className={styles.thumbEmpty} />
  return <img className={styles.thumbImg} src={url} alt="这一步的产物" />
}

/** 素材库里的一个缩略图：同样走 `useAsset`，不另写一条取图链路 */
function LibraryThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return <span className={styles.libraryPlaceholder} />
  return <img className={styles.libraryImg} src={url} alt="" />
}

/**
 * 模型候选 → 带厂商图标的选项（固定清单里的那些才有图标）。
 *
 * 与创作面板同源：两处都只调 `presetOf` + `ModelIcon`，不各画一套 logo。
 */
function withModelIcons(names: readonly string[]) {
  return names.map((n) => {
    const preset = presetOf(n)
    return {
      value: n,
      label: n,
      ...(preset ? { icon: <ModelIcon vendor={preset.vendor} /> } : {}),
    }
  })
}

/** 新节点落在视口中心偏左 —— 你正在看的地方，建出来的东西才在你眼前（§6） */
function originOf(vp: { x: number; y: number }): { x: number; y: number } {
  return { x: vp.x + 120, y: vp.y + 120 }
}

/** 确认卡里要显示什么 —— 让用户**在花钱之前**看清将要发生什么（§9） */
function previewOf(
  status: Status,
  store: CanvasStore,
): { tool: string; title: string; lines: string[]; action: string } | null {
  if (status.kind !== 'awaitingConfirm') return null
  const { name, args } = status.request
  const a = (args ?? {}) as Record<string, unknown>
  /**
   * ⚠️ 这里**没有 `applyPlan` 分支**：建图已经不等确认了（`agentLoop` 的
   * `WRITE_TOOLS`），所以那种确认卡根本不会出现。别为了「万一」把它加回来 ——
   * 一张永远走不到的分支，下次改这里的人会以为它还在生效。
   */
  if (name === 'runNode') {
    const ids = Array.isArray(a.nodeIds) ? a.nodeIds.length : 0
    /**
     * 要跑的是哪**一个**节点时，把它的名字报出来（参考产品的问法就是
     * 「是否运行节点「小猫钓鱼」生成图片？」—— 用户认的是名字，不是 id）。
     */
    const nodeId = Array.isArray(a.nodeIds) && typeof a.nodeIds[0] === 'string' ? a.nodeIds[0] : ''
    const node = store.getSnapshot().nodes.find((n) => n.id === nodeId)
    return {
      tool: name,
      title: node ? `是否运行节点「${node.title ?? '未命名'}」生成图片？` : '要开始生成',
      lines: [`跑 ${ids} 个节点（会花钱）`],
      action: '批准运行',
    }
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
