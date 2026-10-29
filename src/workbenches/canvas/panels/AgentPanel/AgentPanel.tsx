import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../../../app/providers/PlatformProvider'
import { useChannels } from '../../../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../../../app/providers/SkillStoreProvider'
import type { ChatMessage, NodeInput } from '../../../../domain/shared/execution/types'
import { formatContextBundleForPrompt } from '../../../../domain/shared/context'
import {
  VISUAL_REVIEW_SYSTEM_PROMPT,
  buildVisualReviewPrompt,
  finalizeVisualReviewResult,
  parseVisualReviewText,
  type VisualReviewResult,
} from '../../../../domain/agent/visualReview'
import { prepareVisualReviewImages } from '../../../../features/shared/agent/visualReviewRunner'
import { memoryCandidateFromText } from '../../../../domain/shared/memoryOrganizer'
import {
  AGENT_CONTEXT_WINDOW,
  createAgentSessionStore,
  type AgentSession,
} from '../../../../state/agent/sessionStore'
import { createAgentJobStore } from '../../../../state/agent/jobStore'
import type { AgentDeliveryMode } from '../../../../domain/agent/delivery'
import {
  confirmationRequiresExplicitApproval,
  confirmationRunsGeneration,
  confirmationSettlementMessages,
} from '../../../../domain/agent/confirmation'
import {
  agentTaskPlanProgress,
  normalizeTaskPlanProposal,
  taskPlanPrompt,
} from '../../../../domain/agent/taskPlan'
import { createPresetStore } from '../../../../state/project/presetStore'
import { assetNodeSize } from '../../../../domain/canvas/layout/assetNodeSize'
import { findFreeRect } from '../../../../domain/agent/landing'
import type { AgentNodeType } from '../../../../domain/agent/plan'
import {
  channelIdForLogical,
  capabilityOfLogical,
  panelModelOptions,
  presetOf,
  toLogicalName,
} from '../../../../domain/project/modelCatalog'
import {
  type RoutedChatTarget,
} from '../../../../domain/shared/chatTarget'
import type { PresetVendor } from '../../../../domain/project/modelPresets'
import {
  generationAvailabilityOf,
  runRouteCandidatesOf,
} from '../../../../domain/project/generationRouting'
import { resolveDefaults } from '../../../../features/canvas/createNodeWithDefaults'
import { cropAsset, extractSelection } from '../../../../features/canvas/extractSelection'
import { splitNodeToGrid } from '../../../../features/canvas/splitToGrid'
import { subscribeAgentHandoff, takeAgentHandoff } from '../../../../features/canvas/agentHandoff'
import {
  activeQueueTurnOf,
  claimSessionActivity,
  clearQueueDrain,
  isSessionActivityActive,
  releaseSessionActivity,
  requestQueueDrain,
  shouldDrainQueue,
  subscribeSessionRelease,
} from '../../../../features/canvas/agent/sessionActivity'
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
import { MentionRichText } from './MentionRichText'
import { runWaves } from '../../../../domain/canvas/graph/runWaves'
import type { RunRecord } from '../../../../domain/canvas/model/runRecord'
import { parseSkillMarkdown } from '../../../../domain/prompt/skill'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { useCanvasStore, useGraph, useSelection } from '../../storeContext'
import { useViewportState } from '../../storeContext'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { TextRunRequest } from '../../../../platform/channels/types'
import {
  resumeAgentTurn,
  runAgentTurn,
  type AgentLoopDeps,
  type AgentLoopOutcome,
  type AgentToolRequest,
} from '../../agent/agentLoop'
import { trimOrphanToolMessages } from '../../agent/historyWindow'
import {
  buildAgentSystemPromptWithContext,
  looksLikePreserveRequest,
  looksLikeStyleOnlyRequest,
  expectsPerImageFlows,
} from '../../agent/agentSystemPrompt'
import {
  AGENT_TOOLS,
  executeConfirmedTool,
  executeReadTool,
  readGraphSummary,
  runFromNodeIds,
  type AgentToolContext,
} from '../../agent/tools'
import { agentRunOutcomeOf } from '../../agent/runOutcome'
import { runPreflightProblems } from '../../agent/runPreflight'
import {
  decideToolMode,
  ensureToolSupport,
} from '../../../../features/shared/agent/toolSupport'
import { createModelRoutePort } from '../../../../features/shared/agent/ModelRoutePort'
import { createRouteExecutionPort } from '../../../../features/shared/agent/RouteExecutionPort'
import { createAgentController } from '../../../../features/shared/agent/AgentController'
import { createAgentMemoryPort } from '../../../../features/shared/agent/MemoryPort'
import {
  AgentToolEffectBlockedError,
  createAgentToolEffectLedger,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import {
  directTextTrace,
  type DirectRunRouteCandidate,
} from '../../../../state/shared/directRun'
import { createContextRepository } from '../../../../state/shared/contextRepository'
import { createId } from '../../../../shared/id'
import {
  queuedTurnPreview,
  sessionForQueuedTurn,
  type QueuedAgentTurn,
} from '../../../../domain/agent/queuedTurn'
import { steerMessagesOf } from '../../../../domain/agent/steering'
import {
  getAgentDeliveryMode,
  setAgentDeliveryMode,
  subscribeAgentDeliveryMode,
} from '../../../../state/ui/agentDelivery'
import {
  IconAuto,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconCopyText,
  IconDelete,
  IconChat,
  IconLoop,
  IconManual,
  IconMention,
  IconMore,
  IconModelCube,
  IconPlus,
  IconRename,
  IconSettings,
  IconSkill,
  IconSteer,
} from '../../toolbar/icons'
import {
  readableConfirmationLines,
  toConversation,
  type ConversationItem,
  type ConversationStep,
} from './conversation'
import { TaskPlanCard } from './TaskPlanCard'
import { errText } from '../../agent/agentLoop'
import { loadAssetUrl, useAsset } from '../../../../features/shared/assets/index'
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
  type MentionRef,
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
  | { kind: 'paused'; message: string }
  | { kind: 'executing'; tool?: string }
  | { kind: 'error'; message: string }

/** 单例的空闲态：按会话取状态时的兜底值，**必须是同一个对象**（否则每次都换引用，依赖数组炸） */
const IDLE_STATUS: Status = { kind: 'idle' }

const STATUS_LABEL: Record<Status['kind'], string> = {
  idle: '',
  thinking: '思考中',
  toolRunning: '正在看画布',
  awaitingConfirm: '等你确认',
  paused: '本轮已暂停',
  executing: '正在执行',
  error: '出错',
}

const GENERATION_ACTIVITY_PHRASES = [
  '别急，图马上出来',
  '正在把画面整理好',
  '生成任务正在推进',
  '快好了，正在检查结果',
] as const

function statusIsBusy(status: Status): boolean {
  return status.kind !== 'idle' && status.kind !== 'error'
}

function statusCanSteer(status: Status): boolean {
  return (
    status.kind === 'thinking' ||
    status.kind === 'toolRunning' ||
    status.kind === 'awaitingConfirm' ||
    status.kind === 'executing'
  )
}

interface AgentChatRoute extends RoutedChatTarget {
  credentialGroupId?: string
  routePlanId: string
  candidates: DirectRunRouteCandidate[]
}

type ChatRoutePreparation =
  | { ok: true; route: AgentChatRoute }
  | { ok: false; message: string }

/**
 * 自动模式下**一轮对话最多自动执行几次**。
 *
 * 「确认 → 执行 → 再确认」是可能绕圈的（模型每步都想再往下走一步）。
 * 到顶转为可继续的安全检查点，不把下一步变成新的付费确认卡。
 */
const AUTO_RUN_LIMIT = 32

export function AgentPanel({
  projectId,
  onClose,
  onOpenSettings,
}: {
  projectId: string
  onClose: () => void
  onOpenSettings: () => void
}) {
  const platform = usePlatform()
  const channels = useChannels()
  const store = useCanvasStore()
  const selection = useSelection()
  const viewport = useViewportState()
  const execution = useCanvasExecution()
  const skills = useSkillsOptional()

  const [statusBySession, setStatusBySession] = useState<Record<string, Status>>({})
  const setStatusFor = useCallback((sessionId: string, next: Status) => {
    setStatusBySession((prev) => ({ ...prev, [sessionId]: next }))
  }, [])
  const controller = useMemo(
    () =>
      createAgentController({
        projectId,
        sessions: createAgentSessionStore(platform.storage),
        jobs: createAgentJobStore(platform.storage),
        hooks: {
          isSessionActivityActive,
          onPendingConfirmation: (sessionId, request) => {
            setStatusFor(sessionId, { kind: 'awaitingConfirm', request })
          },
          onContinuation: (sessionId, maxSteps) => {
            setStatusFor(sessionId, {
              kind: 'paused',
              message: `已完成 ${maxSteps} 步，可继续`,
            })
          },
          onNeedsAttention: (sessionId, message) => {
            setStatusFor(sessionId, { kind: 'error', message })
          },
          onIdle: (sessionId) => setStatusFor(sessionId, IDLE_STATUS),
          notify: (message, tone) => store.notify(message, tone),
        },
      }),
    [platform.storage, projectId, setStatusFor, store],
  )
  const { sessions, jobs } = controller
  const ensureAgentJob = controller.ensureJob
  const transitionSessionJob = controller.transition
  const toolEffects = useMemo(() => createAgentToolEffectLedger(jobs), [jobs])
  const memory = useMemo(
    () => createAgentMemoryPort(createContextRepository(platform.storage)),
    [platform],
  )
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
  /** 当前会话那一份运行态（别的会话在跑不影响这里） */
  const status: Status = (current && statusBySession[current.id]) || IDLE_STATUS
  const [queueExpanded, setQueueExpanded] = useState(false)
  const deliveryMode = useSyncExternalStore(
    subscribeAgentDeliveryMode,
    getAgentDeliveryMode,
    getAgentDeliveryMode,
  )
  const queuePumpingRef = useRef(new Set<string>())
  const confirmingRef = useRef(new Set<string>())
  const stoppingRef = useRef(new Set<string>())
  /** 已批准、正在执行的确认工具；停止时要给这条 tool_call 补一个中断结果。 */
  const inFlightConfirmationRef = useRef(new Map<string, AgentToolRequest>())
  const queuePumpRef = useRef<(sessionId: string) => void>(() => {})
  /**
   * 「现在显示的是哪个会话」。
   *
   * 异步回调（一个回合跑完 / 报错）**不能直接用 `current`** —— A 的回合结束时用户可能
   * 已经切到 B 去看别的了，那一份消息盖上去就把 B 的对话流冲掉了（§8.2 记忆隔离）。
   */
  const currentIdRef = useRef<string | null>(null)
  /**
   * 这次用户的话是不是「多张图各自一条流程」（`expectsPerImageFlows`）。
   *
   * 在**发消息那一刻**算好，留给工具执行时读 —— 工具执行可能发生在用户点「批准」之后，
   * 那时闭包里已经拿不到当时的正文了（见 `toolCtx` 里那段说明）。
   */
  const perImageRef = useRef(false)
  /**
   * **这一轮会话「上次用过的模型」**（用户 2026-10-16：「我连续的迭代需求的话就用我上一个对话的，
   * 例如一开始我给对话框输入了 gpt2 模型的话，后续如果我没有另外输入模型的话基本上就会都是 gpt2，
   * 如果后面我输入了香蕉模型的话就用香蕉模型」）。
   *
   * 用 ref 而不是只读会话里的 `imageModel`：那个字段要等一次落库 + 刷新才回来，
   * 而「连续迭代」是同一条会话里的**下一轮**就要生效。落库那份照样写（跨会话/重开还在），
   * 这份只负责**本轮立刻生效**。
   */
  const stickyModelRef = useRef<{ image?: string; video?: string }>({})
  currentIdRef.current = current?.id ?? null
  const [draft, setDraft] = useState('')
  const [queueMenuId, setQueueMenuId] = useState<string | null>(null)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [editingQueueText, setEditingQueueText] = useState('')
  useEffect(() => {
    setQueueMenuId(null)
    setEditingQueueId(null)
    setEditingQueueText('')
  }, [current?.id])
  useEffect(() => {
    let alive = true
    void presets
      .loadAgentDeliveryMode()
      .then((mode) => {
        if (alive) setAgentDeliveryMode(mode)
      })
      .catch(() => {
        // 读取失败沿用内存默认“引导”，不打断 Agent 启动。
      })
    return () => {
      alive = false
    }
  }, [presets])
  useEffect(() => {
    if (!queueMenuId) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (
        target.closest(`[data-agent-queue-more="${queueMenuId}"]`) ||
        target.closest(`[data-agent-queue-menu="${queueMenuId}"]`)
      ) {
        return
      }
      setQueueMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQueueMenuId(null)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [queueMenuId])
  /** 订阅全量渠道：设置页改完立刻反映（与创作面板同一条口径） */
  const allChannels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const customModels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().customModels,
    () => [],
  )
  const uncommonModelIds = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().uncommonModelIds,
    () => [],
  )
  const globalImageModels = useMemo(
    () => channels.globalModelsOf('image').map((model) => model.id),
    [channels, customModels, uncommonModelIds],
  )
  const globalVideoModels = useMemo(
    () => channels.globalModelsOf('video').map((model) => model.id),
    [channels, customModels, uncommonModelIds],
  )
  /** 会话改名：就地编辑，Enter 提交 / Esc 取消（不弹原生 prompt —— 那会打断画布操作） */
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 删除会话走两步：第一次点只是「准备好」，第二次点才真删（对齐库里其他删除入口） */
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** 「已设默认」的提示框只闪一次，用完即收 */
  /** 展开看细节的步骤（工具调用 id 集合）。默认全收起 —— 对话流先保持干净 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** 刚复制过哪一条助手回复：图标短暂换成对勾，给用户一个「确实复制了」的回执 */
  const [copiedKey, setCopiedKey] = useState<number | null>(null)
  /**
   * 当前展开的参数浮层（模型 / 技能 / 参数三选一）。
   *
   * 「开新关旧」由这一个 key 保证，与创作面板同一条口径 —— 各管各的 boolean
   * 会出现两个浮层同时挂在屏幕上、点哪个都不对。
   */
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  /** 技能收藏（用户 2026-10-03：技能菜单分「通用 / 收藏 / 我的」） */
  const [skillFavs, setSkillFavs] = useState<readonly string[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** 技能导入的两个输入：**.md 文件**与**文件夹**（浏览器只允许二选一，故分成两个） */
  const skillFileRef = useRef<HTMLInputElement | null>(null)
  const skillDirRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<MentionEditorHandle | null>(null)
  /**
   * 中止用的控制器**按会话各存一个**（与 `statusBySession` 同一口径）。
   *
   * 早先只有一份 `abortRef`：在 B 里点发送会把 A 的那份覆盖掉，A 就再也停不下来；
   * 反过来「停止」也只停得到最后发出去的那一条。两个会话各跑各的，控制器也得各是各的。
   */
  const abortRefs = useRef(new Map<string, AbortController>())
  /** 每个会话这个回合走的是原生 tools 还是 JSON 降级；确认后续跑要沿用同一条 */
  const toolModeRef = useRef(new Map<string, 'native' | 'json'>())
  const planAliasesRef = useRef(new Map<string, Map<string, string>>())
  /** 自动生成是“实时开关”：用户在本轮运行中切换，已经发出的这一轮也要立刻认新值 */
  const autoRunRef = useRef(new Map<string, boolean>())
  /**
   * 一次用户回合解析出的实际渠道。
   *
   * 确认与自动执行会把同一回合拆成多次模型调用，这些调用必须继续走同一条渠道；
   * 下一次真正发送新消息时再按全局策略重新选路。
   */
  const chatRouteRef = useRef(new Map<string, AgentChatRoute>())
  const deliveredSteersRef = useRef(new Map<string, Set<string>>())
  const contextTraceRef = useRef(
    new Map<
      string,
      {
        digest: string
        memoryRefs: { id: string; revision: number }[]
        kitVersionRefs: { kitId: string; version: number }[]
        assetRefs: { hash: string; mime: string }[]
        brief?: string
      }
    >(),
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const modelRoute = useMemo(
    () =>
      createModelRoutePort((request) =>
        channels.planGenerationRoute(request),
      ),
    [channels],
  )
  const routeExecution = useMemo(
    () =>
      createRouteExecutionPort((request) =>
        channels.completeWithTools(request),
      ),
    [channels],
  )

  /**
   * 已启用渠道。`useMemo` 不是为了省那一次 filter，而是为了让**依赖它的
   * 回调**（选模型时要顺带定渠道）保持稳定 —— 不 memo 的话每次渲染都是新数组，
   * `useCallback` 的依赖永不相等，回调每帧重建。
   */
  const enabled = useMemo(() => channels.enabledChannels(), [channels, allChannels])
  const generationAvailability = useMemo(
    () => ({
      image: generationAvailabilityOf(allChannels, 'image', channels.protocolCatalog()),
      video: generationAvailabilityOf(allChannels, 'video', channels.protocolCatalog()),
    }),
    [allChannels, channels],
  )
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
   * 对话窗的模型清单：固定前端名，不按渠道当前是否可路由增删。
   * 没有真实对话渠道提供所选名称时，发送前的 `resolveRoutedChatTarget()`
   * 会立即返回空并给出明确错误，不会把请求发出去等超时。
   */
  const modelOptionsByKind = useMemo(() => {
    /**
     * 生成模型（图片 / 视频）：**前端有什么就列什么**。
     *
     * 用户 2026-10-02 第四轮：「图一当中模型的选择面板，把前端所有的模型写上去，
     * 除了对话模型」—— 这里与创作面板**同一份清单**（`panelModelOptions`：
     * 只有前端显示名，渠道模型不进这个列表，见对账 #371），
     * 不再按「当下有没有渠道能提供」筛一道。
     *
     * 为什么改回来：筛过之后，用户还没配映射的那些固定显示名会**整个消失**，
     * 面板看起来像「我的模型不见了」；而真正跑不动时执行层会报明确原因
     * （渠道 / 映射那句），比「列表里没有」好排查得多。对话模型不在这里 ——
     * 它是单独一行（agent 自己的 LLM）。
     */
    const pick = (category: 'image' | 'video') =>
      category === 'image' ? globalImageModels : globalVideoModels
    /** 对话模型也保持固定的前端清单，不按渠道能力增删。 */
    const chat = panelModelOptions('chat', uncommonModelIds)
    return { image: pick('image'), video: pick('video'), chat }
  }, [globalImageModels, globalVideoModels, uncommonModelIds])
  const chatModelOptions = modelOptionsByKind.chat
  /**
   * **已经放进这次对话的模型**（正文里的 `model` chip）。
   *
   * 用户 2026-10-04 第 3 条把图一那枚 ✓ 的含义说清楚了：「不是默认用这两个模型的
   * 意思，是把模型放在对话框中，意思是用这些模型进行生成，能组成多个模型参与的流程」。
   * 所以模型面板里的高亮要跟着**正文里的引用**走，而不是跟着会话的默认模型走 ——
   * 后者看起来就是「默认值」，正是用户否掉的那种读法。
   * （会话那两个默认字段仍然保留：用户一枚都没 @ 时，新节点还得有个可用的模型。）
   */
  const mentionedModels = useMemo(
    () => new Set(parseMentions(draft).filter((m) => m.kind === 'model').map((m) => m.id)),
    [draft],
  )
  /** 会话存的模型名 → 逻辑显示名（老会话存过上游 ID 的在这里归一） */
  const shownModel = useMemo(
    () => toLogicalName(allChannels, current?.model ?? ''),
    [allChannels, current?.model],
  )
  /**
   * 取本轮路由：同一会话、同一逻辑模型在本轮内复用；换模型或开始新消息时重新选。
   * UI 只保存逻辑名，渠道始终是后台实现细节。
   */
  const cachedChatRoute = useCallback((session: AgentSession): AgentChatRoute | null => {
    const logicalModel =
      toLogicalName(allChannels, session.model) || session.model.trim()
    const cached = chatRouteRef.current.get(session.id)
    return cached?.logicalModel === logicalModel ? cached : null
  }, [allChannels])

  const prepareChatRoute = useCallback(
    async (
      session: AgentSession,
      fresh = false,
    ): Promise<ChatRoutePreparation> => {
      const logicalModel =
        toLogicalName(allChannels, session.model) || session.model.trim()
      if (!logicalModel) {
        return { ok: false, message: '还没选模型：先在上面选一个对话模型' }
      }
      const cached = cachedChatRoute(session)
      if (!fresh && cached) return { ok: true, route: cached }
      const planned = await modelRoute.plan({
        capability: 'chat',
        logicalModel,
      })
      if (!planned.ok) {
        const message =
          planned.reason === 'no_token'
            ? `「${logicalModel}」的 Key 还未配置`
            : planned.reason === 'policy_excluded'
              ? `「${logicalModel}」已被当前路由范围排除`
              : `没有可用的模型服务提供「${logicalModel}」：请在模型服务里勾选该模型或补好模型映射`
        return { ok: false, message }
      }
      const candidates = runRouteCandidatesOf(planned.plan)
      const first = candidates[0]
      if (!first) {
        return {
          ok: false,
          message: `没有可用的模型服务提供「${logicalModel}」`,
        }
      }
      const route: AgentChatRoute = {
        channelId: first.channelId,
        ...(first.credentialGroupId
          ? { credentialGroupId: first.credentialGroupId }
          : {}),
        logicalModel,
        upstreamModel: first.model,
        routePlanId: `${planned.plan.logicalModel}:${planned.plan.capability}:${planned.plan.strategy}`,
        candidates,
      }
      chatRouteRef.current.set(session.id, route)
      return { ok: true, route }
    },
    [allChannels, cachedChatRoute, modelRoute],
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
    const rows = await controller.refresh()
    setList(rows)
    return rows
  }, [controller])

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
      const defaultSkillId = await presets.loadAgentDefaultSkill()
      if (!alive) return
      if (rows.length > 0) {
        const head = rows[0]!
        if (!head.skillId && defaultSkillId) {
          const next = await sessions.updateFields(head.id, { skillId: defaultSkillId })
          const resolved = next ?? { ...head, skillId: defaultSkillId }
          setList([resolved, ...rows.slice(1)])
          setCurrent(resolved)
          setMessages(resolved.messages)
        } else {
          setCurrent(head)
          setMessages(head.messages)
        }
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
        panelModelOptions(category).filter(
          (n) => channelIdForLogical(liveEnabled, n) !== undefined,
        )
      const liveModelOptions = panelModelOptions('chat')
      const saved = await presets.loadAgentDefault()
      const savedModel = toLogicalName(liveChannels, saved?.model ?? '')
      const created = await sessions.create({
        projectId,
        channelId: '',
        model: defaultModelFor(liveModelOptions, savedModel),
        imageModel: livePick('image')[0] ?? '',
        videoModel: livePick('video')[0] ?? '',
        skillId: defaultSkillId || undefined,
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
  }, [
    messages,
    status,
    current?.taskPlan,
    current?.queuedTurns.length,
    current?.pendingSteers.length,
  ])

  const persist = useCallback(
    async (session: AgentSession, next: ChatMessage[]) => {
      await sessions.saveMessages(session.id, next)
      await refresh()
    },
    [sessions, refresh],
  )

  const switchTo = useCallback(
    async (session: AgentSession) => {
      setCurrent(session)
      // 记忆隔离：切会话就是**换一整套上下文**，不是接着上一个聊（§8.2）
      setMessages(session.messages)
      /** 不再重置 status：每个会话有自己的运行态，切过去看到的是**它自己**那一份 */
      setDraft('')
      // 换了会话，之前「准备好删了」的那个状态不该跟过来
      setRenaming(false)
      setConfirmDelete(false)
      /**
       * **「上次用过的模型」也要跟着换会话重置**：那是**这段对话**的记忆，
       * 带过来的话新会话第一次建节点就会莫名沿用上一段对话选的模型。
       */
      stickyModelRef.current = {}
      setQueueExpanded(false)
    },
    [],
  )

  /**
   * **agent 建节点时「跟随选中」**（用户 2026-10-16：「改成跟随选中」）。
   *
   * 先在画布上选中一张香蕉 2 的图、再说「照这个再出五张」，agent 就该用香蕉 2 ——
   * 而不是 Agent 面板里那个「模型清单第一个」的默认值。真机上就是这一步错成
   * GPT Image 2.5 的（用户看到的是「它给我建的工作流模型不对」）。
   *
   * 按类别取：选中视频节点时不要把它当图片模型用（图片的 `mode` + 视频的 `model`
   * 这种组合发出去只会得到一句看不懂的报错）。
   */
  const selectedModelOf = useCallback(
    (kind: 'image' | 'video'): string => {
      for (const id of selection) {
        const n = store.getSnapshot().nodes.find((x) => x.id === id)
        if (!n) continue
        const d = n.data as { model?: unknown }
        const m = typeof d.model === 'string' ? d.model.trim() : ''
        if (!m) continue
        const category = capabilityOfLogical(allChannels, m)?.category
        if (kind === 'video' ? category === 'video' : category !== 'video') return m
      }
      return ''
    },
    [selection, store, allChannels],
  )

  const toolCtx = useCallback(
    (
      origin: { x: number; y: number },
      sessionId: string = current?.id ?? '',
    ): AgentToolContext => ({
      store,
      memoryContext: {
        workbench: 'canvas',
        projectId: store.getSnapshot().projectId,
        ...(sessionId ? { sessionId } : {}),
      },
      ...(sessionId
        ? {
            taskPlan: {
              get: async () => (await sessions.get(sessionId))?.taskPlan,
              save: async (plan) => {
                const next = await sessions.updateFields(sessionId, {
                  taskPlan: plan,
                })
                if (next) {
                  setList((prev) =>
                    prev.map((item) => (item.id === next.id ? next : item)),
                  )
                  if (currentIdRef.current === next.id) setCurrent(next)
                }
                return next?.taskPlan ?? null
              },
            },
          }
        : {}),
      origin,
      selectedIds: () => selection,
      selectedModelOf,
      ...(abortRefs.current.get(sessionId)?.signal
        ? { signal: abortRefs.current.get(sessionId)!.signal }
        : {}),
      /**
       * 用 **ref** 而不是闭包变量：这个回调在发消息那一刻创建、在用户点「批准」时才真正执行
       * （中间隔着一次确认），闭包里的旧值必然过期。ref 读的是**最新一次发消息**算出来的判断。
       */
      ...(perImageRef.current ? { perImage: true } : {}),
      resolveNodeIds: (ids) => {
        const aliases = planAliasesRef.current.get(sessionId)
        return ids.map((id) => aliases?.get(id) ?? id)
      },
      runNodes: async (ids, signal) => {
        /**
         * **互不依赖的节点同时跑**（用户 2026-10-05 第 2 条：「我并行的要求没有给我实现，
         * 应该是同时生成的，但是他是先生成一个再生成另外一个」）。
         *
         * 原先是 `for (const id of ids) await …` —— 一次 `runNode([A, B])` 就算 A、B
         * 毫无关系也要排成一条队，出两张图花两倍时间。现在按依赖切波：同一波 `Promise.all`
         * 并发发请求，下一波等上一波（`A 出图 → B 优化` 这种真依赖仍然保序）。
         */
        /**
         * 节点 id → 名字。面板与模型都该看到「作品集总封面」而不是
         * `node_0544f492-…`（用户 2026-10-14）。查不到就返回空串，
         * 由展示侧退回 id，绝不编造名字。
         */
        const titleOf = (id: string): string => {
          const node = store.getSnapshot().nodes.find((n) => n.id === id)
          const data = (node?.data ?? {}) as { title?: unknown }
          return (
            (node?.title ?? '').trim() ||
            (typeof data.title === 'string' ? data.title.trim() : '')
          )
        }
        const waves = runWaves(ids, store.getSnapshot().edges)
        const out: Awaited<ReturnType<AgentToolContext['runNodes']>> = []
        for (const wave of waves) {
          /**
           * 执行层跑完会清理节点状态，`execution.nodeStates` 里看不见失败；
           * 唯一可靠的真源是 `runRecords`。跑前记下已有记录 id，跑后只认这批新记录。
           *
           * 同一波内的节点**全部同时发起**：每条 `runNode` 都是独立 API 请求，
           * 渠道本身支持并发，不能在这里擅自限流。
           */
          const projectId = store.getSnapshot().projectId
          const beforeRows = (await platform.storage.query('runRecords', {
            projectId,
          })) as unknown as RunRecord[]
          const beforeIds = new Set(beforeRows.map((record) => record.id))
          const thrown = await Promise.all(
            wave.map(async (id) => {
              try {
                await execution.runNode(id, {
                  signal:
                    signal ?? abortRefs.current.get(sessionId)?.signal,
                })
                return null
              } catch (e) {
                return {
                  nodeId: id,
                  ok: false,
                  error: e instanceof Error ? e.message : errText(e),
                }
              }
            }),
          )
          // 运行记录与资产写入可能仍在画布 store 的防抖队列里；先等同一批落库，
          // 再按新记录对账，避免把已经出图的节点误报成“没有留下记录”。
          await store.flush()
          /**
           * flush 之后通常第一轮就能读到全部新记录。保留短重试只兜底外部存储
           * 的提交可见性延迟，不重发任何付费请求。
           * 这里只等**本次新记录**，不会重发任何付费请求。
           */
          let outcomes: ReturnType<typeof agentRunOutcomeOf>[] = []
          for (let attempt = 0; attempt < 6; attempt += 1) {
            const afterRows = (await platform.storage.query('runRecords', {
              projectId,
            })) as unknown as RunRecord[]
            outcomes = wave.map((id, index) => {
              const failure = thrown[index]
              const base = failure ?? agentRunOutcomeOf(afterRows, id, beforeIds)
              const title = titleOf(id)
              return title ? { ...base, title } : base
            })
            if (!outcomes.some((outcome) => outcome.error?.includes('没有留下记录'))) break
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          out.push(...outcomes)
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
        /**
         * ⚠️ **渠道必须跟着「最终那个模型」走**。
         *
         * 用户 2026-10-03 报：「我选了模型，它就该用那个模型」——但 agent 建的节点
         * 落成了 `model: "Agnes Video 2.0"` + `channelId: Comfy-gpt`，请求被中转站
         * 转发到 Agnes，回的是 Agnes 的「预扣费不足」，画布上什么都拿不到。
         *
         * 根因就在这一行：原来只看**面板里选的那一档**（那次是空的，于是拿默认配方
         * 的渠道），而**计划里模型自己写了 model** —— 计划数据在 `buildLandingCommand`
         * 里最后压上去，于是「模型是计划的、渠道是默认的」，两半拼出一个不存在的组合。
         *
         * 现在：计划里写了模型就以它为准去**反查渠道**；没写才用面板里选的那一档。
         */
        const planned = typeof node.data.model === 'string' ? node.data.model.trim() : ''
        /**
         * 优先级（用户 2026-10-16 定的口径）：
         *   ① 计划点名 —— 你在对话框里说了模型，就用它；
         *   ② **本会话上次用过的那个模型** —— 你不说就一直沿用（连续迭代就是这么来的）；
         *   ③ 画布上选中的那个节点用的模型 —— 会话还没有历史时的起点；
         *   ④ `undefined` —— 保持渠道默认配方不动。
         *
         * ② 在 ③ 之上是有意的：同一段对话里用户已经交代过一次模型，后面没说就是「还用那个」，
         * 不该因为中途点选了别的节点而自己换掉。
         */
        const stored = stickyModelRef.current[kind] ?? (kind === 'video' ? current?.videoModel : current?.imageModel)
        const model = planned || stored || selectedModelOf(kind)
        if (!model) return undefined
        const channelId = channelIdForLogical(enabled, model, current?.channelId)
        if (!channelId) return undefined
        /**
         * 这次真正用上的模型记下来：ref 管本轮下一轮立刻生效，落库那份管重开还在。
         * 只在**真的变了**时才写，免得每建一次节点就落一次库。
         */
        if (model !== stored) {
          stickyModelRef.current[kind] = model
          if (current) {
            void sessions.updateFields(
              current.id,
              kind === 'video' ? { videoModel: model } : { imageModel: model },
            )
          }
        }
        return { channelId, model }
      },
      channelIdForModel: (model) => channelIdForLogical(enabled, model),
      /**
       * 模型名 → 类别：给 `applyPlan` 纠正 `mode` 用（见 `alignGenerationMode`）。
       *
       * 真模型会把视频节点写成 `mode:"image"`，只写对 `model`；执行层按 `mode` 分链，
       * 不纠正就是「点了生成一个请求都不发」。
       */
      categoryOfModel: (model) => {
        const category = capabilityOfLogical(allChannels, model)?.category
        return category === 'audio' || category === 'unknown' ? undefined : category
      },
      sliceImage: (nodeId, mode, rect, ratio) => {
        const run = mode === 'crop' ? cropAsset : extractSelection
        return run({ platform, store }, { nodeId, rect, ...(ratio ? { ratio } : {}) })
      },
      splitGrid: (nodeId, rows, cols) =>
        splitNodeToGrid({ platform, store }, { nodeId, rows, cols }),
      rememberMemory: async (candidate) => {
        try {
          const saved = await memory.remember(candidate)
          return {
            ok: true,
            memoryId: saved.id,
            text: saved.text,
          }
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : errText(error),
          }
        }
      },
    }),
    [
      store,
      selection,
      execution,
      channels,
      current,
      enabled,
      allChannels,
      selectedModelOf,
      sessions,
      platform,
      memory,
    ],
  )

  /**
   * 确认型工具只执行一次。
   *
   * 工具结果写在同一 Job 的不可变事件流水里，应用崩溃或确认按钮被再次触发时：
   * - 已完成：直接回放上次结果；
   * - 已开始未完成：转 needs_attention，不自动重发；
   * - 相同 callId 却换了参数：按失败处理，避免把两次不同操作混成一次。
   */
  const executeToolWithLedger = useCallback(
    async (
      session: AgentSession,
      request: AgentToolRequest,
      execute: () => Promise<unknown>,
    ): Promise<unknown> => {
      const jobId =
        controller.jobId(session.id) ??
        (await jobs.active(session.id))?.id
      if (!jobId) {
        return execute()
      }
      const latest = (await sessions.get(session.id)) ?? session
      const stepId = latest.taskPlan?.currentStepId ?? 'unplanned'
      const outcome = await toolEffects.run({
        jobId,
        stepId,
        toolCallId: request.callId,
        toolName: request.name,
        args: request.args,
        execute,
      })
      if (outcome.kind === 'completed') {
        if (outcome.replayed) {
          store.notify('已复用这次工具调用的持久结果，没有重复执行或扣费', 'info')
        }
        return outcome.result
      }
      if (outcome.kind === 'pending') {
        throw new AgentToolEffectBlockedError(
          outcome.reason,
          'needs_attention',
          outcome,
        )
      }
      throw new AgentToolEffectBlockedError(
        outcome.kind === 'conflict' ? outcome.reason : outcome.error,
        'failed',
        outcome,
      )
    },
    [controller, jobs, sessions, store, toolEffects],
  )

  const executeConfirmedToolWithLedger = useCallback(
    (session: AgentSession, request: AgentToolRequest): Promise<unknown> =>
      executeToolWithLedger(session, request, () =>
        executeConfirmedTool(
          request.name,
          request.args,
          toolCtx(originOf(viewport)),
        ),
      ),
    [executeToolWithLedger, toolCtx, viewport],
  )

  const loopDeps = useCallback(
    (
      session: AgentSession,
      operationId: string,
      toolMode: 'native' | 'json' = 'native',
      visualNodeIds: readonly string[] = [],
    ) => {
      const route = cachedChatRoute(session)
      const logicalModel =
        route?.logicalModel ?? (toLogicalName(allChannels, session.model) || session.model)
      const imageNodeIds = [...new Set(visualNodeIds)]
      const inputs = imageNodeIds.flatMap((nodeId): NodeInput[] => {
        const node = store.getSnapshot().nodes.find((item) => item.id === nodeId)
        const data = node?.data as {
          assetHash?: unknown
          assetMime?: unknown
          naturalSize?: { width: number; height: number }
        }
        if (!node || typeof data?.assetHash !== 'string') return []
        return [{
          kind: 'asset',
          nodeId: node.id,
          assetHash: data.assetHash,
          mime: typeof data.assetMime === 'string' ? data.assetMime : 'image/png',
          ...(data.naturalSize ? { naturalSize: data.naturalSize } : {}),
        }]
      })
      const contextAssets =
        contextTraceRef.current.get(session.id)?.assetRefs ?? []
      const existingAssetHashes = new Set(
        inputs.flatMap((input) =>
          input.kind === 'asset' ? [input.assetHash] : [],
        ),
      )
      for (const asset of contextAssets) {
        if (existingAssetHashes.has(asset.hash)) continue
        existingAssetHashes.add(asset.hash)
        inputs.push({
          kind: 'asset',
          nodeId: `context-kit:${asset.hash}`,
          assetHash: asset.hash,
          mime: asset.mime,
        })
      }
      const traceOf = (
        req: TextRunRequest,
        purpose: 'agent' | 'agent-tool-probe',
      ) => {
        const context = contextTraceRef.current.get(session.id)
        return directTextTrace({
          projectId: store.getSnapshot().projectId,
          workbench: 'canvas',
          subjectId: session.id,
          scopeId: `session:${session.id}`,
          operationId,
          purpose,
          channelId: req.channelId,
          model: req.model,
          prompt: req.prompt,
          inputs: req.inputs,
          params: {
            toolMode,
            messageCount: req.messages?.length ?? 0,
            ...(context
              ? {
                  contextDigest: context.digest,
                  memoryRefs: context.memoryRefs,
                  kitVersionRefs: context.kitVersionRefs,
                }
              : {}),
          },
        })
      }
      const onRecordWarning = (warning: string) =>
        store.notify(`结果已返回，但运行记录写入失败：${warning}`, 'error')
      const onRouteSucceeded = (selected: DirectRunRouteCandidate) => {
        if (!route) return
        route.channelId = selected.channelId
        route.upstreamModel = selected.model
        if (selected.credentialGroupId) {
          route.credentialGroupId = selected.credentialGroupId
        } else {
          delete route.credentialGroupId
        }
        route.candidates = [
          selected,
          ...route.candidates.filter(
            (candidate) =>
              candidate.channelId !== selected.channelId ||
              candidate.credentialGroupId !== selected.credentialGroupId ||
              candidate.model !== selected.model,
          ),
        ]
      }
      const runVisualReview = async (review: {
        nodeIds: readonly string[]
        checklist?: string
      }): Promise<VisualReviewResult> => {
        const graph = store.getSnapshot()
        const aliases = planAliasesRef.current.get(session.id)
        const requestedIds = [
          ...new Set(review.nodeIds.map((id) => aliases?.get(id) ?? id)),
        ]
        const targetNodeIds = requestedIds.slice(0, 8)
        const limitations: string[] = []
        if (requestedIds.length > targetNodeIds.length) {
          limitations.push(
            `本次只验收前 ${targetNodeIds.length} 张，另有 ${
              requestedIds.length - targetNodeIds.length
            } 张未提交。`,
          )
        }
        if (!route) {
          return {
            ok: false,
            verdict: 'unreviewable',
            summary: '当前回合没有可用的视觉验收模型路由',
            issues: [],
            targetNodeIds,
            referenceAssetCount: 0,
            suiteContextAvailable: false,
            limitations: [...limitations, '请确认对话模型已配置并且支持图片输入'],
          }
        }

        const trace = contextTraceRef.current.get(session.id)
        const prepared = await prepareVisualReviewImages({
          graph,
          nodeIds: targetNodeIds,
          contextAssets: trace?.assetRefs,
          readAsset: (hash) => platform.assets.read(hash),
        })
        limitations.push(...prepared.limitations)
        const suiteContextAvailable =
          (trace?.kitVersionRefs.length ?? 0) > 0 ||
          prepared.referenceAssetCount > 0

        if (prepared.targets.length === 0) {
          return {
            ok: false,
            verdict: 'unreviewable',
            summary: '没有可读取的目标图片，未执行视觉验收',
            issues: [],
            targetNodeIds,
            referenceAssetCount: prepared.referenceAssetCount,
            suiteContextAvailable,
            limitations,
          }
        }

        const prompt = buildVisualReviewPrompt({
          targets: prepared.targets,
          ...(review.checklist ? { checklist: review.checklist } : {}),
          ...(trace?.brief ? { context: trace.brief } : {}),
          referenceAssetCount: prepared.referenceAssetCount,
          suiteContextAvailable,
        })
        const reviewInputs = [...prepared.targetInputs, ...prepared.contextInputs]
        try {
          const reviewed = await routeExecution.execute({
            channelId: route.channelId,
            model: route.upstreamModel,
            modelIsUpstream: true,
            tools: [],
            messages: [
              { role: 'system', content: VISUAL_REVIEW_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            inputs: reviewInputs,
            signal:
              abortRefs.current.get(session.id)?.signal ??
              new AbortController().signal,
            routeCandidates: route.candidates,
            routePlanId: route.routePlanId,
            trace: directTextTrace({
              projectId: graph.projectId,
              workbench: 'canvas',
              subjectId: session.id,
              scopeId: `session:${session.id}`,
              operationId,
              purpose: 'agent-visual-review',
              channelId: route.channelId,
              model: route.upstreamModel,
              prompt,
              inputs: reviewInputs,
              params: {
                targetNodeIds,
                referenceAssetCount: prepared.referenceAssetCount,
                checklist: review.checklist ?? '',
              },
            }),
            onRecordWarning,
            onRouteSucceeded,
          })
          const parsed = parseVisualReviewText(reviewed.text, prepared.targets)
          const finalized = finalizeVisualReviewResult(parsed, {
            suiteContextAvailable,
          })
          return {
            ...finalized,
            referenceAssetCount: prepared.referenceAssetCount,
            limitations: [...limitations, ...finalized.limitations],
          }
        } catch (error) {
          return {
            ok: false,
            verdict: 'unreviewable',
            summary: `视觉验收请求失败：${errText(error)}`,
            issues: [],
            targetNodeIds,
            referenceAssetCount: prepared.referenceAssetCount,
            suiteContextAvailable,
            limitations,
          }
        }
      }
      return {
        adapter: {
          completeText: (req: TextRunRequest, signal: AbortSignal) =>
            routeExecution.execute({
              channelId: route?.channelId ?? req.channelId,
              model: route?.upstreamModel ?? req.model,
              modelIsUpstream: Boolean(route),
              tools: req.tools ?? (toolMode === 'native' ? AGENT_TOOLS : []),
              messages: req.messages ?? [],
              inputs: req.inputs,
              signal,
              ...(route
                ? {
                    routeCandidates: route.candidates,
                    routePlanId: route.routePlanId,
                  }
                : {}),
              trace: traceOf(req, 'agent'),
              onRecordWarning,
              ...(route ? { onRouteSucceeded } : {}),
            }),
        },
        channelId: route?.channelId ?? '',
        model: logicalModel,
        tools: toolMode === 'native' ? AGENT_TOOLS : [],
        toolMode,
        inputs,
      /**
       * 确认**之前**的预检（用户 2026-10-02：「重复让我确认新建工作流，重复了三次，
       * 但是我的画布中没有」）。计划本身落不了地时，别让用户白点一次确认 ——
       * 直接把问题回给模型，让它在同一轮里自己改；同一轮里它要是还发同一版，
       * 循环自己的指纹刹车会把这一轮停下来。
       */
      precheck: (name: string, args: unknown) => {
        if (name === 'proposeTaskPlan') {
          const normalized = normalizeTaskPlanProposal(args, {
            id: 'precheck-plan',
            now: Date.now(),
          })
          return normalized.ok
            ? { ok: true as const }
            : {
                ok: false as const,
                result: { ok: false, problems: normalized.problems },
              }
        }
        if (name !== 'runNode' && name !== 'runFrom') return { ok: true as const }
        /** 节点不在画布、没渠道 / 模型 / 提示词时，别让用户点「批准运行」 */
        const args2 = (args ?? {}) as { nodeIds?: unknown }
        const aliases = planAliasesRef.current.get(session.id)
        const requested = (Array.isArray(args2.nodeIds) ? args2.nodeIds.map(String) : []).map(
          (id) => aliases?.get(id) ?? id,
        )
        const graph = store.getSnapshot()
        let targets = requested
        if (name === 'runFrom') {
          const resolved = runFromNodeIds(store, requested)
          if (!resolved.ok) return { ok: false as const, result: resolved }
          targets = resolved.ids
        }
        const problems = runPreflightProblems(
          targets,
          graph,
          channels.getState().channels,
          channels.protocolCatalog(),
        )
        return problems.length > 0
          ? { ok: false as const, result: { ok: false, problems } }
          : { ok: true as const }
      },
      /**
       * 建图类（applyPlan）**直接落地**，不等确认 —— 用户 2026-10-02 的口径：
       * 「他直接给我新建进去，但是生成与否需要让我确认，取消后也不会撤回
       * 已经新建到画布中的工作流」。
       */
      executeWrite: async (name: string, args: unknown, callId: string) => {
        const result = await executeToolWithLedger(
          session,
          { callId, name, args },
          () =>
            executeConfirmedTool(
              name,
              args,
              toolCtx(originOf(viewport), session.id),
            ),
        )
        if (name === 'applyPlan') {
          const resolved = (result as { resolvedNodes?: { localId?: unknown; nodeId?: unknown }[] })
            .resolvedNodes
          if (Array.isArray(resolved)) {
            planAliasesRef.current.set(
              session.id,
              new Map(
                resolved.flatMap((node) =>
                  typeof node.localId === 'string' && typeof node.nodeId === 'string'
                    ? [[node.localId, node.nodeId] as const]
                    : [],
                ),
              ),
            )
          }
        }
        return result
      },
      executeRead: (name: string, args: unknown, callId: string) => {
        const base = toolCtx(originOf(viewport), session.id)
        return executeToolWithLedger(session, { callId, name, args }, () =>
          executeReadTool(name, args, {
            ...base,
            ...(name === 'visualReview' ? { visualReview: runVisualReview } : {}),
          }),
        )
      },
      takeSteering: async () => {
        try {
          const latest = await sessions.get(session.id)
          const delivered =
            deliveredSteersRef.current.get(session.id) ?? new Set<string>()
          const pending = (latest?.pendingSteers ?? []).filter(
            (steer) => !delivered.has(steer.id),
          )
          if (pending.length === 0) return []
          const active = await jobs.active(session.id).catch(() => null)
          if (active) {
            await Promise.all(
              pending.map((steer) =>
                jobs
                  .appendEvent(active.id, 'steer_applied', {
                    steerId: steer.id,
                    textLength: steer.text.length,
                  })
                  .catch(() => null),
              ),
            )
          }
          for (const steer of pending) delivered.add(steer.id)
          deliveredSteersRef.current.set(session.id, delivered)
          return steerMessagesOf(pending, stripMentionMarkup)
        } catch {
          return []
        }
      },
        signal: abortRefs.current.get(session.id)?.signal ?? new AbortController().signal,
      }
    },
    [
      allChannels,
      channels,
      cachedChatRoute,
      viewport,
      toolCtx,
      store,
      sessions,
      jobs,
      executeToolWithLedger,
      routeExecution,
    ],
  )

  /** 把循环的结果落到界面上：回答就显示，要确认就出预览卡，刹车/报错就说清楚 */
  const handleOutcome = useCallback(
    async (
      session: AgentSession,
      outcome: AgentLoopOutcome,
      hidden: readonly ChatMessage[] = [],
    ) => {
      const outcomeController = abortRefs.current.get(session.id)
      const outcomeIsCurrent = () =>
        outcomeController !== undefined &&
        abortRefs.current.get(session.id) === outcomeController &&
        !outcomeController.signal.aborted
      if (!outcomeIsCurrent()) return
      /**
       * 消息只写回**它自己那个会话的界面**：用户可能已经切走去看别的会话了，
       * 这时候把 A 的消息盖到 B 的对话流上就是串味（§8.2）。
       * 落库（`persist`）与是否切走无关，一律照做。
       *
       * `hidden` = 这次**没发给模型**的那段更早历史（回读窗口之外，用户 2026-10-14）。
       * 界面与落库都要把它拼回去 —— 窗口只约束「模型看多少」，
       * 不该让用户回看时缺一段。
       */
      const full: ChatMessage[] =
        hidden.length > 0
          ? [
              ...(outcome.messages[0] ? [outcome.messages[0]] : []),
              ...hidden,
              ...outcome.messages.slice(1),
            ]
          : outcome.messages
      const settleStaleOutcome = async () => {
        if (outcome.kind === 'confirm') {
          await sessions
            .saveMessages(
              session.id,
              confirmationSettlementMessages(
                full,
                outcome.request,
                'interrupted',
              ),
            )
            .catch(() => null)
        }
        await sessions
          .updateFields(session.id, {
            pendingConfirmation: undefined,
            continuation: undefined,
          })
          .catch(() => null)
      }
      if (currentIdRef.current === session.id) setMessages(full)
      await persist(session, full)
      if (!outcomeIsCurrent()) {
        await settleStaleOutcome()
        return
      }
      const pendingConfirmation =
        outcome.kind === 'confirm'
          ? {
              callId: outcome.request.callId,
              name: outcome.request.name,
              args: outcome.request.args,
            }
          : undefined
      const continuation =
        outcome.kind === 'stopped' && outcome.checkpoint
          ? {
              reason: outcome.checkpoint.kind,
              maxSteps: outcome.checkpoint.maxSteps,
              createdAt: Date.now(),
              ...(activeQueueTurnOf(session.id)
                ? { queuedTurnId: activeQueueTurnOf(session.id) }
                : {}),
            }
          : undefined
      let latest = await sessions.updateFields(session.id, {
        pendingConfirmation,
        continuation,
      })
      if (!outcomeIsCurrent()) {
        await settleStaleOutcome()
        return
      }
      const deliveredSteerIds = [
        ...(deliveredSteersRef.current.get(session.id) ?? []),
      ]
      if (deliveredSteerIds.length > 0) {
        latest = await sessions.removeSteers(session.id, deliveredSteerIds)
        deliveredSteersRef.current.delete(session.id)
      }
      if (outcome.kind === 'confirm') {
        await transitionSessionJob(
          session.id,
          'waiting_confirmation',
          'confirmation_requested',
          { pendingCallId: outcome.request.callId },
          { tool: outcome.request.name },
        )
      } else if (outcome.kind === 'stopped' && outcome.checkpoint) {
        await transitionSessionJob(
          session.id,
          'paused',
          'checkpoint_saved',
          {
            checkpoint: {
              kind: outcome.checkpoint.kind,
              maxSteps: outcome.checkpoint.maxSteps,
              completedSteps: outcome.checkpoint.completedSteps,
              savedAt: Date.now(),
            },
          },
        )
      } else if (outcome.kind === 'error' && outcome.needsAttention) {
        await transitionSessionJob(
          session.id,
          'needs_attention',
          'tool_failed',
          {
            lastError: outcome.needsAttention.reason,
            ...(outcome.needsAttention.toolCallId
              ? { pendingCallId: outcome.needsAttention.toolCallId }
              : {}),
          },
          {
            phase: 'tool_effect_pending',
            reason: outcome.needsAttention.reason,
          },
        )
      } else if (outcome.kind === 'message') {
        await transitionSessionJob(session.id, 'completed', 'completed')
      } else {
        await transitionSessionJob(
          session.id,
          'failed',
          'failed',
          {
            lastError:
              outcome.kind === 'error' ? outcome.message : outcome.reason,
          },
          {
            reason:
              outcome.kind === 'error' ? outcome.message : outcome.reason,
          },
        )
      }
      if (!outcomeIsCurrent()) {
        await settleStaleOutcome()
        return
      }
      if (
        outcome.kind === 'message' ||
        outcome.kind === 'error' ||
        (outcome.kind === 'stopped' && !outcome.checkpoint)
      ) {
        abortRefs.current.delete(session.id)
      }
      if (latest) {
        setList((prev) => prev.map((item) => (item.id === latest.id ? latest : item)))
        if (currentIdRef.current === latest.id) setCurrent(latest)
      }
      if (outcome.kind === 'message') {
        setStatusFor(session.id, IDLE_STATUS)
      }
      else if (outcome.kind === 'confirm') {
        setStatusFor(session.id, { kind: 'awaitingConfirm', request: outcome.request })
      } else if (outcome.kind === 'stopped' && outcome.checkpoint) {
        setStatusFor(session.id, {
          kind: 'paused',
          message: `已完成 ${outcome.checkpoint.maxSteps} 步，可继续`,
        })
      } else if (outcome.kind === 'stopped') {
        setStatusFor(session.id, { kind: 'error', message: outcome.reason })
      } else setStatusFor(session.id, { kind: 'error', message: outcome.message })
    },
    [jobs, persist, sessions, setStatusFor, transitionSessionJob],
  )

  const applySessionSnapshot = useCallback((next: AgentSession) => {
    setList((prev) => prev.map((item) => (item.id === next.id ? next : item)))
    if (currentIdRef.current === next.id) setCurrent(next)
  }, [])

  /**
   * 真正干活的那一段：**接收正文本身**，不读 `draft`。
   *
   * 这样「重试」才能复用同一条路（用户 2026-10-14 第 1 条：助手回复下方要有
   * 复制 / 重试）。重试要拿的是**上一条用户消息**，而不是输入框里此刻的内容。
   */
  /**
   * 自动模式统一续跑入口。
   *
   * 初次发送、用户在确认卡上切自动、检查点“继续任务”都必须走这里；
   * 否则某条入口只确认了当前一张卡，下一张又会重新弹出来。
   */
  const continueAutoConfirmations = useCallback(async (
    session: AgentSession,
    initial: AgentLoopOutcome,
    currentLoopDeps: AgentLoopDeps,
    onMessages: (next: ChatMessage[]) => void,
  ): Promise<AgentLoopOutcome> => {
    let outcome = initial
    let autoSteps = 0
    while (
      outcome.kind === 'confirm' &&
      autoRunRef.current.get(session.id) === true &&
      !confirmationRequiresExplicitApproval(
        outcome.request.name,
        outcome.request.args,
      ) &&
      autoSteps < AUTO_RUN_LIMIT
    ) {
      autoSteps += 1
      const runsGeneration = confirmationRunsGeneration(outcome.request.name)
      if (runsGeneration) {
        await transitionSessionJob(
          session.id,
          'waiting_generation',
          'generation_started',
          { pendingCallId: outcome.request.callId },
          { tool: outcome.request.name, auto: true },
        )
      }
      setStatusFor(session.id, { kind: 'executing', tool: outcome.request.name })
      const done = await executeConfirmedToolWithLedger(session, outcome.request)
      onMessages(outcome.messages)
      if (runsGeneration) {
        await controller.finishConfirmedTool(session.id, outcome.request)
      }
      outcome = await resumeAgentTurn(
        outcome.messages,
        outcome.request.callId,
        done,
        currentLoopDeps,
        outcome.request.name,
      )
    }
    if (
      outcome.kind === 'confirm' &&
      autoRunRef.current.get(session.id) === true &&
      autoSteps >= AUTO_RUN_LIMIT &&
      !confirmationRequiresExplicitApproval(
        outcome.request.name,
        outcome.request.args,
      )
    ) {
      outcome = {
        kind: 'stopped',
        reason:
          `自动执行已连续完成 ${AUTO_RUN_LIMIT} 个动作，已安全暂停；` +
          '点击“继续任务”可接着执行，不会把下一步变成新的付费确认卡。',
        messages: outcome.messages,
        checkpoint: {
          kind: 'max_steps',
          maxSteps: AUTO_RUN_LIMIT,
          completedSteps: AUTO_RUN_LIMIT,
        },
      }
    }
    return outcome
  }, [
    controller,
    executeConfirmedToolWithLedger,
    setStatusFor,
    transitionSessionJob,
  ])

  const runSendText = useCallback(async (
    text: string,
    session: AgentSession,
    queuedSession?: AgentSession,
    turnId?: string,
  ) => {
    if (!session.model) {
      setStatusFor(session.id, { kind: 'error', message: '还没选模型：先在上面选一个对话模型' })
      return
    }
    if (
      session.taskPlan &&
      agentTaskPlanProgress(session.taskPlan).status !== 'active'
    ) {
      const cleared = await sessions.updateFields(session.id, {
        taskPlan: undefined,
      })
      if (cleared) {
        setList((prev) =>
          prev.map((item) => (item.id === cleared.id ? cleared : item)),
        )
        if (currentIdRef.current === cleared.id) setCurrent(cleared)
      }
    }
    const prepared = await prepareChatRoute(session, true)
    if (!prepared.ok) {
      setStatusFor(session.id, { kind: 'error', message: prepared.message })
      return
    }
    const chatRoute = prepared.route
    const operationId = createId('op')
    await ensureAgentJob(session, turnId ?? createId('turnmsg'))
    await transitionSessionJob(
      session.id,
      'planning',
      'status_changed',
      { operationId },
    )
    const controller = new AbortController()
    abortRefs.current.set(session.id, controller)
    setStatusFor(session.id, { kind: 'thinking' })
    autoRunRef.current.set(session.id, session.autoRun === true)

    let contextPrompt = ''
    const cleanRequest = stripMentionMarkup(text)
    try {
      const bundle = await memory.read({
        projectId: store.getSnapshot().projectId,
        workbench: 'canvas',
        request: cleanRequest,
        sessionId: session.id,
      })
      contextTraceRef.current.set(session.id, {
        digest: bundle.digest,
        memoryRefs: bundle.memoryRefs,
        kitVersionRefs: bundle.kitVersionRefs,
        assetRefs: (
          await Promise.all(
            bundle.assetHashes.map(async (hash) => {
              const payload = await platform.assets.read(hash).catch(() => null)
              return payload ? { hash, mime: payload.mime } : null
            }),
          )
        ).filter(
          (asset): asset is { hash: string; mime: string } => asset !== null,
        ),
      })
      if (bundle.conflicts.length > 0) {
        const message = `上下文有冲突，请先处理：${bundle.conflicts
          .map((conflict) => conflict.message)
          .join('；')}`
        await transitionSessionJob(
          session.id,
          'failed',
          'failed',
          { lastError: message },
          { phase: 'context_conflict' },
        )
        setStatusFor(session.id, { kind: 'error', message })
        return
      }
      contextPrompt = formatContextBundleForPrompt(bundle)
      const trace = contextTraceRef.current.get(session.id)
      if (trace) trace.brief = contextPrompt
      const memoryCandidate = memoryCandidateFromText(cleanRequest, {
        workbench: 'canvas',
        projectId: store.getSnapshot().projectId,
        sessionId: session.id,
      })
      if (memoryCandidate) {
        contextPrompt +=
          `\n\n## 检测到长期记忆候选\n` +
          `用户本轮可能要求长期记住以下内容。若要保存，必须调用 rememberMemory 交给系统确认，不能直接在回复里声称已记住。\n` +
          JSON.stringify({
            text: memoryCandidate.text,
            kind: memoryCandidate.kind,
            scope: memoryCandidate.scope,
            ...(memoryCandidate.key ? { key: memoryCandidate.key } : {}),
            ...(memoryCandidate.expiresAt
              ? { expiresInDays: Math.max(1, Math.ceil((memoryCandidate.expiresAt - Date.now()) / 86_400_000)) }
              : {}),
          })
      }
    } catch (error) {
      contextTraceRef.current.delete(session.id)
      store.notify(
        `读取个人记忆或项目套件失败：${errText(error)}`,
        'error',
      )
    }

    /**
     * 发消息前先问一次「这个对话模型到底会不会 tool_calls」。
     *
     * 项目里早有 `probeToolCalling`，但它一直没接到这条路上：模型收到 tools 却不调，
     * 只回一句「我无法调用工具」，Agent 就把这句当最终回答（用户 2026-10-13 截图）。
     * 这里按「渠道 + 模型」探测一次并缓存，结果分三种：
     * - 支持原生 tools → 走多轮 tool_calls；
     * - 模型只是不返回 tool_calls（部分中转 / 对话模型）→ 自动降级到 JSON 工具调用
     *   （设计文档 §7 路线 B），不再要求用户换模型 —— 「对话模型也能调用 agent」是默认预期；
     * - 探测请求本身失败（渠道 / 鉴权 / 限流）→ 如实报错，这种降级也救不了。
     */
    const support = await ensureToolSupport(
      {
        completeText: (req: TextRunRequest, signal: AbortSignal) =>
          routeExecution.execute({
            channelId: chatRoute.channelId,
            model: chatRoute.upstreamModel,
            modelIsUpstream: true,
            tools: req.tools ?? AGENT_TOOLS,
            messages: req.messages ?? [],
            signal,
            routeCandidates: chatRoute.candidates,
            routePlanId: chatRoute.routePlanId,
            trace: directTextTrace({
              projectId: store.getSnapshot().projectId,
              workbench: 'canvas',
              subjectId: session.id,
              scopeId: `session:${session.id}`,
              operationId,
              purpose: 'agent-tool-probe',
              channelId: chatRoute.channelId,
              model: chatRoute.upstreamModel,
              prompt: req.prompt,
              inputs: req.inputs,
              params: {
                messageCount: req.messages?.length ?? 0,
                toolMode: 'probe',
              },
            }),
            onRecordWarning: (warning) =>
              store.notify(`结果已返回，但运行记录写入失败：${warning}`, 'error'),
            onRouteSucceeded: (selected) => {
              chatRoute.channelId = selected.channelId
              chatRoute.upstreamModel = selected.model
              if (selected.credentialGroupId) {
                chatRoute.credentialGroupId = selected.credentialGroupId
              } else {
                delete chatRoute.credentialGroupId
              }
              chatRoute.candidates = [
                selected,
                ...chatRoute.candidates.filter(
                  (candidate) =>
                    candidate.channelId !== selected.channelId ||
                    candidate.credentialGroupId !== selected.credentialGroupId ||
                    candidate.model !== selected.model,
                ),
              ]
            },
            /** 探测自带一个更短的等待上限（见 `PROBE_TIMEOUT_MS`） */
            ...(req.timeoutMs ? { timeoutMs: req.timeoutMs } : {}),
          }),
      },
      { channelId: chatRoute.channelId, model: chatRoute.logicalModel },
      controller.signal,
    )
    if (controller.signal.aborted) return
    const decision = decideToolMode(support)
    if (decision.kind === 'error') {
      setStatusFor(session.id, { kind: 'error', message: decision.message })
      return
    }
    /**
     * 模式按会话记住：后续用户点「确认」或自动生成续跑时都得沿用同一条，
     * 不能因为探测缓存已命中就中途切回原生 tools（那样模型又会「无法调用工具」）。
     */
    const toolMode = decision.mode
    toolModeRef.current.set(session.id, toolMode)
    const sentAssetIds = session.pendingAssetIds ?? []
    if (sentAssetIds.length > 0) {
      const cleared = await sessions.clearPendingAssetIds(session.id, sentAssetIds)
      if (cleared) {
        setList((prev) => prev.map((item) => (item.id === cleared.id ? cleared : item)))
        if (currentIdRef.current === cleared.id) setCurrent(cleared)
      }
    }

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
    const skill = session.skillId ? allSkills.find((s) => s.id === session.skillId) : undefined
    /**
     * 这句话里 @ 引用了什么（节点 / 模型）。空数组就不加那一段。
     *
     * **技能那枚 chip 不算「引用」**：它说的是「这次用哪条技能」，由下面 `skill`
     * 那一段（正文 + 名字）负责讲清楚；再当成引用报一遍，模型会在同一句话里读到
     * 两份同样的东西。正文里那个 token 也会被 `stripMentionMarkup` 还原成技能名。
     */
    const plainText = stripMentionMarkup(text)
    const mentions = parseMentions(text)
      .filter((m): m is MentionRef & { kind: 'node' | 'model' } => m.kind !== 'skill')
      /**
       * 被 @ 的节点**连它上面的提示词一起报给模型**（用户 2026-10-05 第六批：
       * 「换成 3d 风格，但是他前面给我加了前置词小猫钓鱼，结果把内容也换成小猫了」）。
       *
       * 只给节点名的话，模型手里唯一的文字就是那个短名，换风格时就只能拿它当内容 ——
       * 于是「只换风格」变成「重画一只钓鱼的小猫」。带上正文，它才有东西可以「保留」。
       */
      .map((m) => {
        if (m.kind !== 'node') return m
        const n = graph.nodes.find((x) => x.id === m.id)
        const d = (n?.data ?? {}) as { prompt?: unknown; text?: unknown }
        const raw = typeof d.prompt === 'string' ? d.prompt : d.text
        const prompt = typeof raw === 'string' ? raw.trim().slice(0, 160) : ''
        return { ...m, ...(prompt ? { prompt } : {}) }
      })
    /** 用户点选的三档模型里的图片 / 视频那两个（对话模型由 `inherited` 报） */
    const mediaModels = {
      ...(session.imageModel ? { image: session.imageModel } : {}),
      ...(session.videoModel ? { video: session.videoModel } : {}),
    }
    /**
     * 这次 @ 到了几张**有图**的节点 —— 「该不该一张图一条流程」要看**图数**
     * （用户 2026-10-06 第七批 #183：「明明是单独的两个需求他给我替换成了一个需求」）。
     *
     * 单张图无所谓拆不拆，所以判据是「≥2 张、且他没说合并 / 融合」。
     * 算好存进 ref：工具执行可能发生在用户点「批准」之后，那时这里已经出栈了。
     */
    const mentionedImageCount = mentions.filter(
      (m) =>
        m.kind === 'node' &&
        Boolean(
          (graph.nodes.find((n) => n.id === m.id)?.data as { assetHash?: string } | undefined)
            ?.assetHash,
        ),
    ).length
    const perImage = expectsPerImageFlows(plainText, mentionedImageCount)
    perImageRef.current = perImage
    const system = buildAgentSystemPromptWithContext(
      summary,
      { model: chatRoute.logicalModel },
      {
        /**
         * 用户说了「其他保持不变 / 只改 X」→ 给这次规划加一段**硬约束**
         * （用户 2026-10-05 第五批第 2 条：那句要求只留在对话里，没进提示词）。
         * 判据取**去掉引用标记之后**的原文，免得 `@[名字](node:id)` 这类机器标记干扰匹配。
         */
        ...(looksLikePreserveRequest(plainText) ? { preserve: true } : {}),
        /** 「换成 3D / 写实 / 卡通」= 只改风格：内容必须沿用原来的提示词（第六批） */
        ...(looksLikeStyleOnlyRequest(plainText) ? { styleOnly: true } : {}),
        /** 多张图且没说合成 → 每张各自一条流程（第七批 #183） */
        ...(perImage ? { perImage: true } : {}),
        assetIds: sentAssetIds,
        ...(skill ? { skill: { name: skill.name, content: skill.content } } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(Object.keys(mediaModels).length > 0 ? { mediaModels } : {}),
        generationAvailability,
        ...(contextPrompt ? { contextBundle: contextPrompt } : {}),
        ...(session.taskPlan ? { taskPlan: taskPlanPrompt(session.taskPlan) } : {}),
        /** JSON 降级时要把工具声明列进提示词，模型才知道 tool 能填什么（路线 B） */
        ...(toolMode === 'json' ? { jsonToolFallback: true, tools: AGENT_TOOLS } : {}),
      },
    )
    /**
     * **回读窗口**（用户 2026-10-14 参考产品图二「回读轮数」）。
     *
     * 状态里的 `messages` 始终是全量，这里只决定「这次给模型看多少」：窗口之外那段
     * 先扣下来（`hidden`），结果回来时再拼回界面与库里（见 `handleOutcome` 的 `hidden`）。
     *
     * ⚠️ 这条窗口**早就写在 `sessionStore.contextFor` 里**，但面板从来没调用过 ——
     * 所以在此之前发出去的其实是**全部历史**，历史越长请求越重。
     */
    const history = (queuedSession?.messages ?? messages).filter((m) => m.role !== 'system')
    const windowSize = session.contextWindow ?? AGENT_CONTEXT_WINDOW
    const cut = Math.max(0, history.length - windowSize)
    const hidden = history.slice(0, cut)
    const visible = trimOrphanToolMessages(history.slice(cut))
    /** 模型窗口版 → 界面 / 落库用的全量版（把窗口外那段补回 system 之后） */
    const withHidden = (list: readonly ChatMessage[]): ChatMessage[] =>
      hidden.length > 0
        ? [...(list[0] ? [list[0]] : []), ...hidden, ...list.slice(1)]
        : [...list]
    const withSystem: ChatMessage[] = [
      { role: 'system', content: system },
      ...visible,
      /**
       * 发给模型的是**去掉存储形态**的正文：`@[小猫钓鱼](node:node_x)` → `@小猫钓鱼`。
       * 引用指向谁由上面那段 mentions 讲清楚（带 id），正文里不必再夹一串括号。
       *
       * `display` 存的是**用户写的那份原文**（带 chip 标记）：回看这条消息时要还原成
       * 那几个矩形框（用户 2026-10-05 第 5 条）。一份数据两个用途，必须分开存
       * —— 拿 `content` 去渲染，框就没了；拿原文去发请求，模型会读到一串机器标记。
       */
      {
        role: 'user',
        content: stripMentionMarkup(text),
        display: text,
        imageNodeIds: [...new Set([
          ...sentAssetIds,
          ...mentions
            .filter((mention): mention is MentionRef & { kind: 'node' } => mention.kind === 'node')
            .map((mention) => mention.id),
        ])],
      },
    ]
    if (currentIdRef.current === session.id) {
      setDraft('')
      setMessages(withSystem)
    }
    const visualNodeIds = [...new Set([
      ...sentAssetIds,
      ...mentions
        .filter((mention): mention is MentionRef & { kind: 'node' } => mention.kind === 'node')
        .map((mention) => mention.id),
    ])]
    const currentLoopDeps = loopDeps(session, operationId, toolMode, visualNodeIds)
    const initial = await runAgentTurn(withSystem, currentLoopDeps)
    const outcome = await continueAutoConfirmations(
      session,
      initial,
      currentLoopDeps,
      (next) => {
        if (currentIdRef.current === session.id) setMessages(withHidden(next))
      },
    )
    await handleOutcome(session, outcome, hidden)
    return outcome
  }, [
    messages,
    store,
    selection,
    loopDeps,
    handleOutcome,
    setStatusFor,
    allSkills,
    toolCtx,
    viewport,
    routeExecution,
    prepareChatRoute,
    sessions,
    memory,
    generationAvailability,
    ensureAgentJob,
    transitionSessionJob,
    continueAutoConfirmations,
  ])

  const sendText = useCallback(async (
    raw: string,
    queuedSession?: AgentSession,
    opts: { preclaimed?: boolean; queueTurnId?: string } = {},
  ) => {
    const text = raw.trim()
    const session = queuedSession ?? current
    if (!text || !session) return undefined
    if (!opts.preclaimed && !claimSessionActivity(session.id, opts.queueTurnId)) return undefined
    let outcome: AgentLoopOutcome | undefined
    try {
      outcome = await runSendText(
        text,
        session,
        queuedSession,
        opts.queueTurnId,
      )
      if (!outcome) {
        if (opts.queueTurnId) {
          const next = await controller.finishQueuedTurn(
            session.id,
            opts.queueTurnId,
            false,
          )
          if (next) applySessionSnapshot(next)
        }
        abortRefs.current.delete(session.id)
        releaseSessionActivity(session.id, opts.queueTurnId)
        return undefined
      }
      const paused =
        outcome.kind === 'stopped' && outcome.checkpoint !== undefined
      if (outcome.kind !== 'confirm' && !paused) {
        if (opts.queueTurnId) {
          const next = await controller.finishQueuedTurn(
            session.id,
            opts.queueTurnId,
            outcome.kind === 'message',
          )
          if (next) applySessionSnapshot(next)
        }
        releaseSessionActivity(session.id, opts.queueTurnId)
        if (outcome.kind === 'message' && shouldDrainQueue(session.id)) {
          queueMicrotask(() => queuePumpRef.current(session.id))
        }
      }
    } catch (error) {
      const aborted = abortRefs.current.get(session.id)?.signal.aborted === true
      const blocked =
        error instanceof AgentToolEffectBlockedError ? error : null
      deliveredSteersRef.current.delete(session.id)
      await transitionSessionJob(
        session.id,
        aborted ? 'canceled' : blocked?.status ?? 'failed',
        aborted ? 'interrupted' : blocked ? 'tool_failed' : 'failed',
        aborted
          ? {}
          : {
              lastError: errText(error),
              ...(blocked?.status === 'needs_attention'
                ? { pendingCallId: blocked.outcome.effect.toolCallId }
                : {}),
            },
        { phase: 'run_send_text' },
      )
      setStatusFor(
        session.id,
        aborted ? IDLE_STATUS : { kind: 'error', message: errText(error) },
      )
      if (opts.queueTurnId) {
        const next = await controller.finishQueuedTurn(
          session.id,
          opts.queueTurnId,
          false,
        )
        if (next) applySessionSnapshot(next)
      }
      releaseSessionActivity(session.id, opts.queueTurnId)
    }
    return outcome
  }, [
    applySessionSnapshot,
    controller,
    current,
    runSendText,
    setStatusFor,
    transitionSessionJob,
  ])

  const queueText = useCallback(async (raw: string) => {
    if (!current) return false
    const text = raw.trim()
    if (!text) return false
    if (!current.model) {
      setStatusFor(current.id, { kind: 'error', message: '还没选模型：先在上面选一个对话模型' })
      return false
    }
    const turn: QueuedAgentTurn = {
      id: createId('turn'),
      text,
      createdAt: Date.now(),
      channelId: current.channelId,
      model: current.model,
      ...(current.imageModel ? { imageModel: current.imageModel } : {}),
      ...(current.videoModel ? { videoModel: current.videoModel } : {}),
      ...(current.skillId ? { skillId: current.skillId } : {}),
      ...(current.autoRun === true ? { autoRun: true } : {}),
      ...(current.pendingAssetIds?.length
        ? { pendingAssetIds: [...current.pendingAssetIds] }
        : {}),
    }
    const queued = await controller.enqueueTurn(current.id, turn)
    if (!queued.ok) {
      if (queued.reason === 'full') {
        store.notify('排队任务已达上限，请先处理或删除队列中的任务', 'error')
      }
      return false
    }
    requestQueueDrain(current.id)
    applySessionSnapshot(queued.session)
    if (currentIdRef.current === current.id) {
      setDraft((value) => (value.trim() === text ? '' : value))
    }
    return true
  }, [applySessionSnapshot, controller, current, setStatusFor, store])

  const removeQueued = useCallback(async (turnId: string) => {
    if (!current) return
    const next = await controller.removeQueuedTurn(current.id, turnId)
    if (next) applySessionSnapshot(next)
    setQueueMenuId((id) => (id === turnId ? null : id))
  }, [applySessionSnapshot, controller, current])

  const beginQueueEdit = (turn: QueuedAgentTurn) => {
    setQueueMenuId(null)
    setEditingQueueId(turn.id)
    setEditingQueueText(turn.text)
  }

  const commitQueueEdit = useCallback(async () => {
    if (!current || !editingQueueId) return
    const text = editingQueueText.trim()
    if (!text) {
      store.notify('消息不能为空', 'error')
      return
    }
    const next = await controller.editQueuedTurn(current.id, editingQueueId, text)
    if (next) applySessionSnapshot(next)
    setEditingQueueId(null)
    setEditingQueueText('')
  }, [
    applySessionSnapshot,
    controller,
    current,
    editingQueueId,
    editingQueueText,
    store,
  ])

  const pumpQueuedTurn = useCallback(async (sessionId: string) => {
    if (queuePumpingRef.current.has(sessionId)) return
    queuePumpingRef.current.add(sessionId)
    try {
      if (!claimSessionActivity(sessionId)) return
      const next = await controller.claimNextQueuedTurn(sessionId)
      if (!next) {
        clearQueueDrain(sessionId)
        releaseSessionActivity(sessionId)
        return
      }
      applySessionSnapshot(next.session)
      if (next.session.queuedTurns.length > 0) requestQueueDrain(sessionId)
      else clearQueueDrain(sessionId)
      await sendText(
        next.turn.text,
        sessionForQueuedTurn(next.session, next.turn),
        { preclaimed: true, queueTurnId: next.turn.id },
      )
    } catch (error) {
      releaseSessionActivity(sessionId)
      setStatusFor(sessionId, { kind: 'error', message: errText(error) })
    } finally {
      queuePumpingRef.current.delete(sessionId)
    }
  }, [applySessionSnapshot, controller, sendText, setStatusFor])

  queuePumpRef.current = (sessionId) => {
    if (!shouldDrainQueue(sessionId)) return
    void pumpQueuedTurn(sessionId)
  }

  const resumeQueue = useCallback(() => {
    if (!current) return
    requestQueueDrain(current.id)
    void pumpQueuedTurn(current.id)
  }, [current, pumpQueuedTurn])

  const settleSessionOutcome = useCallback(async (
    sessionId: string,
    outcome: AgentLoopOutcome | { kind: 'error' },
  ) => {
    const kind = outcome.kind
    if (kind === 'confirm') return
    if (kind === 'stopped' && outcome.checkpoint) return
    const queueTurnId = activeQueueTurnOf(sessionId)
    if (queueTurnId) {
      const next = await controller.finishQueuedTurn(
        sessionId,
        queueTurnId,
        kind === 'message',
      )
      if (next) applySessionSnapshot(next)
    }
    releaseSessionActivity(sessionId, queueTurnId)
    if (kind === 'message' && shouldDrainQueue(sessionId)) {
      queueMicrotask(() => queuePumpRef.current(sessionId))
    }
  }, [applySessionSnapshot, controller])

  useEffect(() => {
    if (!current || status.kind !== 'idle') return
    if (!shouldDrainQueue(current.id)) return
    void pumpQueuedTurn(current.id)
  }, [current, status.kind, pumpQueuedTurn])

  useEffect(() => subscribeSessionRelease((sessionId) => {
    if (currentIdRef.current === sessionId && shouldDrainQueue(sessionId)) {
      void pumpQueuedTurn(sessionId)
    }
  }), [pumpQueuedTurn])

  /** 复制一条助手回复；剪贴板被拒时静默 —— 不弹一个用户看不懂的错误 */
  const copyReply = useCallback(async (key: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch {
      /* 无权限 / 非安全上下文：静默 */
    }
  }, [])

  /**
   * 用户主动取消 / 停止时唯一的收口。
   *
   * 必须先 abort，再清持久化确认卡：否则迟到的 handleOutcome 可能在停止后
   * 又把 pendingConfirmation 写回来。这里只结束当前任务，不续跑模型。
   */
  const settleInterruptedSession = useCallback(
    async (
      session: AgentSession,
      request: AgentToolRequest | undefined,
      result: 'canceled' | 'interrupted',
    ): Promise<AgentSession | null> => {
      const queueTurnId = activeQueueTurnOf(session.id)
      const settledMessages = request
        ? confirmationSettlementMessages(messages, request, result)
        : messages
      let latest: AgentSession | null = null
      let cleanupError: unknown

      abortRefs.current.get(session.id)?.abort()
      clearQueueDrain(session.id)

      const attempt = async (work: () => Promise<void>) => {
        try {
          await work()
        } catch (error) {
          cleanupError ??= error
        }
      }

      await attempt(async () => {
        latest =
          (await sessions.updateFields(session.id, {
            pendingConfirmation: undefined,
            continuation: undefined,
          })) ?? latest
      })
      await attempt(async () => {
        await transitionSessionJob(
          session.id,
          'canceled',
          'interrupted',
          { pendingCallId: undefined },
          {
            reason:
              result === 'canceled'
                ? 'user_canceled_confirmation'
                : 'user_stopped',
          },
        )
      })
      await attempt(async () => {
        if (request) {
          latest =
            (await sessions.saveMessages(session.id, settledMessages)) ?? latest
        }
      })
      await attempt(async () => {
        if (session.pendingSteers.length > 0) {
          latest =
            (await sessions.removeSteers(
              session.id,
              session.pendingSteers.map((steer) => steer.id),
            )) ?? latest
        }
      })
      await attempt(async () => {
        if (queueTurnId) {
          latest =
            (await controller.finishQueuedTurn(
              session.id,
              queueTurnId,
              false,
            )) ?? latest
        }
      })
      if (cleanupError) {
        store.notify(
          `停止任务时清理状态失败：${errText(cleanupError)}`,
          'error',
        )
      }
      releaseSessionActivity(session.id, queueTurnId)
      abortRefs.current.delete(session.id)
      deliveredSteersRef.current.delete(session.id)
      inFlightConfirmationRef.current.delete(session.id)
      if (latest) applySessionSnapshot(latest)
      if (currentIdRef.current === session.id) {
        setMessages(settledMessages)
      }
      setStatusFor(session.id, IDLE_STATUS)
      return latest
    },
    [
      applySessionSnapshot,
      messages,
      sessions,
      setStatusFor,
      store,
      transitionSessionJob,
    ],
  )

  /**
   * 队列项的“直接引导”：带新素材的消息不能被中途改成引导，因为当前请求的视觉输入
   * 已经发出；普通文字则立即进入当前任务。若正停在确认卡，先取消这次待执行动作，
   * 再把消息作为新的用户回合发出去，避免旧动作先执行、引导最后才看到。
   */
  const guideQueuedTurn = useCallback(async (turn: QueuedAgentTurn) => {
    if (!current || !statusCanSteer(status)) return
    if (turn.pendingAssetIds?.length) {
      store.notify('带新素材的消息不能中途引导，请等它按队列发送', 'error')
      return
    }
    const queuedJob = await jobs.forTurn(current.id, turn.id)

    const pendingConfirmation =
      status.kind === 'awaitingConfirm' ? status.request : current.pendingConfirmation
    if (pendingConfirmation) {
      const withoutTurn = await sessions.removeQueuedTurn(current.id, turn.id)
      if (!withoutTurn) return
      applySessionSnapshot(withoutTurn)
      if (queuedJob?.status === 'queued') {
        await jobs.transition(
          queuedJob.id,
          'canceled',
          'canceled',
          {},
          { reason: 'promoted_to_steer' },
        )
      }
      const settled = await settleInterruptedSession(
        withoutTurn,
        pendingConfirmation,
        'canceled',
      )
      const target = settled ?? withoutTurn
      store.notify('已取消等待中的动作，并立即发送这条引导', 'info')
      await sendText(turn.text, sessionForQueuedTurn(target, turn))
      return
    }

    const promoted = await sessions.promoteQueuedTurnToSteer(
      current.id,
      turn.id,
      createId('steer'),
    )
    if (!promoted.ok) {
      store.notify(
        promoted.reason === 'has_assets'
          ? '带新素材的消息不能中途引导，请等它按队列发送'
          : promoted.reason === 'steer_full'
            ? '当前任务的引导已达上限'
            : promoted.reason === 'awaiting_confirmation'
              ? 'Agent 正在等待确认，请重新点击引导'
            : '这条排队消息已经不存在',
        'error',
      )
      return
    }
    applySessionSnapshot(promoted.session)
    if (queuedJob?.status === 'queued') {
      await jobs.transition(
        queuedJob.id,
        'canceled',
        'canceled',
        {},
        { reason: 'promoted_to_steer' },
      )
    }
    setQueueMenuId(null)
    store.notify('已转为引导，将在 Agent 下一次动作前应用', 'info')
  }, [
    applySessionSnapshot,
    current,
    jobs,
    sendText,
    sessions,
    settleInterruptedSession,
    status,
    store,
  ])

  /**
   * 输入框里的“引导”：直接把当前草稿投进正在运行的回合。
   *
   * 普通运行中走 pendingSteers；停在确认卡时先取消未执行动作，再把这条消息
   * 作为新用户回合发起，避免用户还得先排队、展开列表、再点一次引导。
   */
  const guideDraft = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || !current) return false
    if (current.pendingAssetIds?.length) {
      store.notify('带新素材的消息不能中途引导，已改为排队发送', 'info')
      return queueText(text)
    }

    const pendingConfirmation =
      status.kind === 'awaitingConfirm' ? status.request : current.pendingConfirmation
    if (pendingConfirmation) {
      const settled = await settleInterruptedSession(
        current,
        pendingConfirmation,
        'canceled',
      )
      const target = settled ?? current
      store.notify('已取消等待中的动作，并立即发送这条引导', 'info')
      await sendText(text, target)
      return true
    }

    const steered = await sessions.enqueueSteer(current.id, {
      id: createId('steer'),
      text,
      createdAt: Date.now(),
    })
    if (!steered.ok) {
      store.notify(
        steered.reason === 'full'
          ? '当前任务的引导已达上限'
          : '引导发送失败，请稍后重试',
        'error',
      )
      return false
    }
    applySessionSnapshot(steered.session)
    if (currentIdRef.current === current.id) {
      setDraft((value) => (value.trim() === text ? '' : value))
    }
    store.notify('已作为引导发送，将在 Agent 下一次动作前应用', 'info')
    return true
  }, [
    applySessionSnapshot,
    current,
    queueText,
    sendText,
    sessions,
    settleInterruptedSession,
    status,
    store,
  ])

  /** 输入框发送：空闲直接跑；忙碌时按当前“排队 / 引导”模式投递。 */
  const send = useCallback(
    (requestedMode: AgentDeliveryMode = deliveryMode) => {
      if (!draft.trim()) return
      if (
        statusIsBusy(status) ||
        (current && isSessionActivityActive(current.id))
      ) {
        if (requestedMode === 'steer' && statusCanSteer(status)) {
          void guideDraft(draft)
        } else {
          void queueText(draft)
        }
        return
      }
      void sendText(draft)
    },
    [current, deliveryMode, draft, guideDraft, queueText, sendText, status],
  )

  /**
   * 重试：把**上一条用户消息**原样再发一次（用户 2026-10-14 第 1 条）。
   * 取 `display`（带引用 chip 的原文）而不是 `content`：重试时要连引用一起还原。
   */
  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    const text = lastUser.display ?? lastUser.content
    if (statusIsBusy(status) || (current && isSessionActivityActive(current.id))) {
      void queueText(text)
    } else void sendText(text)
  }, [current, messages, queueText, sendText, status])

  const confirm = useCallback(async () => {
    if (status.kind !== 'awaitingConfirm' || !current) return
    if (confirmingRef.current.has(current.id)) return
    confirmingRef.current.add(current.id)
    const { request } = status
    try {
      abortRefs.current.set(current.id, new AbortController())
      inFlightConfirmationRef.current.set(current.id, request)
      await controller.beginConfirmation(current.id, request)
      setStatusFor(current.id, { kind: 'executing', tool: request.name })
      const result = await executeConfirmedToolWithLedger(current, request)
      const imageNodeIds = [...new Set(
        [...messages].reverse().find((message) => message.role === 'user')?.imageNodeIds ?? [],
      )]
      const currentLoopDeps = loopDeps(
        current,
        createId('op'),
        toolModeRef.current.get(current.id) ?? 'native',
        imageNodeIds,
      )
      if (confirmationRunsGeneration(request.name)) {
        await controller.finishConfirmedTool(current.id, request)
      }
      setStatusFor(current.id, { kind: 'thinking' })
      const resumed = await resumeAgentTurn(
        messages,
        request.callId,
        result,
        currentLoopDeps,
        request.name,
      )
      const outcome = await continueAutoConfirmations(
        current,
        resumed,
        currentLoopDeps,
        (next) => {
          if (currentIdRef.current === current.id) setMessages(next)
        },
      )
      await handleOutcome(current, outcome)
      await settleSessionOutcome(current.id, outcome)
    } catch (error) {
      if (abortRefs.current.get(current.id)?.signal.aborted) return
      const blocked =
        error instanceof AgentToolEffectBlockedError ? error : null
      setStatusFor(current.id, { kind: 'error', message: errText(error) })
      await transitionSessionJob(
        current.id,
        blocked?.status ?? 'failed',
        blocked ? 'tool_failed' : 'failed',
        {
          lastError: errText(error),
          ...(blocked?.status === 'needs_attention'
            ? { pendingCallId: blocked.outcome.effect.toolCallId }
            : {}),
        },
        { phase: 'confirmed_tool' },
      )
      await settleSessionOutcome(current.id, { kind: 'error' })
    } finally {
      confirmingRef.current.delete(current.id)
      if (
        inFlightConfirmationRef.current.get(current.id)?.callId === request.callId
      ) {
        inFlightConfirmationRef.current.delete(current.id)
      }
    }
  }, [
    status,
    current,
    messages,
    controller,
    executeConfirmedToolWithLedger,
    loopDeps,
    handleOutcome,
    settleSessionOutcome,
    sessions,
    setStatusFor,
    transitionSessionJob,
    continueAutoConfirmations,
  ])

  /**
   * 确认卡上的「取消」= 结束当前任务，交还控制权。
   *
   * 不回填工具结果会让历史里留下悬空 tool_call；自动续跑又会让模型换个方案
   * 继续建节点。两者都不是用户点“取消”的意思，所以只补取消结果、不续跑。
   */
  const cancel = useCallback(async () => {
    if (status.kind !== 'awaitingConfirm' || !current) return
    if (confirmingRef.current.has(current.id)) return
    confirmingRef.current.add(current.id)
    const { request } = status
    try {
      await settleInterruptedSession(current, request, 'canceled')
      store.notify('已取消；本次没有执行工具，也不会自动新增节点', 'info')
    } finally {
      confirmingRef.current.delete(current.id)
    }
  }, [
    status,
    current,
    settleInterruptedSession,
    store,
  ])

  /** 轮数预算暂停后继续；工具结果已在 messages 中，不会重放已完成的调用。 */
  const continueTask = useCallback(async () => {
    if (!current || status.kind !== 'paused') return
    let queueTurnId =
      activeQueueTurnOf(current.id) ?? current.continuation?.queuedTurnId
    if (!isSessionActivityActive(current.id)) {
      if (
        queueTurnId &&
        current.queuedTurns[0]?.id === queueTurnId
      ) {
        const claimed = await controller.claimNextQueuedTurn(current.id)
        if (claimed?.session) applySessionSnapshot(claimed.session)
        queueTurnId = claimed?.turn.id
      } else {
        queueTurnId = undefined
      }
      if (!claimSessionActivity(current.id, queueTurnId)) return
    }
    const imageNodeIds = [...messages]
      .reverse()
      .find((message) => message.role === 'user')?.imageNodeIds ?? []
    abortRefs.current.set(current.id, new AbortController())
    const currentLoopDeps = loopDeps(
      current,
      createId('op'),
      toolModeRef.current.get(current.id) ?? 'native',
      imageNodeIds,
    )
    await transitionSessionJob(
      current.id,
      'planning',
      'status_changed',
      { pendingCallId: undefined },
      { resumedFromCheckpoint: true },
    )
    setStatusFor(current.id, { kind: 'thinking' })
    try {
      const initial = await runAgentTurn(messages, currentLoopDeps)
      const outcome = await continueAutoConfirmations(
        current,
        initial,
        currentLoopDeps,
        (next) => {
          if (currentIdRef.current === current.id) setMessages(next)
        },
      )
      await handleOutcome(current, outcome)
      await settleSessionOutcome(current.id, outcome)
    } catch (error) {
      setStatusFor(current.id, { kind: 'error', message: errText(error) })
      await settleSessionOutcome(current.id, { kind: 'error' })
    }
  }, [
    current,
    status,
    messages,
    sessions,
    applySessionSnapshot,
    loopDeps,
    setStatusFor,
    handleOutcome,
    settleSessionOutcome,
    transitionSessionJob,
    continueAutoConfirmations,
  ])

  const stop = useCallback(async () => {
    if (!current || stoppingRef.current.has(current.id)) return
    stoppingRef.current.add(current.id)
    const session = current
    const request =
      inFlightConfirmationRef.current.get(session.id) ??
      (status.kind === 'awaitingConfirm' ? status.request : undefined)
    try {
      await settleInterruptedSession(session, request, 'interrupted')
      if ((session.queuedTurns?.length ?? 0) > 0) {
        store.notify('当前回合已停止，排队任务保留；可从队列手动继续', 'info')
      }
    } finally {
      stoppingRef.current.delete(session.id)
    }
  }, [current, settleInterruptedSession, status, store])

  const newSession = useCallback(async () => {
    const saved = await presets.loadAgentDefault()
    const defaultSkillId = await presets.loadAgentDefaultSkill()
    const savedModel = toLogicalName(allChannels, saved?.model ?? '')
    const created = await sessions.create({
      projectId,
      channelId: '',
      model: defaultModelFor(chatModelOptions, savedModel),
      /**
       * 「跟随选中」也覆盖**会话开局**这一档：用户先选中一张香蕉 2 的图再打开对话，
       * 面板上显示的就该是香蕉 2，而不是模型清单的第一个（见 `selectedModelOf`）。
       */
      imageModel: selectedModelOf('image') || modelOptionsByKind.image[0] || '',
      videoModel: selectedModelOf('video') || modelOptionsByKind.video[0] || '',
      skillId: defaultSkillId || undefined,
    })
    await refresh()
    await switchTo(created)
  }, [
    presets,
    sessions,
    projectId,
    allChannels,
    refresh,
    switchTo,
    defaultModelFor,
    chatModelOptions,
    modelOptionsByKind,
    selectedModelOf,
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
    async (
      patch: Partial<
        Omit<AgentSession, 'id' | 'projectId' | 'messages' | 'queuedTurns' | 'createdAt'>
      >,
    ) => {
      if (!current) return
      const next = await sessions.updateFields(current.id, patch)
      if (!next) return
      setCurrent(next)
      setList((prev) => prev.map((s) => (s.id === next.id ? next : s)))
    },
    [current, sessions],
  )

  /**
   * 选模型：只保存固定的前端逻辑名。
   *
   * 渠道由下一次真实发送时的 `resolveRoutedChatTarget()` 按全局策略解析，
   * 不写进会话。旧会话留下的 `channelId` 在这一刻清掉，避免继续沿用历史绑定。
   */
  const pickModel = useCallback(
    async (model: string) => {
      if (!current) return
      chatRouteRef.current.delete(current.id)
      await patchSession({ model, channelId: '' })
    },
    [current, patchSession],
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
      /**
       * 用户在面板上亲手选的模型，也要进「上次用过的」那一份 ——
       * 否则下一轮 agent 又会按旧值去建节点，用户看到的是「我明明换了模型它还用旧的」。
       */
      stickyModelRef.current[key === 'videoModel' ? 'video' : 'image'] = model
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
      if (!current) return
      /**
       * 本轮模型循环可能早就开始了，`sendText` 捕获的是旧的 `current`。
       * 先写实时 map，再落会话；这样用户在“思考中 / 正在执行”时切到自动，
       * 下一张确认卡到达就会按新值继续，而不是继续沿用开局的手动模式。
       */
      autoRunRef.current.set(current.id, autoRun)
      const resumeCurrent =
        autoRun &&
        status.kind === 'awaitingConfirm' &&
        !confirmationRequiresExplicitApproval(
          status.request.name,
          status.request.args,
        )
      await patchSession({ autoRun })
      /**
       * 已经停在确认卡时也要立刻接管：用户不是在预约“下一次自动”，
       * 而是要求这一刻起别再问。
       */
      if (resumeCurrent) await confirm()
    },
    [current, status, patchSession, confirm],
  )

  /**
   * 在输入框里插入一个 @ 引用（引用菜单里选完之后调它）。
   *
   * 走编辑器自己的 `insertMention`，而不是往 `draft` 里拼字符串：
   * 引用要落在**光标处**、要带 chip 的存储形态，这两件事只有编辑器知道。
   */
  const insertMention = useCallback(
    (kind: 'node' | 'model' | 'skill', id: string, label: string) => {
      /**
       * 同一枚（kind + id）已经在正文里就**不再插第二枚**。
       *
       * 进会话时会按会话行把素材 chip 补回正文，用户再点一次
       * 同一项就会出现两枚一模一样的 chip —— 那不是「又用了一次」，是重复。
       */
      if (parseMentions(draft).some((m) => m.kind === kind && m.id === id)) return
      editorRef.current?.insertMention(mentionToken(kind, id, label))
    },
    [draft],
  )

  /** 节点在正文里显示成什么名字（没起名就写「素材」，不露 `node_xxx`） */
  const nodeLabelOf = useCallback(
    (id: string) => {
      const hit = store.getSnapshot().nodes.find((n) => n.id === id)
      return (hit?.title ?? '').trim() || '素材'
    },
    [store],
  )

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
    if (
      isSessionActivityActive(current.id) ||
      queuePumpingRef.current.has(current.id) ||
      confirmingRef.current.has(current.id)
    ) {
      setConfirmDelete(false)
      store.notify('当前会话还有任务在运行，请先停止后再删除', 'error')
      return
    }
    setConfirmDelete(false)
    await sessions.remove(current.id)
    const rows = await refresh()
    if (rows.length > 0) await switchTo(rows[0]!)
    else await newSession()
  }, [current, confirmDelete, sessions, refresh, switchTo, newSession, store])

  /**
   * 把**画布上选中的节点**当素材给这次对话（设计文档 §8「输入：文字 + 可选图片」）。
   *
   * 与拖图不同：这些节点早就落库了，不需要再导一次，直接把 id 记进会话 ——
   * agent 会用同一套 `attach` 复用它们。
   */
  /**
   * 多选浮层上那枚「添加到 agent」（用户 2026-10-05 第 11 条，参考图四第六个动作）。
   *
   * 画布侧与对话窗是**兄弟组件**，两边靠 `agentHandoff` 那个模块级单例交接（说明见
   * 那个文件）。这里做两件事，顺序不能反：
   * ① 先把 ids 落进**当前会话**（`pendingAssetIds`）并补成正文 chip —— 与
   *    用户看到的引用与普通 @ 节点保持同一种形态；
   * ② 取走即清空（`takeAgentHandoff`），否则每次切会话 / 重渲染都会再收一遍。
   *
   * 为什么用 ref 缓冲而不是直接消费：面板刚打开时 `current` 可能还没就绪
   * （会话是异步读回来的），那一拍消费掉就等于**用户点了按钮却什么都没发生**。
   * 所以 ids 先进 ref，能落会话了就落（`flushHandoff` 在 `current` 变好之后也会被
   * 这个 effect 重新跑一次）。
   */
  const handoffRef = useRef<string[]>([])
  const flushHandoff = useCallback(() => {
    if (!current || handoffRef.current.length === 0) return
    const exist = new Set(store.getSnapshot().nodes.map((n) => n.id))
    const picked = handoffRef.current.filter((id) => exist.has(id))
    handoffRef.current = []
    if (picked.length === 0) return
    for (const id of picked) insertMention('node', id, nodeLabelOf(id))
    void patchSession({
      pendingAssetIds: [...new Set([...(current.pendingAssetIds ?? []), ...picked])],
    })
  }, [current, store, insertMention, nodeLabelOf, patchSession])

  useEffect(() => {
    const queue = (ids: readonly string[]) => {
      handoffRef.current = [...new Set([...handoffRef.current, ...ids])]
      flushHandoff()
    }
    /** 面板可能是**后**挂载的（点按钮才打开），先把单例里存着的那批收下 */
    queue(takeAgentHandoff())
    return subscribeAgentHandoff(queue)
  }, [flushHandoff])

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
          failed.push(`${file.name}：${e instanceof Error ? e.message : errText(e)}`)
        }
      }
      await skills.reload()
      setOpenPicker(null)
      store.notify(
        failed.length === 0
          ? `已导入 ${ok} 条技能`
          : `导入 ${ok} 条，${failed.length} 条失败：${failed[0]}`,
        failed.length === 0 ? 'info' : 'error',
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

  /** 一进面板就把收藏读回来（它是 UI 偏好，住 `presets`，与 Agent 默认模型同一套） */
  useEffect(() => {
    let alive = true
    void (async () => {
      const ids = await presets.loadSkillFavorites()
      if (alive) setSkillFavs(ids)
    })()
    return () => {
      alive = false
    }
  }, [presets])

  /**
   * 切换收藏。
   *
   * **先改界面、再落库**（与素材库取消收藏同一手法）：收藏是瞬时的视觉反馈，
   * 等一次 IndexedDB 往返再打星会让人以为没点上；落库失败最坏也只是下次没记住。
   */
  const toggleSkillFavorite = useCallback(
    async (id: string) => {
      const next = skillFavs.includes(id)
        ? skillFavs.filter((x) => x !== id)
        : [...skillFavs, id]
      setSkillFavs(next)
      await presets.saveSkillFavorites(next)
    },
    [skillFavs, presets],
  )

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
      /** 同样落成正文里的引用 chip（与「取选中」同一条路） */
      insertMention('node', id, nodeLabelOf(id))
      await patchSession({ pendingAssetIds: [...(current.pendingAssetIds ?? []), id] })
    },
    [current, library, patchSession, placeAsset, insertMention, nodeLabelOf],
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
      for (const id of added) insertMention('node', id, nodeLabelOf(id))
      await patchSession({
        pendingAssetIds: [...(current.pendingAssetIds ?? []), ...added],
      })
    },
    [current, platform, store, projectId, patchSession, placeAsset, insertMention, nodeLabelOf],
  )

  /**
   * 对话流：把原始消息翻成「气泡 / 正文 / 步骤卡」三种条目。
   *
   * 不直接用 `messages.filter(role !== 'system')` 渲染 —— 那样 `tool` 消息会把
   * 一整屏 JSON 打给用户。翻成人话这件事放在 `conversation.ts` 的纯函数里，
   * 因为「哪一步该说什么」是产品口径，得能断言。
   */
  const items = useMemo(
    () =>
      toConversation([
        ...messages,
        ...steerMessagesOf(current?.pendingSteers ?? [], stripMentionMarkup),
      ]),
    [current?.pendingSteers, messages],
  )
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
    /**
     * 取图的两种来源：正文里的 @ 引用，以及「取选中当素材」挂上的标签。
     *
     * 后者原先不取图 ⇒ 标签上只能写 `node_xxx`（用户 2026-10-02 报的那一条）。
     */
    const refs = [
      ...parseMentions(draft).filter((m) => m.kind === 'node'),
      ...(current?.pendingAssetIds ?? []).map((id) => ({ kind: 'node' as const, id })),
      /**
       * **历史消息里的引用也要取图**：用户消息现在按 chip 渲染（见 `MentionRichText`），
       * 回看时要能看见当时引用的那张缩略图 —— 只按草稿取图的话，发出去就变回纯图标。
       */
      ...messages.flatMap((m) =>
        parseMentions(m.display ?? m.content).filter((x) => x.kind === 'node'),
      ),
    ]
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
  }, [draft, hashOfNode, platform, current?.pendingAssetIds, messages])

  /**
   * 会话字段 → **正文 chip**（用户 2026-10-02：「我需要全部出现在正文里面，全部保持
   * 和艾特的出现的地方一样」）。
   *
   * 进一个会话时，把「这次挂着的素材」补成本文里的引用 chip：
   * 正文是**看得见的记录**（「这次用它」），会话行是**真正生效的设置**。
   *
   * 两条纪律：① 只在正文还空着的时候补（用户写了一半的那句话不能被冲掉）；
   * ② 每个会话只补一次（发完消息正文会清空，不能把刚发走的那几枚引用又倒回来）。
   *
   * ⚠️ **技能不补**（用户 2026-10-22：「每次打开 agent 都把我在技能库里点击
   * 使用的 skill 放在对话框里」）：技能是会话设置，只在用户主动从 Agent 技能
   * 菜单里选择时落成正文 chip；重新打开面板不能凭空生成一枚技能引用。
   *
   * ⚠️ **图片 / 视频模型不补**（用户 2026-10-05 第 1 条：「每次打开对话，对话框会有
   * 两个模型」）：那是**会话设置**（建生成节点时用哪一档），不是这句话要说出去的内容。
   * 补进正文的副作用是每开一次会话就凭空多两枚 `model` chip，看起来像用户自己写的；
   * 用户主动点模型时仍然会插 chip（那一次是「我这次要用它」），设置本身也照旧生效。
   */
  const restoredSessionRef = useRef('')
  useEffect(() => {
    if (!current || restoredSessionRef.current === current.id) return
    restoredSessionRef.current = current.id
    if (draft.trim()) return
    const tokens: string[] = []
    for (const id of current.pendingAssetIds ?? []) {
      tokens.push(mentionToken('node', id, nodeLabelOf(id)))
    }
    if (tokens.length > 0) setDraft(tokens.join(''))
  }, [current, draft, nodeLabelOf])

  /**
   * 正文 chip → 会话字段（反向）：用户把主动插入的技能 chip 删掉 = **这次不用这个技能**。
   *
   * 不能再用「正文非空但没有技能 chip」来判断：进入会话时技能本来就不再自动
   * 写进正文，用户正常打字也会命中这个条件。这里只认一次真实删除 —— 同一个
   * 会话、同一个技能，上一拍正文里见过这枚 chip，下一拍它消失了。
   *
   * 发送之后正文会被清空，那一瞬间不该把设置也一并清光（技能是「本会话挂着的
   * 东西」，不是「这一条的附件」）。
   */
  const seenSkillChipRef = useRef<{
    sessionId: string
    skillId: string
    seen: boolean
  } | null>(null)
  useEffect(() => {
    if (!current?.skillId) {
      seenSkillChipRef.current = null
      return
    }
    const skillId = current.skillId
    const skillIds = parseMentions(draft)
      .filter((m) => m.kind === 'skill')
      .map((m) => m.id)
    const seen = skillIds.includes(skillId)
    const prev = seenSkillChipRef.current
    const removed =
      draft.trim() !== '' &&
      prev?.sessionId === current.id &&
      prev.skillId === skillId &&
      prev.seen &&
      !seen
    if (removed) void setSkill('')
    seenSkillChipRef.current = { sessionId: current.id, skillId, seen }
  }, [draft, current?.id, current?.skillId, setSkill])

  /** 卸载时把建出来的 objectURL 回收掉（不回收就是一路泄漏） */
  useEffect(
    () => () => {
      for (const url of thumbCacheRef.current.values()) URL.revokeObjectURL(url)
      thumbCacheRef.current.clear()
    },
    [],
  )

  const pendingPlan = previewOf(status, store)
  const editingQueueTurn =
    current?.queuedTurns.find((turn) => turn.id === editingQueueId) ?? null
  const pendingTaskStepId =
    status.kind === 'awaitingConfirm' &&
    status.request.name === 'requestTaskConfirmation'
      ? (() => {
          const args = (status.request.args ?? {}) as Record<string, unknown>
          return typeof args.stepId === 'string' ? args.stepId : undefined
        })()
      : undefined

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
      <header className={styles.head} data-agent-header>
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
            {/*
              会话选择器 = **项目里那套参数菜单**（用户 2026-10-05 第 8 条：「agent 的记录
              下拉的 ui 不是我项目中通用的那种，不好看，参考参数的菜单」）。

              原生 `<select>` 的展开层由浏览器绘制，样式不归我们管 —— 与创作面板的模型 /
              比例菜单摆在一起就显得是两个世界。换成 `ParamPicker` 之后，行高、悬停底色、
              勾选态、点外关闭全都和参数菜单同一套。
            */}
            <span className={styles.sessionPick} data-agent-session-count={list.length}>
              <ParamPicker
                name="agent-session"
                ariaLabel={`切换对话（共 ${list.length} 条）`}
                label={current?.title ?? '新对话'}
                size="compact"
                closeOnSelect
                sections={[
                  {
                    name: 'session',
                    label: '对话',
                    variant: 'list',
                    /** 一屏 8 条，多的在里面滚（与模型面板同一条口径） */
                    maxRows: 8,
                    options: list.map((s) => ({ value: s.id, label: s.title })),
                    value: current?.id ?? '',
                    onSelect: (id) => {
                      const hit = list.find((s) => s.id === id)
                      if (hit) void switchTo(hit)
                    },
                  },
                ]}
                open={openPicker === 'agent-session'}
                onToggle={() =>
                  setOpenPicker(openPicker === 'agent-session' ? null : 'agent-session')
                }
                onClose={() => setOpenPicker(null)}
              />
            </span>
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
              「设为默认模型」**整个撤掉**（用户 2026-10-05 第 9 条：「agent 最上方的
              默认按钮目前是没有用的，删掉」）。

              它做的事（把当前模型写进 `agentDefault` 供**以后新建**会话用）用户看不出来
              —— 建好的会话不跟着变、当前会话也不变，按下去像没反应，正是「点了没用」的
              那种按钮。存量偏好仍然沿读路径生效（`loadAgentDefault`，新建会话时用它）。
            */}
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
              onClick={onOpenSettings}
              title="Agent 设置"
              aria-label="打开 Agent 设置"
              data-agent-settings
            >
              <IconSettings size={16} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              title="收起 Agent 面板"
              data-agent-close
            >
              <IconClose size={16} />
            </button>
          </>
        )}
      </header>

      <div className={styles.content} ref={scrollRef} data-agent-content>
      {current?.taskPlan && (
        <TaskPlanCard
          plan={current.taskPlan}
          pendingConfirmationStepId={pendingTaskStepId}
        />
      )}

      <div className={styles.messages} data-agent-messages>
        {items.length === 0 && (
          <p className={styles.hint}>
            说一句你想要什么，我会把它建成画布上的工作流。
          </p>
        )}
        {items.map((item, i) => {
          if (item.kind === 'user') {
            return (
              <div key={i} className={styles.msgUser} data-agent-message="user">
                {/* 引用 chip 要**长得和输入框里一样**（用户 2026-10-05 第 5 条） */}
                <MentionRichText text={item.text} thumbOf={thumbOf} />
              </div>
            )
          }
          if (item.kind === 'text') {
            const copied = copiedKey === i
            return (
              <div key={i} className={styles.msgBot} data-agent-message="assistant">
                {/*
                  助手回复走 Markdown 渲染（用户 2026-10-02：模型回的
                  `- **看看画布现状**` 把星号和杠原样打在界面上）。
                  与提示词节点**共用同一个渲染器** —— 见 `MarkdownBlocks` 的说明。
                */}
                <MarkdownBlocks source={item.text} />
                {/* 复制 / 重试（用户 2026-10-14 第 1 条） */}
                <div className={styles.msgActions}>
                  <button
                    type="button"
                    className={styles.msgAction}
                    data-agent-copy
                    title={copied ? '已复制' : '复制这条回复'}
                    aria-label={copied ? '已复制' : '复制这条回复'}
                    onClick={() => void copyReply(i, item.text)}
                  >
                    {copied ? <IconCheck size={14} /> : <IconCopyText size={14} />}
                  </button>
                  <button
                    type="button"
                    className={styles.msgAction}
                    data-agent-retry
                    title="重新问一遍（重发上一条消息）"
                    aria-label="重新问一遍"
                    onClick={retry}
                  >
                    <IconLoop size={14} />
                  </button>
                </div>
              </div>
            )
          }
          /** 步骤卡：一行标题 + 可展开的明细；涉及到的节点把产物缩略图直接嵌进来 */
          const thumbs = (item.failed ? [] : item.nodeIds)
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
      </div>

      {status.kind !== 'idle' &&
        (status.kind === 'error' || status.kind === 'paused' ? (
          <div className={styles.statusLine} data-agent-status={status.kind}>
            {STATUS_LABEL[status.kind]}：{status.message}
          </div>
        ) : (
          <AgentActivityStrip status={status} items={items} />
        ))}

      {status.kind === 'paused' && current?.continuation && (
        <div className={styles.step} data-agent-continuation>
          <div className={styles.stepHead}>
            <span className={styles.stepLabel}>任务检查点</span>
          </div>
          <p className={styles.continuationText}>
            已完成 {current.continuation.maxSteps} 步，工具结果已保存。继续时从检查点接着执行。
          </p>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void continueTask()}
              data-agent-continue
            >
              继续任务
            </button>
          </div>
        </div>
      )}

      {/*
        确认卡：**放在对话流里、当一条步骤**，而不是贴在输入框上方的独立弹层。
        参考产品（liblib.tv）就是把「是否运行节点「小猫钓鱼」生成图片？」
        这条确认当成对话时间线的一部分，批准动作也是时间线里的一个小按钮 ——
        确认过之后它留在原地（能看到「批准过」），而不是整个消失。
      */}
      {pendingPlan && (
        <div
          className={`${styles.step} ${styles.previewCard}`}
          data-agent-preview={pendingPlan.tool}
        >
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

      {current && current.pendingSteers.length > 0 && (
        <div className={styles.steerPending} data-agent-steer-pending={current.pendingSteers.length}>
          <span>{current.pendingSteers.length} 条引导将在下一步生效</span>
        </div>
      )}

      {current && current.queuedTurns.length > 0 && (
        <div
          className={styles.queue}
          data-agent-queue
          data-agent-queue-count={current.queuedTurns.length}
        >
          <div className={styles.queueHead}>
            <button
              type="button"
              className={styles.queueToggle}
              onClick={() => setQueueExpanded((value) => !value)}
              data-agent-queue-toggle
            >
              <span className={styles.queueDot} aria-hidden="true" />
              <span>{current.queuedTurns.length} 条排队中</span>
              <IconChevronDown
                size={14}
                className={queueExpanded ? styles.queueChevronOpen : styles.queueChevron}
              />
            </button>
            {(status.kind === 'idle' || status.kind === 'error') && (
              <button
                type="button"
                className={styles.queueResume}
                onClick={resumeQueue}
                data-agent-queue-resume
              >
                继续
              </button>
            )}
          </div>
          {queueExpanded && (
            <div className={styles.queueList}>
              {current.queuedTurns.map((turn, index) => (
                <div key={turn.id} className={styles.queueItem} data-agent-queue-item={turn.id}>
                  <span className={styles.queueIndex}>{index + 1}</span>
                  <span className={styles.queueText}>{queuedTurnPreview(turn.text)}</span>
                  <div className={styles.queueActions}>
                    <button
                      type="button"
                      className={styles.queueSteer}
                      onClick={() => void guideQueuedTurn(turn)}
                      disabled={
                        !statusCanSteer(status) ||
                        (turn.pendingAssetIds?.length ?? 0) > 0
                      }
                      title={
                        (turn.pendingAssetIds?.length ?? 0) > 0
                          ? '带新素材的消息只能排队'
                          : statusCanSteer(status)
                            ? '直接引导当前任务'
                            : '当前没有可引导的任务'
                      }
                      aria-label="直接引导"
                      data-agent-queue-steer
                    >
                      <IconSteer size={14} />
                      <span>引导</span>
                    </button>
                    <button
                      type="button"
                      className={styles.queueAction}
                      onClick={() => void removeQueued(turn.id)}
                      title="删除消息"
                      aria-label="删除消息"
                      data-agent-queue-remove
                    >
                      <IconDelete size={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.queueAction}
                      onClick={() =>
                        setQueueMenuId((id) => (id === turn.id ? null : turn.id))
                      }
                      title="更多"
                      aria-label="更多"
                      aria-haspopup="menu"
                      aria-expanded={queueMenuId === turn.id}
                      data-agent-queue-more
                    >
                      <IconMore size={15} />
                    </button>
                  </div>
                  {queueMenuId === turn.id && editingQueueId !== turn.id && (
                    <div
                      className={styles.queueMenu}
                      role="menu"
                      data-agent-queue-menu={turn.id}
                    >
                      <button
                        type="button"
                        className={styles.queueMenuItem}
                        role="menuitem"
                        onClick={() => beginQueueEdit(turn)}
                        data-agent-queue-edit
                      >
                        <IconRename size={14} />
                        编辑消息
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {editingQueueTurn && (
            <div className={styles.queueEditPopover}>
              <textarea
                className={styles.queueEditInput}
                value={editingQueueText}
                rows={3}
                autoFocus
                aria-label="编辑排队消息"
                onChange={(event) => setEditingQueueText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setEditingQueueId(null)
                    setEditingQueueText('')
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void commitQueueEdit()
                  }
                }}
                data-agent-queue-edit-input
              />
              <div className={styles.queueEditActions}>
                <button
                  type="button"
                  className={styles.queueEditSave}
                  onClick={() => void commitQueueEdit()}
                  disabled={!editingQueueText.trim()}
                  data-agent-queue-edit-save
                >
                  <IconCheck size={13} />
                  保存
                </button>
                <button
                  type="button"
                  className={styles.queueEditCancel}
                  onClick={() => {
                    setEditingQueueId(null)
                    setEditingQueueText('')
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>

      {/*
        对话模型 = **agent 自己的 LLM**，单独一处（用户 2026-10-02：「对话模型是
        agent 的 llm，需要单独放在一个地方」）。

        为什么不跟「图片 / 视频」挤在同一个面板里：那两个决定 agent **建出来的
        生成节点**用谁，这一个决定**跟谁说话** —— 混在一起时，用户以为换的是
        画布上的模型，实际把对话模型也换掉了。
      */}
      <div className={styles.llmRow} data-agent-llm-row>
        <ParamPicker
          name="agent-chat-model"
          ariaLabel={`对话模型（agent 自己的 LLM，当前：${shownModel || '未选'}）`}
          label={shownModel || '选择对话模型'}
          triggerIcon={<IconChat size={14} />}
          size="compact"
          options={withModelIcons(chatModelOptions)}
          value={shownModel}
          variant="list"
          emptyHint="没有可用的对话模型：去后台设置里勾选"
          open={openPicker === 'agent-chat-model'}
          onToggle={() =>
            setOpenPicker(openPicker === 'agent-chat-model' ? null : 'agent-chat-model')
          }
          onClose={() => setOpenPicker(null)}
          onSelect={(v) => void pickModel(v)}
        />
      </div>

      {/*
        输入区：一个圆角盒子，**上正文、下工具条**（参考产品 liblib.tv 的对话框形态）。

        正文用 `MentionEditor`（contenteditable）而不是 `textarea`：用户 2026-10-02
        要「@ 引用的节点 / 模型在输入框里呈现为一个矩形、作为文本内容的一部分」，
        而 `textarea` 只能显示纯文本，做不到「一个矩形夹在文字中间」。
        素材标签也收在盒子里 —— 它们是「这次要说出去的东西」，不是面板参数。
      */}
      <div
        className={styles.composer}
        data-agent-composer
        data-agent-delivery-mode={deliveryMode}
      >
        {/*
          **没有独立的 chip 行了**（用户 2026-10-02：「agent 的 skill 选择后不要出现在
          图三的地方……点击节点后出现的把选中的节点当作此次的素材的时候都会出现在那里，
          我需要全部出现在正文里面，全部保持和艾特的出现的地方一样」）。

          技能 / 生成模型 / 取选中素材现在**一律落成正文里的引用 chip**（`skill:` /
          `model:` / `node:` 三种 token），与 @ 引用同一套锚点与呈现：
          · 插入：`insertMention(...)`（见上面各处的 onSelect / attachFiles）；
          · 会话字段仍然照写（技能、图片 / 视频模型、素材 id），因为提示词与落地配方
            读的是它们 —— 正文是**看得见的记录**，会话行是**真正生效的设置**；
          · 进一个会话时只把素材 chip 补回正文（见下面那个 `restoredSessionRef` 的
            effect）；技能设置照常生效，但必须由用户主动选择后才显示 chip。
        */}

        <MentionEditor
          ref={editorRef}
          value={draft}
          onChange={setDraft}
          /** 语义锚点：冒烟按 `[data-agent-input]` 定位这个输入框 */
          anchorAttr={{ 'data-agent-input': '' }}
          placeholder="开始你的创作，或者 @ 引用工作流 / 节点 / 资源"
          onEnter={(modifiers) => {
            const opposite = deliveryMode === 'queue' ? 'steer' : 'queue'
            void send(
              modifiers.ctrlKey || modifiers.metaKey ? opposite : deliveryMode,
            )
          }}
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
              @ 引用：一个浮层里三段 —— **节点**（这张画布上的）/ **图片** / **视频**
              （后两段只列前端固定清单，见下面各段自己的说明）。
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
                  /**
                   * 只先摆 5 条 + 「加载更多」（用户 2026-10-02 参考产品图二：
                   * 「不用显示全部可以艾特的节点，下方有省略，点击之后才会显示所有的」）。
                   * 画布上几十个节点时，这一层不折叠会把模型那一段挤到看不见。
                   */
                  collapsedCount: 5,
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
                /**
                 * **@ 里的模型 = 生图 / 生视频模型**（用户 2026-10-04：
                 * 「艾特按钮我要能图片模型和视频模型，就是前端的那几个，
                 *   千万不要把渠道拉取的模型放上去」）。
                 *
                 * 三条口径写死在这里：
                 * ① **只用前端固定清单**（`presetModelsOf`）—— 不用 `panelModelOptions`，
                 *    因为后者会把「渠道里勾选的模型」也并进来（中转站一次拉回几百个，
                 *    全塞进 @ 面板就是灾难，而且那些名字不是用户在创作面板上认识的名字）；
                 * ② **不含对话模型** —— agent 自己的 LLM 由工具条上那枚模型按钮管，
                 *    @ 里的模型是「这次用哪些模型去生成」（用户 2026-10-04 第 3 条）；
                 * ③ 选一枚 = **往正文里插一枚 chip**（与创作面板的模型 chip 同一套），
                 *    可以连着插多枚 —— 那就是「多个模型参与的流程」的输入方式。
                 */
                {
                  name: 'image',
                  label: '图片',
                  variant: 'list',
                  /** 一屏 5 条，多的在里面滚（与模型面板同一口径） */
                  maxRows: 5,
                  options: withModelIcons(
                    globalImageModels,
                    undefined,
                    channels.globalModelOf,
                  ),
                  value: '',
                  emptyHint: '还没有图片模型',
                  onSelect: (v) => insertMention('model', v, v),
                },
                {
                  name: 'video',
                  label: '视频',
                  variant: 'list',
                  maxRows: 5,
                  options: withModelIcons(
                    globalVideoModels,
                    undefined,
                    channels.globalModelOf,
                  ),
                  value: '',
                  emptyHint: '还没有视频模型',
                  onSelect: (v) => insertMention('model', v, v),
                },
              ]}
              open={openPicker === 'agent-mention'}
              onToggle={() => setOpenPicker(openPicker === 'agent-mention' ? null : 'agent-mention')}
              onClose={() => setOpenPicker(null)}
            />

            {/*
              模型面板 = 「**这次用哪些模型去生成**」（用户 2026-10-04 第 3 条：
              「不是默认用这两个模型的意思，是把模型放在对话框中，意思是用这些模型
                进行生成，能组成多个模型参与的流程」）。

              与旧口径的差别只有一处，但很要紧：**✓ 表示「已放进这次对话」**，
              不表示「这是默认模型」。所以：
                · 点一枚 = 往正文插一枚 `model` chip（与 @ 模型同一条路）+ 顺手把它
                  记成该类的默认值（用户一枚都没 @ 时，新节点仍要有模型可用）；
                · 勾选状态读**正文里的引用**（`mentionedModels`），可以同时勾好几枚；
                · 图片 / 视频两段的清单仍是「前端固定清单 + 渠道已勾选模型的归一显示名」，
                  与创作面板同源。
              清单与创作面板**同一份数据源**（`panelModelOptions`），再按「有没有渠道真能提供它」筛一道。
            */}
            <ParamPicker
              name="agent-model"
              ariaLabel={`这次用哪些模型生成（已放进对话 ${mentionedModels.size} 枚）`}
              label=""
              triggerIcon={<IconModelCube size={16} />}
              size="compact"
              closeOnSelect
              jumpMode="filter"
              /**
               * 顶部两枚跳转（用户 2026-10-02：「上方需要有两个选项，分别是图片、视频，
               * 点击按钮可以进行跳转到下面的选项，例如选图片就从图片的开头开始」）。
               */
              jumps={[
                { section: 'image', label: '图片' },
                { section: 'video', label: '视频' },
              ]}
              sections={[
                {
                  name: 'image',
                  label: '图片',
                  variant: 'list',
                  /** 一屏只摆 5 条，多的在里面滚（用户 2026-10-02：「太高了」） */
                  maxRows: 5,
                  /** 高亮 = 「已放进这次对话」（见 `mentionedModels`），不是会话默认值 */
                  options: withModelIcons(modelOptionsByKind.image, mentionedModels),
                  value: '',
                  emptyHint: '没有可用的图片模型',
                  onSelect: (v) => {
                    void setModelKind('imageModel', v)
                    /**
                     * 生成模型也进**正文**（用户 2026-10-02：「选择模型后也是要加入到
                     * 对话框中参与对话（和艾特模型的功能一样）」）—— 与 @ 模型同一套 chip。
                     */
                    if (v) insertMention('model', v, v)
                  },
                },
                {
                  name: 'video',
                  label: '视频',
                  variant: 'list',
                  maxRows: 5,
                  options: withModelIcons(modelOptionsByKind.video, mentionedModels),
                  value: '',
                  emptyHint: '没有可用的视频模型',
                  onSelect: (v) => {
                    void setModelKind('videoModel', v)
                    if (v) insertMention('model', v, v)
                  },
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
                  favorites={skillFavs}
                  activeId={current?.skillId ?? null}
                  onSelect={(id) => {
                    void setSkill(id ?? '')
                    /**
                     * 技能也落成**正文里的一枚 chip**（用户 2026-10-02：「agent 的 skill
                     * 选择后不要出现在图三的地方……我需要全部出现在正文里面，全部保持和
                     * 艾特的出现的地方一样」）。取消选择时把那枚 chip 一并抹掉。
                     */
                    if (id) {
                      const hit = allSkills.find((s) => s.id === id)
                      insertMention('skill', id, hit?.name ?? '技能')
                    } else {
                      setDraft((prev) => prev.replace(/\s*@\[[^\]]*\]\(skill:[^)]*\)/g, '').trim())
                    }
                    setOpenPicker(null)
                  }}
                  onToggleFavorite={(id) => void toggleSkillFavorite(id)}
                  onCreateNew={openSkillLibrary}
                  onImportFiles={() => skillFileRef.current?.click()}
                  onImportFolder={() => skillDirRef.current?.click()}
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
              回读轮数（用户 2026-10-14 参考产品图二）：发给模型的**上下文窗口**。
              只影响「这一次给模型看多少」—— 更早的历史仍全量留在库里与界面上，
              省掉的那段在结果回来时拼回去（见 `sendText` 的 `hidden`）。
            */}
            <ParamPicker
              name="agent-context"
              ariaLabel={`回读 ${current?.contextWindow ?? AGENT_CONTEXT_WINDOW} 条`}
              label=""
              triggerIcon={<IconSettings size={16} />}
              size="compact"
              variant="list"
              options={[3, 5, 10, 20, 50, 100, 150, 200].map((n) => ({
                value: String(n),
                label: `回读 ${n} 条`,
              }))}
              value={String(current?.contextWindow ?? AGENT_CONTEXT_WINDOW)}
              open={openPicker === 'agent-context'}
              onToggle={() =>
                setOpenPicker(openPicker === 'agent-context' ? null : 'agent-context')
              }
              onClose={() => setOpenPicker(null)}
              onSelect={(v) => void patchSession({ contextWindow: Number(v) })}
            />

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
          {(status.kind === 'thinking' ||
            status.kind === 'toolRunning' ||
            status.kind === 'executing') && (
            <button
              type="button"
              className={`${styles.send} ${styles.sendBusy}`}
              onClick={() => void stop()}
              title="停止"
              data-agent-stop
            >
              <IconClose size={16} />
            </button>
          )}
          {draft.trim() ? (
            <button
              type="button"
              className={`${styles.send} ${styles.sendActive}`}
              onClick={() => void send(deliveryMode)}
              title={
                statusIsBusy(status)
                  ? deliveryMode === 'steer'
                    ? '引导当前任务'
                    : '加入队列'
                  : '发送'
              }
              data-agent-send
            >
              <IconArrowUp size={16} />
            </button>
          ) : !statusIsBusy(status) ? (
            <span className={styles.sendIdle} data-agent-send-idle aria-hidden="true" />
          ) : null}
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

function currentTurnSteps(items: readonly ConversationItem[]): ConversationStep[] {
  let start = 0
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === 'user') {
      start = index + 1
      break
    }
  }
  return items
    .slice(start)
    .filter((item): item is ConversationStep => item.kind === 'step')
}

function activityTextOf(status: Status, generationPhraseIndex: number): string {
  if (status.kind === 'executing') {
    if (status.tool === 'runNode' || status.tool === 'runFrom') {
      return GENERATION_ACTIVITY_PHRASES[
        generationPhraseIndex % GENERATION_ACTIVITY_PHRASES.length
      ]!
    }
    return '正在执行这一步操作'
  }
  if (status.kind === 'thinking') return '正在理解你的要求'
  if (status.kind === 'toolRunning') return '正在查看画布和结果'
  if (status.kind === 'awaitingConfirm') return '这一步需要你确认'
  return STATUS_LABEL[status.kind]
}

function TypewriterActivity({ text }: { text: string }) {
  const [visible, setVisible] = useState(text)
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || text.length === 0) {
      setVisible(text)
      setTyping(false)
      return
    }
    setVisible('')
    setTyping(true)
    let index = 0
    const interval = Math.max(18, Math.min(55, Math.floor(800 / text.length)))
    const timer = window.setInterval(() => {
      index += 1
      setVisible(text.slice(0, index))
      if (index >= text.length) {
        window.clearInterval(timer)
        setTyping(false)
      }
    }, interval)
    return () => window.clearInterval(timer)
  }, [text])

  return (
    <span className={styles.activityCopy} aria-live="polite">
      <span aria-hidden="true">
        {visible}
        {typing ? <span className={styles.activityCursor} /> : null}
      </span>
      <span className={styles.srOnly}>{text}</span>
    </span>
  )
}

function AgentActivityStrip({
  status,
  items,
}: {
  status: Status
  items: readonly ConversationItem[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [generationPhraseIndex, setGenerationPhraseIndex] = useState(0)
  const steps = currentTurnSteps(items)
  const recent = steps.slice(-4).reverse()
  const canExpand = recent.length > 0
  const generationTool = status.kind === 'executing' ? status.tool : undefined

  useEffect(() => {
    setExpanded(false)
  }, [status.kind])

  useEffect(() => {
    if (status.kind !== 'executing' || (generationTool !== 'runNode' && generationTool !== 'runFrom')) {
      setGenerationPhraseIndex(0)
      return
    }
    const timer = window.setInterval(() => {
      setGenerationPhraseIndex((current) => current + 1)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [generationTool, status.kind])

  const currentText = activityTextOf(status, generationPhraseIndex)

  return (
    <section
      className={expanded ? `${styles.activity} ${styles.activityOpen}` : styles.activity}
      data-agent-activity
      data-agent-activity-expanded={expanded ? 'true' : 'false'}
      data-agent-status={status.kind}
    >
      <div className={styles.activityHead}>
        <span className={styles.activityDot} aria-hidden="true" />
        <TypewriterActivity text={currentText} />
        {canExpand ? (
          <button
            type="button"
            className={styles.activityToggle}
            data-agent-activity-toggle
            aria-expanded={expanded}
            aria-label={expanded ? '收起执行步骤' : '展开最近五步'}
            title={expanded ? '收起执行步骤' : '展开最近五步'}
            onClick={() => setExpanded((current) => !current)}
          >
            <span className={styles.activityToggleIcon}>
              <IconChevronDown size={14} />
            </span>
          </button>
        ) : null}
      </div>
      {expanded && canExpand ? (
        <div className={styles.activityList} data-agent-activity-list>
          {recent.map((step) => (
            <div
              key={step.id}
              className={step.failed ? styles.activityRowFailed : styles.activityRow}
            >
              <span className={styles.activityStepName}>{step.label}</span>
              {step.lines[0] ? (
                <span className={styles.activityStepDetail}>{step.lines[0]}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** 步骤卡里嵌的一张小图：直接用画布那套「按 hash 取素材」的钩子，不另写一条取图链路 */
function StepThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  const store = useCanvasStore()
  if (!url) return <span className={styles.thumbEmpty} />
  return (
    <button
      type="button"
      className={styles.thumbButton}
      onClick={() => store.openLightbox(hash)}
      title="放大查看这张图"
      aria-label="放大查看这张图"
      data-agent-thumb-open={hash}
    >
      <img className={styles.thumbImg} src={url} alt="这一步的产物" />
    </button>
  )
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
 *
 * `selected`（已放进这次对话的模型集合）是可选的：对话窗那两段要按
 * 「这枚模型是否已经在正文里」勾选（用户 2026-10-04 第 3 条），
 * 而 @ 面板那两段不需要高亮 —— 插进去就成了正文里的 chip，正文自己就是反馈。
 */
function withModelIcons(
  names: readonly string[],
  selected?: ReadonlySet<string>,
  modelOf: (name: string) => { vendor: PresetVendor } | undefined = presetOf,
) {
  return names.map((n) => {
    const preset = modelOf(n)
    return {
      value: n,
      label: n,
      ...(preset ? { icon: <ModelIcon vendor={preset.vendor} /> } : {}),
      ...(selected ? { selected: selected.has(n) } : {}),
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
  if (name === 'proposeTaskPlan') {
    const title = typeof a.title === 'string' ? a.title.trim() : '执行计划'
    const summary = typeof a.summary === 'string' ? a.summary.trim() : ''
    const assumptions = Array.isArray(a.assumptions)
      ? a.assumptions
          .filter((value): value is string => typeof value === 'string')
          .flatMap((value) => readableConfirmationLines(value))
      : []
    const steps = Array.isArray(a.steps)
      ? a.steps.flatMap((value, index) => {
          if (!value || typeof value !== 'object') return []
          const row = value as Record<string, unknown>
          const stepTitle = typeof row.title === 'string' ? row.title.trim() : ''
          if (!stepTitle) return []
          const detail = typeof row.detail === 'string' ? row.detail.trim() : ''
          return [
            `${index + 1}. ${stepTitle}${
              row.requiresConfirmation !== false ? '（完成需验收）' : ''
            }`,
            ...(detail
              ? readableConfirmationLines(detail).map((line) => `   产出：${line}`)
              : []),
          ]
        })
      : []
    return {
      tool: name,
      title: '确认这套执行计划？',
      lines: [
        title,
        ...(summary ? [summary] : []),
        ...(assumptions.length > 0
          ? ['计划前提（请核对）：', ...assumptions.map((line) => `· ${line}`)]
          : []),
        ...steps,
        '确认后才会开始执行；每一步完成后都会停下来等你验收。',
      ],
      action: '确认计划',
    }
  }
  if (name === 'requestTaskConfirmation') {
    const question =
      typeof a.question === 'string' && a.question.trim()
        ? a.question.trim()
        : '这一步需要你确认'
    const detail = typeof a.detail === 'string' ? a.detail.trim() : ''
    return {
      tool: name,
      title: question,
      lines: readableConfirmationLines(detail),
      action: a.purpose === 'review' ? '结果满意，继续' : '确认并继续',
    }
  }
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
  if (name === 'runFrom') {
    const resolved = runFromNodeIds(store, a.nodeIds)
    if (!resolved.ok) {
      return { tool: name, title: '这条下游链不能运行', lines: resolved.problems, action: '知道了' }
    }
    const names = resolved.ids.map((id) => {
      const node = store.getSnapshot().nodes.find((n) => n.id === id)
      return node?.title || id
    })
    return {
      tool: name,
      title: '要把这条下游流程跑完？',
      lines: [`将运行 ${resolved.ids.length} 个节点：${names.join(' → ')}`, '会花钱'],
      action: '批准运行',
    }
  }
  if (name === 'rememberMemory') {
    const kindLabels: Record<string, string> = {
      preference: '偏好',
      fact: '事实',
      constraint: '硬约束',
      decision: '已确认决定',
    }
    const scopeLabels: Record<string, string> = {
      global: '全部工作台',
      workbench: '当前工作台',
      project: '当前项目',
      session: '当前会话',
    }
    const text = typeof a.text === 'string' ? a.text : ''
    return {
      tool: name,
      title: '要把这条内容记成长期记忆？',
      lines: [
        text,
        `类型：${kindLabels[String(a.kind)] ?? String(a.kind)}`,
        `作用范围：${scopeLabels[String(a.scope)] ?? String(a.scope)}`,
        ...(typeof a.key === 'string' && a.key ? [`主题：${a.key}`] : []),
        '一次性要求不会被保存；以后可在“全局设置 → Agent 与记忆”修改或忘记。',
      ].filter(Boolean),
      action: '保存记忆',
    }
  }
  if (name === 'updateNode') {
    const nodeIds = Array.isArray(a.nodeIds)
      ? a.nodeIds.filter((id): id is string => typeof id === 'string')
      : typeof a.nodeId === 'string'
        ? [a.nodeId]
        : []
    const names = nodeIds.map(
      (id) => store.getSnapshot().nodes.find((node) => node.id === id)?.title || id,
    )
    return {
      tool: name,
      title: '要改节点参数',
      lines: [
        names.length > 0 ? `节点：${names.join('、')}` : '没有指定节点',
        ...Object.keys((a.data ?? {}) as object).map((k) => `改 ${k}`),
      ],
      action: '应用改动',
    }
  }
  if (name === 'deleteEdges') {
    const graph = store.getSnapshot()
    const ids = Array.isArray(a.edgeIds)
      ? a.edgeIds.filter((id): id is string => typeof id === 'string')
      : []
    const pairs = Array.isArray(a.pairs)
      ? a.pairs.flatMap((pair) => {
          if (!pair || typeof pair !== 'object') return []
          const row = pair as Record<string, unknown>
          return typeof row.source === 'string' && typeof row.target === 'string'
            ? [{ source: row.source, target: row.target }]
            : []
        })
      : []
    const edges = graph.edges.filter(
      (edge) =>
        ids.includes(edge.id) ||
        pairs.some((pair) => pair.source === edge.source && pair.target === edge.target),
    )
    const titleOf = (id: string) =>
      graph.nodes.find((node) => node.id === id)?.title || id
    return {
      tool: name,
      title: `要取消 ${edges.length} 条连线？`,
      lines:
        edges.length > 0
          ? edges.map((edge) => `${titleOf(edge.source)} → ${titleOf(edge.target)}`)
          : ['没有找到可取消的连线'],
      action: '取消这些连线',
    }
  }
  if (name === 'deleteNodes') {
    const ids = Array.isArray(a.nodeIds)
      ? a.nodeIds.filter((id): id is string => typeof id === 'string')
      : []
    const graph = store.getSnapshot()
    const names = ids.map(
      (id) => graph.nodes.find((node) => node.id === id)?.title || id,
    )
    return {
      tool: name,
      title: `要删除 ${names.length} 个节点？`,
      lines: [...names, '关联连线会一并删除，素材库里的图片文件不受影响。'],
      action: '删除这些节点',
    }
  }
  return { tool: name, title: name, lines: [], action: '执行' }
}
