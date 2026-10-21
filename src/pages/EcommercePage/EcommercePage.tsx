import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { useProjectWriteSafety } from '../../app/useProjectWriteSafety'
import { createStore } from '../../state/createStore'
import { CanvasStoreProvider, useCanvasStore, useGraph } from '../../workbenches/canvas/storeContext'
import {
  CanvasExecutionProvider,
  useCanvasExecution,
} from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'
import { EcommerceStudio, type EcommerceResultItem, type EcommerceUpload } from '../../workbenches/ecommerce/EcommerceStudio'
import { createAgentSessionStore } from '../../state/agent/sessionStore'
import { openGlobalSettings } from '../../state/ui/globalSettings'
import { channelIsRoutable } from '../../domain/project/channel'
import { resolveRouteFor } from '../../domain/project/modelRouting'
import { resolveUpstreamModel } from '../../domain/project/modelMapping'
import { resolveGenerationTarget } from '../../domain/project/generationRouting'
import {
  planTitleOf,
  recentPlanSessions,
  toPlanMessages,
  toPlanSession,
  type EcommercePlanSession,
} from '../../domain/ecommerce/sessions'
import { LongImagePanel, type LongImageTileSource } from './LongImagePanel'
import { createProjectRepository } from '../../state/project/repository'
import {
  createAssetNode,
  importAssetFile,
  isImportableMedia,
} from '../../features/canvas/importAsset'
import { applyDefaults, resolveDefaults } from '../../features/canvas/createNodeWithDefaults'
import { buildEcommercePlan } from '../../domain/ecommerce/plan'
import {
  buildIntentSystem,
  buildIntentText,
  parseEcommerceIntent,
  type EcommerceIntentDraft,
} from '../../domain/ecommerce/chatParse'
import {
  buildShotsSystem,
  buildShotsText,
  parseShotsReply,
  shouldExpandShots,
  type ShotPlanResult,
} from '../../domain/ecommerce/chatShots'
import type { EcommerceShot } from '../../domain/ecommerce/prompt'
import {
  capabilityOfLogical,
  logicalNames,
  panelModelOptions,
} from '../../domain/project/modelCatalog'
import { imageParamsFor } from '../../domain/canvas/layout/imageParams'
import { assetHashesOfNode } from '../../domain/canvas/graph/assetRefs'
import { imageAssetInputsOf } from '../../domain/shared/execution/inputs'
import type { NodeInput } from '../../domain/shared/execution/types'
import { projectRoute } from '../../domain/shared/workbench'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { asAppError, describeError } from '../../shared/result'
import { createId } from '../../shared/id'
import { createPackStore } from '../../state/project/packStore'
import { loadEcommerceDraft, saveEcommerceDraft } from '../../state/project/ecommerceDraft'
import { createEcommerceTaskRepository } from '../../state/project/ecommerceTaskRepository'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import { createEcommerceCanvasRepository } from '../../state/project/ecommerceCanvasRepository'
import type { EcommerceCanvasItem } from '../../domain/ecommerce/canvasItem'
import { ensureEcommerceCanvasCopy } from '../../features/ecommerce/ensureCanvasCopy'
import {
  acquireEcommerceTaskLease,
  hasEcommerceTaskLease,
  releaseEcommerceTaskLease,
} from '../../features/ecommerce/execution/taskLease'
import {
  cleanEcommerceDraftRefs,
  type EcommerceFormDraft,
} from '../../domain/ecommerce/draft'
import {
  resultDisplayStatus,
  resultMetadataOf,
  taskStatusOf,
  type EcommerceResultRecord,
  type EcommerceTaskRecord,
} from '../../domain/ecommerce/tasks'
import {
  ECOMMERCE_PLATFORMS,
  type EcommercePlatform,
} from '../../domain/ecommerce/platforms'
import {
  ECOMMERCE_LANGUAGES,
  ecommerceAspectRatio,
  languageLabel,
  type EcommerceLanguage,
} from '../../domain/ecommerce/types'
import { canvasStoreFor } from '../../state/workbenches/canvas/storeCache'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { RunRecord } from '../../domain/canvas/model/runRecord'
import {
  EcommerceWorkbench,
  type EcommerceWorkbenchAction,
} from './EcommerceWorkbench'
import type { Edge } from '../../domain/canvas/model/edge'
import type { EcommerceRequest } from '../../domain/ecommerce/types'
import type { EcommerceGenerationStage } from '../../domain/ecommerce/progress'
import {
  ECOMMERCE_UPSCALE_OPTIONS,
  upscaleNoteOf,
  upscaleOptionOf,
  type EcommerceUpscaleProfile,
  type EcommerceUpscaleScale,
} from '../../domain/ecommerce/upscale'
import styles from './EcommercePage.module.css'

/**
 * 电商工作台页（对账 #384 的 D3/D4/D5/D6）。
 *
 * ## 它是**装配层**，不是工作台
 *
 * 工作台自己的界面在 `workbenches/ecommerce/EcommerceStudio`，它**只认 props**、
 * 不认识画布；而这里负责把两侧接起来：建/取画布 store、挂执行 Provider、
 * 上传素材、建生成节点、跑引擎、把结果读回来。这样 `workbenches/ecommerce`
 * 与 `workbenches/canvas` 之间**零互引**（架构 §7.2 那条"工作台之间不互引"的口径）。
 *
 * ## A 版的数据落在哪
 *
 * 复用电商的**画布图**：产品图 / 参考图 = 素材节点，出图 = 生成节点 + 运行记录，
 * 结果字节仍是内容寻址的 `assets`。用户界面将电商与无限画布保持隔离：
 * 电商结果只能在工作台里下载、收藏或继续 AI 编辑，不从功能面板跳到画布。
 */

export function EcommercePage() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <EcommerceEmpty />
  return <EcommerceProject key={projectId} projectId={projectId} />
}

/** 没有项目时的引导页：给出口，不空白（D3 的验收判据之一） */
function EcommerceEmpty() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.create({ name: '电商出图', workbench: 'ecommerce' })
      navigate(projectRoute('ecommerce', project.id))
    } catch {
      setError('新建项目失败，稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className={styles.emptyWrap} data-ecommerce-empty-page>
      <h1 className={styles.emptyTitle}>电商工作台</h1>
      <p className={styles.emptyText}>
        上传产品图、选平台与用途，右边直接出图。任务与结果都留在这个电商工作台，
        不会和无限画布项目混在一起。
      </p>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        data-ecommerce-create
        onClick={() => void create()}
      >
        {busy ? '正在新建…' : '新建电商项目'}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.emptyHint}>
        也可以从「项目」页新建 —— 新建菜单里选「电商工作台」。
      </p>
    </div>
  )
}

function EcommerceProject({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  /**
   * **与画布页共用同一个 store 实例**（对账 #411）。
   *
   * 这条以前是各页一个 Map，代价实测过：在电商页出一套图 → 点「在画布里打开」，
   * 画布页的撤销按钮是**灰的**（那批操作记在另一个实例的栈上），画布页还可能拿着旧快照。
   * 缓存与完整理由见 `state/workbenches/canvas/storeCache.ts`。
   */
  const cached = canvasStoreFor(projectId, () =>
    createStore({ workbench: 'canvas', platform, projectId }),
  )
  const store = cached.store
  /**
   * 水合门：页面在工作区可交互之前必须先把同一个画布 store 的节点 / 连线读回来。
   *
   * 为什么不能像旧版一样“后台读、表单先开”：用户如果很快上传产品图，`node.create`
   * 会先写进空 store，随后异步 `store.hydrate()` 用磁盘快照覆盖内存图；磁盘上节点还在，
   * 本地图却已经没有它，出图时第一条 `edge.connect` 就报“源节点不存在”。
   */
  const [hydrated, setHydrated] = useState(cached.hydrated)
  const [hydrateError, setHydrateError] = useState('')

  /**
   * 离开这一页时把还没到防抖时间的写入**冲一次**（与画布页同一手法）。
   * 实例是共用的，`dispose()` 只做 flush、不销毁状态 —— 紧接着进画布页仍拿得到同一个 store。
   */
  useEffect(() => () => store.dispose(), [store])

  /**
   * **关窗口 / 切到后台**也要冲一次，并广播给别的窗口（对账 #453）。
   *
   * `dispose()` 只在**路由离开**时跑；用户在这一页直接关窗口时它不会执行 ——
   * 画布页因为接了这两道保险所以没事，电商页原先没有 ⇒ "出完图立刻关窗口"那 ≤800ms
   * 的写入没人兜底，且两个窗口并排时这里的写入不会通知对面。
   * 与画布页**共用同一份**实现，别再各写一套。
   */
  useProjectWriteSafety(projectId, store)

  /** 从库里读回图（与画布页同一口径：只读一次，避免把内存里正在跑的写入盖回去） */
  useEffect(() => {
    if (cached.hydrated) return
    let cancelled = false
    void (async () => {
      try {
        await platform.storage.open()
        const [nodes, edges] = await Promise.all([
          platform.storage.query('nodes', { projectId }),
          platform.storage.query('edges', { projectId }),
        ])
        if (cancelled) return
        cached.hydrated = true
        store.hydrate({
          projectId,
          nodes: nodes as unknown as NodeSnapshot[],
          edges: edges as unknown as Edge[],
        })
        setHydrated(true)
      } catch (e) {
        if (!cancelled) {
          setHydrateError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cached, platform, projectId, store])

  if (!hydrated) {
    return (
      <div className={styles.emptyWrap} data-ecommerce-hydrating>
        <p className={styles.emptyText}>
          {hydrateError ? `项目读取失败：${hydrateError}` : '正在读取这个电商项目…'}
        </p>
      </div>
    )
  }

  return (
    <CanvasStoreProvider store={store}>
      <CanvasExecutionProvider>
        <StudioHost projectId={projectId} />
      </CanvasExecutionProvider>
    </CanvasStoreProvider>
  )
}

/** 结果缩略图：按 hash 取素材（hook 必须落在子组件里，不能在 map 里调） */
function ResultPreview({ hash, mime }: { hash: string; mime?: string }) {
  const meta = useAssetMeta(hash)
  if (!meta.url) return null
  if ((mime ?? meta.mime)?.startsWith('video/')) {
    return <video src={meta.url} controls loop playsInline preload="metadata" />
  }
  return <img src={meta.url} alt="" />
}

function StudioHost({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const channels = useChannels()
  const store = useCanvasStore()
  const graph = useGraph()
  const exec = useCanvasExecution()
  const taskRepo = useMemo(() => createEcommerceTaskRepository(platform.storage), [platform])
  const canvasRepo = useMemo(
    () => createEcommerceCanvasRepository(platform.storage),
    [platform],
  )
  const assetLibraryRepo = useMemo(
    () => createAssetLibraryRepository(platform.storage),
    [platform],
  )
  const [projectName, setProjectName] = useState('')
  /**
   * 结果真源是 `ecommerceTasks` / `ecommerceResults`（对账 #399 第二期）。
   *
   * 画布节点仍负责跑引擎与承载产物，但界面不再从节点反推"这一批出过什么"。
   * 旧项目没有任务行时才走 `legacyNodeIds` 兜底，并在下一次生成时写入新表。
   */
  const [activeTask, setActiveTask] = useState<EcommerceTaskRecord | null>(null)
  const [resultRows, setResultRows] = useState<EcommerceResultRecord[]>([])
  const [taskLoaded, setTaskLoaded] = useState(false)
  const [taskHistory, setTaskHistory] = useState<EcommerceTaskRecord[]>([])
  const [canvasItems, setCanvasItems] = useState<EcommerceCanvasItem[]>([])
  const canvasItemsRef = useRef<EcommerceCanvasItem[]>([])
  const [workbenchResults, setWorkbenchResults] = useState<EcommerceResultRecord[]>([])
  const [workbenchRuns, setWorkbenchRuns] = useState<RunRecord[]>([])
  const canvasSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const workbenchRefreshQueueRef = useRef<Promise<void>>(Promise.resolve())
  const legacyNodeIds = useMemo(() => {
    if (!taskLoaded || activeTask) return []
    return graph.nodes
      .filter((n) => {
        if (n.type !== 'generation') return false
        const data = n.data as { prompt?: unknown }
        const prompt = data.prompt
        return typeof prompt === 'string' && prompt.trim().length > 0
      })
      .map((n) => n.id)
  }, [graph.nodes, taskLoaded, activeTask])
  const nodeIds = activeTask ? activeTask.nodeIds : legacyNodeIds
  /**
   * 出图模型（用户 2026-10-10 #2）。空串 = 默认：由 `channels.defaultForNewNode` 解析。
   *
   * 清单取的是**固定前端显示名**（与画布创作面板同一份 `panelModelOptions('image')`）——
   * 渠道拉回来的裸模型名不进这个列表，理由见 `modelCatalog` 的注释（对账 #371）。
   */
  const [model, setModel] = useState('')
  /**
   * 左侧草稿（对账 #477）：`undefined` = 还在读，`null` = 这个项目还没有草稿。
   * 读出来之前不渲染工作台，避免先闪一版默认值再把用户上传的图顶掉。
   */
  const [savedDraft, setSavedDraft] = useState<EcommerceFormDraft | null | undefined>(undefined)
  const [initialUploads, setInitialUploads] = useState<{
    products: EcommerceUpload[]
    references: EcommerceUpload[]
  }>({ products: [], references: [] })
  const draftTimer = useRef<number | null>(null)
  const draftLatest = useRef<EcommerceFormDraft | null>(null)
  /** 长图面板开不开（对账 #420）：纯 UI 态，不落库 */
  const [longOpen, setLongOpen] = useState(false)
  /**
   * 「一句话 → 待确认方案」（对账 #422）。
   *
   * 三份状态刻意分开：`intent` 是**草稿**（还没进表单）、`intentError` 是**如实说**
   * （解析失败 / 超时 / 没配模型），`parsingIntent` 只管按钮。
   * 草稿**不落库** —— 它是"这句话可以变成什么"，不是用户已经定下来的东西。
   */
  const [intent, setIntent] = useState<EcommerceIntentDraft | null>(null)
  const [intentError, setIntentError] = useState('')
  const [parsingIntent, setParsingIntent] = useState(false)
  /**
   * **历史方案**（对账 #433）：一次成功的解析留一条，存在 `agentSessions`（项目级会话表，
   * 不新建表）。以前这些都只活在组件状态里 —— 刷新、切走、关掉再回来就没了，
   * 昨天想好的"亚马逊英文详情页 4 张、突出防水材质"今天得重打一遍。
   */
  const planSessions = useMemo(() => createAgentSessionStore(platform.storage), [platform])
  const [planHistory, setPlanHistory] = useState<EcommercePlanSession[]>([])
  /**
   * 这一次的分镜从哪来（对账 #406）：跑完如实显示。空串 = 这一趟没这回事，不显示。
   */
  const [shotPlanNote, setShotPlanNote] = useState('')
  /**
   * **分镜那一次对话请求也要算进"忙"**：它发生在建节点之前，
   * `exec.isRunning` 这时还是 false —— 不盖住的话按钮照样能点，
   * 用户点两下就花两次对话额度（而且要等两遍）。
   */
  const [preparingShots, setPreparingShots] = useState(false)
  /**
   * 只覆盖“校验 → 分析 → 建节点 → 提交 API”这段提交期。
   * 请求一旦发出，结果行和占位已经可见，按钮必须释放，允许用户继续下一批；
   * 不能用 `exec.isRunning` 把按钮锁到所有图片都返回。
   */
  const [submitting, setSubmitting] = useState(false)
  const [generationStage, setGenerationStage] = useState<EcommerceGenerationStage | null>(null)
  const models = useMemo(() => panelModelOptions('image'), [])
  const videoModels = useMemo(() => panelModelOptions('video'), [])
  const imageParamOptionsByModel = useMemo(
    () =>
      Object.fromEntries(
        models.map((name) => {
          const spec = imageParamsFor(name)
          return [
            name,
            {
              resolutions: spec?.sizes ?? ['1K', '2K', '4K'],
              qualities: spec?.qualities ?? [],
            },
          ]
        }),
      ),
    [models],
  )
  /**
   * 平台清单 = 内置 + **扩展包带进来的规则**（对账 #386 的 E3）。
   *
   * 同 id 时以扩展包为准：包就是用来"更新规则而不必等应用发版"的，
   * 若被内置那份压住，这个机制就白做了。
   */
  const [platforms, setPlatforms] = useState<readonly EcommercePlatform[]>(ECOMMERCE_PLATFORMS)

  const refreshWorkbench = useCallback(
    async (viewportWidth = Math.max(760, Math.round(window.innerWidth * 0.72))) => {
      await canvasSaveQueueRef.current
      await taskRepo.reconcileFromRunRecords(projectId)
      const [items, rows, runs] = await Promise.all([
        canvasRepo.sync(projectId, viewportWidth),
        taskRepo.listResults(projectId),
        platform.storage.query('runRecords', { projectId }),
      ])
      canvasItemsRef.current = items
      setCanvasItems(items)
      setWorkbenchResults(rows)
      setWorkbenchRuns(runs as unknown as RunRecord[])
    },
    [canvasRepo, platform, projectId, taskRepo],
  )
  const queueWorkbenchRefresh = useCallback(
    (viewportWidth?: number) => {
      const next = workbenchRefreshQueueRef.current
        .catch(() => undefined)
        .then(() => refreshWorkbench(viewportWidth))
      workbenchRefreshQueueRef.current = next.catch(() => undefined)
      return next
    },
    [refreshWorkbench],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const extra = await createPackStore(platform.storage).platforms()
      if (cancelled || extra.length === 0) return
      const byId = new Map<string, EcommercePlatform>(
        ECOMMERCE_PLATFORMS.map((p) => [p.id, p]),
      )
      const known = new Set<string>(ECOMMERCE_LANGUAGES)
      for (const p of extra) {
        byId.set(p.id, {
          ...p,
          countHint: p.countHint ?? '',
          /* 包里的语言代码是**未受信任的输入**：只留我们认识的，别把 'xx' 拼进提示词 */
          languages: p.languages.filter((l): l is EcommerceLanguage => known.has(l)),
        })
      }
      setPlatforms([...byId.values()])
    })()
    return () => {
      cancelled = true
    }
  }, [platform])

  /** 项目名（标题下面那行）—— 读一次即可 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.get(projectId)
      if (!cancelled) setProjectName(project?.name ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId])

  /**
   * 读回左侧草稿，并顺手清理悬空上传引用：
   * 草稿记着 node_1，但那个节点已被删 ⇒ 这一项不能放回表单（否则会得到一个
   * 点生成才发现"产品图不存在"的假恢复）。清理结果同步写回，保持库与界面一致。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [draft, rows] = await Promise.all([
        loadEcommerceDraft(platform.storage, projectId),
        platform.storage.query('nodes', { projectId }),
      ])
      if (cancelled) return
      const nodes = rows as unknown as NodeSnapshot[]
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const uploadOf = (nodeId: string | null | undefined): EcommerceUpload | null => {
        if (!nodeId) return null
        const node = byId.get(nodeId)
        const hash = node ? assetHashesOfNode(node)[0] : undefined
        if (!hash) return null
        return { nodeId, hash, preview: <ResultPreview hash={hash} /> }
      }
      const validNodeIds = new Set(
        nodes.filter((node) => assetHashesOfNode(node).length > 0).map((node) => node.id),
      )
      const cleaned = draft ? cleanEcommerceDraftRefs(draft, validNodeIds) : null
      const products = (cleaned?.productNodeIds ?? [])
        .map((id) => uploadOf(id))
        .filter((item): item is EcommerceUpload => item !== null)
      const references = (cleaned?.referenceNodeIds ?? [])
        .map((id) => uploadOf(id))
        .filter((item): item is EcommerceUpload => item !== null)
      if (cleaned) setModel(cleaned.model)
      setInitialUploads({ products, references })
      setSavedDraft(cleaned)
      draftLatest.current = cleaned
      if (
        draft &&
        cleaned &&
        (draft.productNodeIds.join('|') !== cleaned.productNodeIds.join('|') ||
          draft.referenceNodeIds.join('|') !== cleaned.referenceNodeIds.join('|'))
      ) {
        void saveEcommerceDraft(platform.storage, projectId, cleaned)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId])

  /** 从自己的结果表读回最近一批；老项目没有任务行时 `taskLoaded=true` + 空任务走节点兜底。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      /**
       * 必须先对账，再读首屏结果。
       * 反过来的话：结果行仍是 running，而对应 RunRecord 已经 failed / succeeded，
       * 首屏会一直显示“生成中”；后一次的 refreshWorkbench 只修正 workbenchResults，
       * 不会回写当前批次的 resultRows，直到用户再刷新一次才看到终态。
       */
      await taskRepo.reconcileFromRunRecords(projectId)
      const [latestRow, initialList] = await Promise.all([
        taskRepo.latestWithResults(projectId),
        taskRepo.list(projectId),
      ])
      if (cancelled) return
      let latest = latestRow
      let list = initialList
      for (const runningTask of initialList.filter((task) => task.status === 'running')) {
        if (hasEcommerceTaskLease(runningTask.id)) continue
        const recovered = await taskRepo.interruptUnfinished(
          runningTask.id,
          '上次生成被中断，请重新生成。',
        )
        if (cancelled) return
        if (recovered) {
          list = list.map((task) => (task.id === recovered.task.id ? recovered.task : task))
          if (latest?.task.id === recovered.task.id) latest = recovered
        }
      }
      setActiveTask(latest?.task ?? null)
      setResultRows(latest?.results ?? [])
      setTaskHistory(list)
      setTaskLoaded(true)
      await refreshWorkbench()
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, refreshWorkbench, taskRepo])

  /** 把某一格从内部节点的最新状态同步回结果表（跑完 / 失败 / 取消都走这里）。 */
  const syncResultRow = useCallback(
    async (taskId: string, nodeId: string) => {
      const node = store.getSnapshot().nodes.find((n) => n.id === nodeId)
      const state = exec.nodeStateOf(nodeId)
      const hash = node ? assetHashesOfNode(node)[0] : undefined
      const natural = (node?.data as { naturalSize?: { width?: unknown; height?: unknown } } | undefined)
        ?.naturalSize
      const data = node?.data as
        | {
            prompt?: unknown
            model?: unknown
            assetMime?: unknown
            ratio?: unknown
            shotTitle?: unknown
            brief?: unknown
            headline?: unknown
            subheadline?: unknown
            visualSystem?: unknown
          }
        | undefined
      const width =
        typeof natural?.width === 'number' && natural.width > 0 ? natural.width : undefined
      const height =
        typeof natural?.height === 'number' && natural.height > 0 ? natural.height : undefined
      const current = (await taskRepo.results(taskId)).find((r) => r.nodeId === nodeId)
      if (!current) return
      /**
       * `runNode` 返回前执行宿主会清掉节点内存状态；因此这里不能只看
       * `exec.nodeStateOf()`，否则所有失败都会落成最后一条 running。
       * RunRecord 才是每次调用的持久事实源，先 flush 再读取。
       */
      await store.flush()
      const runRows = (
        (await platform.storage.query('runRecords', { projectId, nodeId })) as unknown as RunRecord[]
      ).sort((a, b) => b.createdAt - a.createdAt)
      const run = runRows[0]
      const status: EcommerceResultRecord['status'] =
        run?.status === 'failed' || run?.status === 'canceled'
          ? 'failed'
          : run?.status === 'succeeded'
            ? 'done'
            : state?.kind === 'canceled'
          ? 'canceled'
          : resultDisplayStatus({
              stored: current.status,
              ...(state?.kind ? { live: state.kind } : {}),
              hasAsset: !!hash,
            })
      const next: EcommerceResultRecord = {
        ...current,
        updatedAt: Date.now(),
        status,
        ...(hash ? { assetHash: hash } : {}),
        ...(typeof data?.assetMime === 'string' && data.assetMime
          ? { mime: data.assetMime }
          : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(typeof data?.prompt === 'string' && data.prompt ? { prompt: data.prompt } : {}),
        ...(typeof data?.model === 'string' && data.model ? { model: data.model } : {}),
        ...(typeof data?.ratio === 'string' && data.ratio && !current.ratio
          ? { ratio: data.ratio }
          : {}),
        ...(typeof data?.shotTitle === 'string' && data.shotTitle && !current.shotTitle
          ? { shotTitle: data.shotTitle }
          : {}),
        ...(typeof data?.brief === 'string' && data.brief && !current.brief
          ? { brief: data.brief }
          : {}),
        ...(typeof data?.headline === 'string' && data.headline && !current.headline
          ? { headline: data.headline }
          : {}),
        ...(typeof data?.subheadline === 'string' && data.subheadline && !current.subheadline
          ? { subheadline: data.subheadline }
          : {}),
        ...(typeof data?.visualSystem === 'string' && data.visualSystem && !current.visualSystem
          ? { visualSystem: data.visualSystem }
          : {}),
        ...(run?.errorText
          ? { errorText: run.errorText }
          : state?.kind === 'failed'
            ? { errorText: describeError(state.error) }
            : {}),
      }
      await taskRepo.updateResult(next)
      setResultRows((rows) => rows.map((row) => (row.id === next.id ? next : row)))
    },
    [exec, platform, projectId, store, taskRepo],
  )

  /** 用最新的逐格状态收口整批任务（running / partial / done / failed / canceled）。 */
  const refreshTask = useCallback(
    async (task: EcommerceTaskRecord) => {
      /**
       * 并发生成时，单张 `syncResultRow` 可能比 RunRecord 的最终可见稍早，
       * 先把结果行按各自最新 RunRecord 收口，再计算整批状态。
       * 否则数据库会先变成 done，但 `resultRows` 仍停在 running，界面一直转。
       */
      await taskRepo.reconcileFromRunRecords(projectId)
      const rows = await taskRepo.results(task.id)
      const status = taskStatusOf(rows)
      const failed = rows.find((r) => r.status === 'failed' && r.errorText)
      const { errorText: _oldError, ...rest } = task
      const next: EcommerceTaskRecord = {
        ...rest,
        updatedAt: Date.now(),
        status,
        ...(failed?.errorText ? { errorText: failed.errorText } : {}),
      }
      await taskRepo.updateTask(next)
      setActiveTask(next)
      setResultRows(rows)
    },
    [projectId, taskRepo],
  )
  /** 刷新历史批次列表（#399 第二期 / #479 的任务列表 UI）。 */
  const refreshTaskHistory = useCallback(async () => {
    try {
      setTaskHistory(await taskRepo.list(projectId))
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 任务历史读取失败', { error: String(e) })
    }
  }, [platform, projectId, taskRepo])

  const removeFailedResult = useCallback(
    async (taskId: string, resultId: string) => {
      const next = await taskRepo.removeResult(resultId)
      if (!next) return
      if (activeTask?.id === taskId) {
        setActiveTask(next.task)
        setResultRows(next.results)
      }
      await refreshTaskHistory()
      await refreshWorkbench()
    },
    [activeTask?.id, refreshTaskHistory, refreshWorkbench, taskRepo],
  )

  /**
   * 结果卡上的编辑动作只编辑**显式副本**。
   *
   * 内部执行节点仍在画布里承担 runEngine，但用户从电商结果进入编辑时，
   * 新建（或复用）一份 `canvasCopyNodeId`，之后改名、连线、改参数都不再影响任务。
   */
  const ensureResultCopy = useCallback(
    (row: EcommerceResultRecord) => {
      const copy = ensureEcommerceCanvasCopy({
        store,
        projectId,
        result: row,
        title: `电商结果 ${row.position + 1}`,
      })
      if (copy.created) {
        const next: EcommerceResultRecord = {
          ...row,
          canvasCopyNodeId: copy.nodeId,
          updatedAt: Date.now(),
        }
        void taskRepo
          .updateResult(next)
          .then(() => setResultRows((rows) => rows.map((item) => (item.id === next.id ? next : item))))
          .catch((error) => {
            platform.logger.log('warn', '[ecommerce] 保存画布副本引用失败', {
              error: String(error),
            })
          })
      }
      return copy
    },
    [platform, projectId, store, taskRepo],
  )

  const handleCanvasItemsChange = useCallback(
    (next: EcommerceCanvasItem[]) => {
      const before = canvasItemsRef.current
      const nextIds = new Set(next.map((item) => item.id))
      const beforeIds = new Set(before.map((item) => item.id))
      const hiddenResultIds = before
        .filter((item) => item.resultId && !nextIds.has(item.id))
        .map((item) => item.resultId as string)
      const restoredResultIds = next
        .filter((item) => item.resultId && !beforeIds.has(item.id))
        .map((item) => item.resultId as string)
      canvasItemsRef.current = next
      setCanvasItems(next)
      void Promise.all([
        ...hiddenResultIds.map((resultId) => taskRepo.setResultHidden(resultId, true)),
        ...restoredResultIds.map((resultId) => taskRepo.setResultHidden(resultId, false)),
      ]).catch((error) => {
        platform.logger.log('warn', '[ecommerce] 工作台结果显隐保存失败', {
          error: String(error),
        })
      })
      canvasSaveQueueRef.current = canvasSaveQueueRef.current
        .then(() => canvasRepo.replace(projectId, next))
        .catch((error) => {
          platform.logger.log('warn', '[ecommerce] 工作台布局保存失败', { error: String(error) })
          store.notify('工作台布局没保存下来，请稍后再试', 'error')
        })
    },
    [canvasRepo, platform, projectId, store, taskRepo],
  )

  const retryWorkbenchResult = useCallback(
    async (resultId: string) => {
      const row =
        workbenchResults.find((result) => result.id === resultId) ??
        resultRows.find((result) => result.id === resultId)
      if (!row) return
      const { errorText: _oldError, ...rest } = row
      const running: EcommerceResultRecord = {
        ...rest,
        status: 'running',
        updatedAt: Date.now(),
      }
      await taskRepo.updateResult(running)
      setResultRows((rows) =>
        rows.map((result) => (result.id === running.id ? running : result)),
      )
      await exec.runNode(row.nodeId, { inPlace: true })
      await syncResultRow(row.taskId, row.nodeId)
      if (activeTask?.id === row.taskId) await refreshTask(activeTask)
      await refreshTaskHistory()
      await queueWorkbenchRefresh()
    },
    [
      activeTask,
      exec,
      queueWorkbenchRefresh,
      refreshTask,
      refreshTaskHistory,
      resultRows,
      syncResultRow,
      taskRepo,
      workbenchResults,
    ],
  )

  const handleWorkbenchAction = useCallback(
    (item: EcommerceCanvasItem, action: EcommerceWorkbenchAction) => {
      const row =
        (item.resultId
          ? workbenchResults.find((result) => result.id === item.resultId) ??
            resultRows.find((result) => result.id === item.resultId)
          : null) ?? null
      if (action === 'retry') {
        if (row) void retryWorkbenchResult(row.id)
        return
      }
      const hash = item.assetHash ?? row?.assetHash
      if (!hash) return
      if (action === 'download') {
        void downloadAsset({ assets: platform.assets, files: platform.files }, hash)
        return
      }
      if (action === 'save') {
        void (async () => {
          const payload = await platform.assets.read(hash)
          await assetLibraryRepo.save({
            hash,
            mime:
              payload?.mime ??
              row?.mime ??
              (item.kind === 'video' ? 'video/mp4' : 'image/png'),
            bytes: payload?.bytes.length ?? 0,
            width: row?.width ?? item.width,
            height: row?.height ?? item.height,
            savedAt: Date.now(),
            projectId,
            ...(row?.prompt ? { prompt: row.prompt } : {}),
            ...(row?.model ? { model: row.model } : {}),
          })
        })()
          .then(() => store.notify('已收藏到素材库', 'info'))
          .catch(() => store.notify('收藏失败', 'error'))
        return
      }
    },
    [
      assetLibraryRepo,
      platform,
      projectId,
      resultRows,
      retryWorkbenchResult,
      store,
      workbenchResults,
    ],
  )

  /** 点一条历史批次：把结果区切到那一批，不改表单、不重跑。 */
  const onSelectTask = useCallback(
    async (taskId: string) => {
      const task = taskHistory.find((item) => item.id === taskId)
      if (!task) return
      const rows = await taskRepo.results(taskId)
      setActiveTask(task)
      setResultRows(rows)
      setTaskLoaded(true)
    },
    [taskHistory, taskRepo],
  )

  /** 删一条历史批次；删的是当前批次就自动切到剩下最近一批。 */
  const onRemoveTask = useCallback(
    async (taskId: string) => {
      try {
        await taskRepo.remove(taskId)
        const list = await taskRepo.list(projectId)
        setTaskHistory(list)
        if (activeTask?.id === taskId) {
          const next = list[0] ?? null
          setActiveTask(next)
          setResultRows(next ? await taskRepo.results(next.id) : [])
        }
      } catch (e) {
        platform.logger.log('warn', '[ecommerce] 删除任务批次失败', { error: String(e) })
      }
    },
    [activeTask, platform, projectId, taskRepo],
  )
  /** 立刻把最新草稿写库（离页 / 关窗 / 防抖到点三条路共用）。 */
  const flushDraft = useCallback(() => {
    if (draftTimer.current !== null) {
      window.clearTimeout(draftTimer.current)
      draftTimer.current = null
    }
    const draft = draftLatest.current
    if (draft) void saveEcommerceDraft(platform.storage, projectId, draft)
  }, [platform, projectId])

  /**
   * 表单变化先留在内存，500ms 防抖落库。
   *
   * 不逐键写库（补充要求会一次打很多字），也不等"用户自己记得保存"：
   * 离页与 `pagehide` 都会 flush，桌面壳里切页 / 关窗不丢最后一笔。
   */
  const handleDraftChange = useCallback(
    (draft: EcommerceFormDraft) => {
      draftLatest.current = draft
      setSavedDraft(draft)
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
      draftTimer.current = window.setTimeout(() => {
        draftTimer.current = null
        void saveEcommerceDraft(platform.storage, projectId, draft)
      }, 500)
    },
    [platform, projectId],
  )

  useEffect(() => {
    const onHide = () => flushDraft()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flushDraft()
    }
  }, [flushDraft])

  /**
   * 对话模型与画布同口径：下拉只显示固定前端显示名，渠道是实现细节；
   * 真正请求时由 `resolveRouteFor` 按全局选路策略选择启用且可路由的渠道。
   *
   * 用 `useSyncExternalStore` 而不是读一次：用户去设置页改完渠道再切回来，
   * 这一栏的按钮状态必须立刻跟上，否则会停在"没有可用的对话模型"上，看起来像坏了。
   */
  const channelList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const editModels = useMemo(() => {
    const enabled = channelList.filter((channel) => channel.enabled)
    return logicalNames(enabled).filter((name) => {
      const capability = capabilityOfLogical(enabled, name)
      return (
        capability?.category === 'image' &&
        capability.inputTypes.includes('image')
      )
    })
  }, [channelList])
  const upscaleProfiles = useMemo(
    () =>
      ECOMMERCE_UPSCALE_OPTIONS.filter((option) =>
        channelList.some(
          (channel) =>
            channel.enabled &&
            channel.models.some(
              (model) => model.id === option.model && model.category === 'image',
            ),
        ),
      ).map((option) => option.id),
    [channelList],
  )
  const routeStrategy = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().routeStrategy,
    () => channels.getState().routeStrategy,
  )
  const routedChatChannels = useMemo(
    () =>
      channelList.filter(
        (channel) =>
          channel.protocol !== 'mock' &&
          channel.enabled &&
          channelIsRoutable(channel),
      ),
    [channelList],
  )
  const chatRouteSources = useMemo(
    () =>
      routedChatChannels.map((channel) => ({
        id: channel.id,
        enabled: channel.enabled,
        /** 与画布执行宿主同一口径：localhost / 本机网关无令牌也可路由。 */
        hasToken: channelIsRoutable(channel),
        priority: channel.priority,
        weight: channel.weight,
        lastTestLatency: channel.lastTestLatency,
        modelIds: channel.models.map((model) => model.id),
        modelMap: channel.modelMap,
      })),
    [routedChatChannels],
  )
  const intentModelOptions = useMemo(
    () =>
      panelModelOptions('chat').filter(
        (name) =>
          resolveRouteFor(chatRouteSources, name, {
            strategy: routeStrategy,
            resolve: resolveUpstreamModel,
          }) !== null,
      ),
    [chatRouteSources, routeStrategy],
  )
  const [intentModel, setIntentModel] = useState('')
  const chatTarget = useMemo(
    () => {
      const selected = intentModelOptions.includes(intentModel)
        ? intentModel
        : (intentModelOptions[0] ?? '')
      const route = resolveRouteFor(chatRouteSources, selected, {
        strategy: routeStrategy,
        resolve: resolveUpstreamModel,
      })
      return route
        ? { channelId: route.channelId, model: selected, label: selected }
        : null
    },
    [chatRouteSources, intentModel, intentModelOptions, routeStrategy],
  )

  /**
   * 一句话 → 待确认草稿（对账 #422）。
   *
   * 三条硬口径：
   *  ① 模型回什么都要过 `parseEcommerceIntent`（白名单），解析不过**一个字都不改表单**；
   *  ② 没配对话模型 / 超时 / 渠道报错，一律**如实说**，绝不静默填一份猜的值；
   *  ③ 这里只产**草稿** —— 真填表由工作台里那句「应用到表单」触发。
   */
  /** 读一遍这个项目的方案历史（读失败只记日志：历史是"顺手留下的"，不该挡住出图这条主路） */
  const refreshPlanHistory = useCallback(async () => {
    try {
      const rows = await planSessions.list(projectId)
      const list = rows
        .map((row) => toPlanSession(row))
        .filter((item): item is EcommercePlanSession => item !== null)
      setPlanHistory(recentPlanSessions(list))
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 方案历史读取失败', { error: String(e) })
    }
  }, [planSessions, platform, projectId])

  useEffect(() => {
    void refreshPlanHistory()
  }, [refreshPlanHistory])

  /** 存一条方案：**存失败不影响这次解析**（草稿已经在界面上了），但要在日志里留痕 */
  const savePlanSession = async (text: string, draft: EcommerceIntentDraft) => {
    if (!chatTarget) return
    try {
      const created = await planSessions.create({
        projectId,
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        title: planTitleOf(text),
      })
      await planSessions.save({ ...created, messages: toPlanMessages(text, draft) })
      await refreshPlanHistory()
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 方案历史写入失败', { error: String(e) })
    }
  }

  const onParseIntent = async (text: string) => {
    if (!chatTarget) {
      setIntent(null)
      setIntentError('没有可用的对话模型 —— 先去「设置 → 渠道配置」给一条渠道勾上对话模型')
      return
    }
    setParsingIntent(true)
    setIntentError('')
    setIntent(null)
    /* 30 秒兜底：解析是"一句话"的小请求，卡住不该让按钮一直转 */
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: buildIntentSystem() },
          { role: 'user', content: buildIntentText(text, platforms) },
        ],
        signal: ac.signal,
      })
      const parsed = parseEcommerceIntent(result.text, { platforms, fallbackNote: text })
      if (parsed.ok) {
        setIntent(parsed.draft)
        /* 顺手留一条历史方案（对账 #433）—— 不 await：这一步失败不该拖住界面 */
        void savePlanSession(text, parsed.draft)
      } else setIntentError(parsed.error)
    } catch (e) {
      if (ac.signal.aborted) {
        setIntentError('解析超时（30 秒没回）。稍后再试，或直接填表单。')
      } else {
        const err = asAppError(e)
        setIntentError(err ? describeError(err) : '解析失败：这次没能拿到结果，稍后再试。')
      }
    } finally {
      clearTimeout(timer)
      setParsingIntent(false)
    }
  }

  const onWriteSellingPoints = async (request: EcommerceRequest): Promise<string> => {
    if (!chatTarget) {
      throw new Error('没有可用的对话模型 —— 先在渠道配置里勾选一个对话模型')
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const platform =
        ECOMMERCE_PLATFORMS.find((item) => item.id === request.platformId)?.name ?? '通用'
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          {
            role: 'system',
            content:
              '你是电商图片文案助手。只根据用户已经提供的事实，写 2–4 句简洁的商品卖点与画面要求。' +
              '不要编造参数、认证、功效、价格或品牌信息；只输出可直接放进输入框的正文，不要标题、解释或 JSON。',
          },
          {
            role: 'user',
            content: [
              `功能：${request.modeLabel ?? '电商图片'}`,
              `平台：${platform}`,
              `文案语言：${languageLabel(request.language)}`,
              `用户已有要求：${request.note?.trim() || '无'}`,
              `专属配置：${request.modePrompt?.trim() || '无'}`,
            ].join('\n'),
          },
        ],
        signal: ac.signal,
      })
      const text = result.text.trim().replace(/^```(?:text)?\s*|\s*```$/g, '').trim()
      if (!text) throw new Error('模型没有返回可用的卖点文案')
      return text.slice(0, 500)
    } catch (e) {
      if (ac.signal.aborted) throw new Error('AI 帮写超时（30 秒没回），请稍后重试')
      const err = asAppError(e)
      throw new Error(err ? describeError(err) : 'AI 帮写失败，请稍后重试')
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 调出一条旧方案 = **把那张确认卡放回来**（草稿进 `intent`），不直接填表单：
   * 用户点的是「我看看这条」，真正落表仍由那句「应用到表单」触发（与 #422 同一条口径）。
   */
  const onRestorePlan = (session: EcommercePlanSession) => {
    setIntent(session.draft)
    setIntentError('')
  }

  /** 删一条历史方案（删不动只记日志：列表是顺手留下的，不该弹错挡住出图） */
  const onRemovePlan = async (id: string) => {
    try {
      await planSessions.remove(id)
      await refreshPlanHistory()
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 方案历史删除失败', { error: String(e) })
    }
  }

  const onUpload = async (file: File, _kind: 'product' | 'reference'): Promise<EcommerceUpload | null> => {
    /**
     * **先挡一道类型**（对账 #427）：`accept="image/*"` 只管文件对话框，
     * **拖放绕得过它** —— `.txt` 拖进来会一路落库、变成一个破图预览。
     * 口径与画布那边一致（画布是导入后判、这里是导入前判，更省一次写入）：
     * 已知类型不是图/视频就拒收；**类型为空放行**（有些图没扩展名，别把它们冤枉掉）。
     */
    if (file.type && !isImportableMedia(file.type)) return null
    const deps = { platform, store, projectId }
    const asset = await importAssetFile(deps, file)
    if (!asset) return null
    /* 素材节点落点：一列一列往右排，与生成节点分开（用户之后在画布里能一眼分清） */
    /* 素材节点往下排：与生成节点那一列分开，用户之后在画布里能一眼分清谁是输入 */
    const index = store.getSnapshot().nodes.length
    const nodeId = createAssetNode(deps, asset, { x: 40, y: 40 + index * 200 })
    if (!nodeId) return null
    return {
      nodeId,
      hash: asset.hash,
      preview: <ResultPreview hash={asset.hash} />,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
    }
  }

  const onWorkbenchUpload = async (
    file: File,
  ): Promise<{ hash: string; width?: number; height?: number } | null> => {
    const uploaded = await onUpload(file, 'product')
    return uploaded
      ? {
          hash: uploaded.hash,
          ...(uploaded.width ? { width: uploaded.width } : {}),
          ...(uploaded.height ? { height: uploaded.height } : {}),
        }
      : null
  }

  /**
   * 问一次对话渠道，把这几张的镜头写出来（对账 #406 / #423）。
   *
   * **两个入口共用这一支**：出图前「先出一份方案」，与出图时那条自动扩展。
   * 各写一份的话，迟早出现"手动那条会先说多花额度、自动那条不会"这种分叉
   * （#406 那条"判据只能有一份"的教训，这里是"请求只能有一份"）。
   *
   * **不抛错**：所有失败都变成 `{ ok:false, error }` —— 调用方要的是"能不能拿到方案"，
   * 而不是一个异常（分镜失败从来不该让出图失败）。
   */
  const visualInputsFor = (request: EcommerceRequest): Extract<NodeInput, { kind: 'asset' }>[] => {
    const nodeIds = [
      ...new Set([
        request.productNodeId,
        ...(request.productNodeIds ?? []),
        ...request.referenceNodeIds,
      ]),
    ].filter(Boolean)
    const raw: NodeInput[] = []
    for (const nodeId of nodeIds) {
      const node = graph.nodes.find((item) => item.id === nodeId)
      if (!node) continue
      const mime =
        typeof (node.data as { assetMime?: unknown }).assetMime === 'string'
          ? ((node.data as { assetMime: string }).assetMime)
          : 'image/png'
      for (const assetHash of assetHashesOfNode(node)) {
        raw.push({ kind: 'asset', nodeId, assetHash, mime })
      }
    }
    return imageAssetInputsOf(raw)
  }

  const requestShots = async (request: EcommerceRequest): Promise<ShotPlanResult> => {
    if (!chatTarget) {
      return {
        ok: false,
        error: '没有可用的对话模型 —— 先去「设置 → 渠道配置」给一条渠道勾上对话模型',
      }
    }
    const visualInputs = visualInputsFor(request)
    if (visualInputs.length === 0) {
      return {
        ok: false,
        error: '没有可随对话发送的商品图 —— 无法先分析产品外观，已停止本次生图。',
      }
    }
    setGenerationStage({
      phase: 'analyze',
      label: '正在分析商品原图与需求',
      detail: `已附 ${visualInputs.length} 张视觉素材`,
    })
    const ac = new AbortController()
    /* 多模态请求要读图并写逐张提示词，给 60 秒；卡住也必须如实失败。 */
    const timer = setTimeout(() => ac.abort(), 60_000)
    try {
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        inputs: visualInputs,
        messages: [
          { role: 'system', content: buildShotsSystem() },
          {
            role: 'user',
            content: buildShotsText(request, platforms, visualInputs.length),
          },
        ],
        signal: ac.signal,
      })
      const parsed = parseShotsReply(result.text, request.count, {
        usage: request.usage,
        ratio: request.ratio,
      })
      if (parsed.ok) {
        setGenerationStage({
          phase: 'prompts',
          label: '正在整理逐张生图提示词',
          detail: parsed.analysis,
        })
      }
      return parsed.ok
        ? {
            ok: true,
            shots: parsed.shots,
            analysis: parsed.analysis,
            designSystem: parsed.designSystem,
          }
        : { ok: false, error: parsed.error }
    } catch (e) {
      const err = asAppError(e)
      return {
        ok: false,
        error: ac.signal.aborted
          ? '商品分析与提示词请求超时（60 秒没回）。'
          : err
            ? describeError(err)
            : '商品分析与提示词请求失败。',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 「先出一份方案」的入口（对账 #423）：工作台点按钮 → 这里问一次 → 结果原样回去。
   *
   * 同一段请求也盖进 `preparingShots`：否则"出方案"那几秒里「开始生成」点得动，
   * 用户会为同一批图花两份对话额度。
   */
  const onPlanShots = async (request: EcommerceRequest): Promise<ShotPlanResult> => {
    setPreparingShots(true)
    try {
      return await requestShots(request)
    } finally {
      setPreparingShots(false)
    }
  }

  const onGenerate = async (
    request: EcommerceRequest,
    shotPlan?: readonly EcommerceShot[],
    lineage?: {
      sourceTaskId?: string
      sourceResultId?: string
      sourceAssetHash?: string
    },
  ) => {
    setSubmitting(true)
    setShotPlanNote('')
    setGenerationStage({ phase: 'validate', label: '正在检查素材与参数' })
    try {
      /**
       * ① **先按确定性脚本建一次计划**：它同时完成**全部校验**。
       *
       * 校验不过就当场抛错，**绝不在一个非法请求上先花掉一次对话额度**。
       */
      let plan = buildEcommercePlan(request, { platforms })

      /**
       * ② **商品分析 + 最终提示词**。
       *
       * 白底图保留抽卡语义；编辑直接使用用户的编辑指令。其余商品图必须先把
       * 商品原图随对话发出，让模型返回 productAnalysis 与每张的最终 prompt。
       * 这一步失败时停止，不再拿策划简报冒充生图提示词。
       */
      const usablePlan = shotPlan && shotPlan.length === request.count ? shotPlan : null
      if (usablePlan) {
        plan = buildEcommercePlan(request, { platforms, shots: usablePlan })
        setShotPlanNote(`这 ${request.count} 张使用已确认的逐张方案。`)
        setGenerationStage({ phase: 'prompts', label: '正在采用已确认的逐张提示词' })
      } else if (shouldExpandShots(request)) {
        if (!chatTarget) {
          throw new Error(
            '没有可用的对话模型：无法先分析商品原图并写逐张提示词。为避免把策划文案直接送去生图，本轮未生成。',
          )
        }
        setPreparingShots(true)
        try {
          const out = await requestShots(request)
          if (!out.ok) {
            throw new Error(`商品分析或逐张提示词生成失败：${out.error}`)
          }
          plan = buildEcommercePlan(request, { platforms, shots: out.shots })
          setShotPlanNote(
            `已分析商品图，并由 ${chatTarget.label} 生成 ${request.count} 条不同的最终提示词。`,
          )
        } finally {
          setPreparingShots(false)
        }
      } else {
        setGenerationStage({
          phase: 'prompts',
          label:
            request.usage === 'white-bg'
              ? '正在准备白底图抽卡提示词'
              : '正在准备编辑提示词',
        })
      }

      const mediaKind = request.mediaKind ?? 'image'
      const recipe = await channels.defaultForNewNode({}, mediaKind)
      const target = resolveGenerationTarget({
        channels: channelList,
        category: mediaKind,
        catalog: channels.protocolCatalog(),
        strategy: routeStrategy,
        ...(request.model ? { logicalModel: request.model } : {}),
        ...(request.channelId ? { channelId: request.channelId } : {}),
        recipe,
      })
      if (!target) {
        throw new Error(
          request.model
            ? `所选模型「${request.model}」没有可用的真实${mediaKind === 'video' ? '视频' : '生图'}渠道`
            : mediaKind === 'video'
              ? '还没有可用的视频渠道 —— 先去「全局设置 → 渠道配置」配一条并勾上视频模型'
              : '还没有可用的生图渠道 —— 先去「全局设置 → 渠道配置」配一条并勾上模型',
        )
      }
      const modelForRun = target.logicalModel
      const channelForRun = target.channelId

      /**
       * **两段式**（对账 #410）：先异步解析全部默认值，再在同一个
       * `beginPlan` / `endPlan` 内同步落节点，保证一次撤销整批退回。
       */
      const batchId = createId('ecb')
      const prescribed: {
        at: { x: number; y: number }
        data: Record<string, unknown>
        metadata: ReturnType<typeof resultMetadataOf>
      }[] = []
      for (let i = 0; i < plan.count; i += 1) {
        const shot = plan.shots[i]
        const metadata = resultMetadataOf({
          shotTitle: shot?.title,
          brief: shot?.brief,
          ratio: shot?.ratio,
          headline: shot?.headline,
          subheadline: shot?.subheadline,
          visualSystem: shot?.visualSystem,
        })
        const data = await resolveDefaults({
          channels,
          type: 'generation',
          extraData: {
            mode: mediaKind,
            channelId: channelForRun,
            model: modelForRun,
            ecommerceBatch: batchId,
            /** 第 i 张只发第 i 条最终提示词；白底图仍允许 N 条相同（抽卡）。 */
            prompt: plan.prompts[i] ?? plan.prompt,
            ratio: ecommerceAspectRatio(shot?.ratio ?? plan.ratio),
            ...(shot?.title ? { shotTitle: shot.title } : {}),
            ...(shot?.brief ? { brief: shot.brief } : {}),
            ...(shot?.headline ? { headline: shot.headline } : {}),
            ...(shot?.subheadline ? { subheadline: shot.subheadline } : {}),
            ...(shot?.visualSystem ? { visualSystem: shot.visualSystem } : {}),
            ...(request.resolution ? { resolution: request.resolution } : {}),
            ...(request.quality ? { quality: request.quality } : {}),
            count: 1,
            ...(request.scale ? { scale: request.scale } : {}),
            ...(mediaKind === 'video' ? { durationSec: request.durationSec ?? 5 } : {}),
          },
        })
        prescribed.push({
          at: { x: 420 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 240 },
          data,
          metadata,
        })
      }
      setGenerationStage({ phase: 'workflow', label: '正在创建工作流' })
      const created: string[] = []
      const createdMetadata: ReturnType<typeof resultMetadataOf>[] = []
      store.beginPlan('ecommerce:generate', `电商出图 ×${prescribed.length}`)
      try {
        for (const item of prescribed) {
          const id = applyDefaults({
            store,
            channels,
            projectId,
            type: 'generation',
            at: item.at,
            data: item.data,
          })
          if (!id) continue
          created.push(id)
          createdMetadata.push(item.metadata)
          store.setSelection([id])
          /* 产品图与参考图都连成上游：引擎按上游素材收集输入。 */
          for (const productNodeId of plan.productNodeIds) {
            store.dispatch({ kind: 'edge.connect', source: productNodeId, target: id })
          }
          for (const ref of plan.referenceNodeIds) {
            store.dispatch({ kind: 'edge.connect', source: ref, target: id })
          }
        }
      } finally {
        store.endPlan()
      }
      if (created.length === 0) throw new Error('工作流没有建成：生成节点未能写入画布')

      /**
       * 先落任务与逐格结果，再并发跑引擎。
       * 写失败不挡出图；结果表是结果真源，但存储失败不能反过来阻断请求。
       */
      let task: EcommerceTaskRecord | null = null
      try {
        const effectiveRequest: EcommerceRequest = {
          ...request,
          resolvedModel: modelForRun,
          resolvedChannelId: channelForRun,
        }
        const createdTask = await taskRepo.create({
          projectId,
          batchId,
          request: effectiveRequest,
          nodeIds: created,
          metadata: createdMetadata,
          ...(lineage?.sourceTaskId ? { sourceTaskId: lineage.sourceTaskId } : {}),
          ...(lineage?.sourceResultId ? { sourceResultId: lineage.sourceResultId } : {}),
          ...(lineage?.sourceAssetHash ? { sourceAssetHash: lineage.sourceAssetHash } : {}),
        })
        task = createdTask.task
        setActiveTask(task)
        setResultRows(createdTask.results)
      } catch {
        setActiveTask(null)
        setResultRows([])
      }
      if (task) acquireEcommerceTaskLease(task.id)
      if (task) await queueWorkbenchRefresh()
      let completed = 0
      setGenerationStage({
        phase: 'generate',
        label: `正在生成 0/${created.length}`,
        current: 0,
        total: created.length,
      })

      /*
       * 请求已经提交，`onGenerate` 不再等图片返回。进度改从 RunRecord / 任务结果表
       * 轮询收口：这比依赖执行 Promise 更适合跨路由页面，也能在结果表先完成时
       * 同步更新阶段条，不会一直停在“生成 0/N”。
       */
      const runJobs = created.map((id) =>
        exec.runNode(id).then(async () => {
          if (task) await syncResultRow(task.id, id)
        }),
      )
      const allJobs = Promise.all(runJobs)
      void allJobs.catch(() => undefined)
      if (task) {
        const currentTask = task
        void (async () => {
          const startedAt = Date.now()
          try {
            while (Date.now() - startedAt < 10 * 60_000) {
              await taskRepo.reconcileFromRunRecords(projectId)
              const rows = await taskRepo.results(currentTask.id)
              completed = rows.filter(
                (row) => row.status === 'done' || row.status === 'failed' || row.status === 'canceled',
              ).length
              setGenerationStage((current) =>
                current?.phase === 'done'
                  ? current
                  : {
                      phase: 'generate',
                      label: `正在生成 ${completed}/${created.length}`,
                      current: completed,
                      total: created.length,
                    },
              )
              if (completed >= created.length) break
              await new Promise((resolve) => window.setTimeout(resolve, 250))
            }
            await refreshTask(currentTask)
            await refreshTaskHistory()
            await queueWorkbenchRefresh()
            setGenerationStage({
              phase: 'done',
              label: `本批已结束 ${created.length}/${created.length}`,
              current: created.length,
              total: created.length,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : '生成失败'
            setGenerationStage({ phase: 'failed', label: '生成失败', detail: message })
          } finally {
            releaseEcommerceTaskLease(currentTask.id)
          }
        })()
      } else {
        void allJobs
          .then(async () => {
            await refreshTaskHistory()
            await queueWorkbenchRefresh()
            setGenerationStage({
              phase: 'done',
              label: `本批已结束 ${created.length}/${created.length}`,
              current: created.length,
              total: created.length,
            })
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '生成失败'
            setGenerationStage({ phase: 'failed', label: '生成失败', detail: message })
          })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败'
      setGenerationStage({ phase: 'failed', label: '生成失败', detail: message })
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * 以当前结果图为上游做一次**定向 AI 编辑**。
   *
   * 先确保编辑对象是独立画布副本，再把副本作为产品图输入；新产物另起一个批次，
   * 原结果与内部执行节点都不动。这样“换背景”失败或效果不满意时，历史仍可回看。
   */
  const editResult = async (
    nodeId: string,
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => {
    const row =
      resultRows.find((item) => item.nodeId === nodeId || item.canvasCopyNodeId === nodeId) ?? null
    if (!row) throw new Error('没找到这张结果对应的素材记录')
    const text = instruction.trim()
    if (!text) throw new Error('先在左侧「补充要求」写清要换成的背景')
    const copy = ensureResultCopy(row)
    await onGenerate(
      {
        usage: 'edit',
        platformId: activeTask?.request.platformId,
        language: activeTask?.request.language ?? 'zh-CN',
        count: 1,
        ratio: activeTask?.request.ratio ?? '1:1',
        productNodeId: copy.nodeId,
        referenceNodeIds: options?.referenceNodeId ? [options.referenceNodeId] : [],
        note: text,
        ...(options?.model || row.model
          ? { model: options?.model || row.model }
          : {}),
      },
      undefined,
      {
        sourceTaskId: row.taskId,
        sourceResultId: row.id,
        ...(row.assetHash ? { sourceAssetHash: row.assetHash } : {}),
      },
    )
  }

  /**
   * 批量编辑仍逐张走 `editResult`：每张独立复制、独立任务、独立结果记录。
   * 不把多个节点塞进一个任务，失败时才能知道具体是哪张没改成。
   */
  const editResults = async (
    nodeIds: readonly string[],
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => {
    for (const nodeId of nodeIds) {
      await editResult(nodeId, instruction, options)
    }
  }

  /**
   * AI 超清：把结果复制成独立节点，再调用真实的 Topaz 超分模型。
   *
   * 这里不走提示词模板，也不允许“看起来更清楚”的普通生图；模型必须来自当前
   * RunningHub 渠道勾选的 Topaz 端点。新任务照常保留来源，可用于前后对比。
   */
  const upscaleResult = async (
    nodeId: string,
    profile: EcommerceUpscaleProfile,
    scale: EcommerceUpscaleScale,
  ) => {
    const row =
      resultRows.find((item) => item.nodeId === nodeId || item.canvasCopyNodeId === nodeId) ?? null
    if (!row?.assetHash) throw new Error('没找到这张结果的原始素材')
    const option = upscaleOptionOf(profile)
    const target = channelList.find(
      (channel) =>
        channel.enabled &&
        channel.models.some(
          (model) => model.id === option.model && model.category === 'image',
        ),
    )
    if (!target) {
      throw new Error(`当前没有可用的「${option.model}」渠道，请先在 RunningHub 勾选该模型`)
    }
    const copy = ensureResultCopy(row)
    await onGenerate(
      {
        usage: 'edit',
        channelId: target.id,
        platformId: activeTask?.request.platformId,
        language: activeTask?.request.language ?? 'zh-CN',
        count: 1,
        ratio: activeTask?.request.ratio ?? '1:1',
        productNodeId: copy.nodeId,
        referenceNodeIds: [],
        note: upscaleNoteOf(profile, scale),
        model: option.model,
        scale,
      },
      undefined,
      {
        sourceTaskId: row.taskId,
        sourceResultId: row.id,
        sourceAssetHash: row.assetHash,
      },
    )
  }

  const results = useMemo<EcommerceResultItem[]>(() => {
    const downloadOf = (hash: string | undefined) =>
      hash
        ? () => {
            /* 下载复用既有那份实现：它认识"素材已不在库里"与"远端素材在新标签页打开"两档 */
            void downloadAsset({ assets: platform.assets, files: platform.files }, hash)
          }
        : undefined

    const saveToLibraryOf = (
      hash: string | undefined,
      meta: {
        width?: number
        height?: number
        prompt?: string
        model?: string
        ratio?: string
      },
    ) =>
      hash
        ? async () => {
            try {
              const payload = await platform.assets.read(hash)
              if (!payload) return
              await assetLibraryRepo.save({
                hash,
                mime: payload.mime,
                bytes: payload.bytes.length,
                ...(meta.width ? { width: meta.width } : {}),
                ...(meta.height ? { height: meta.height } : {}),
                savedAt: Date.now(),
                projectId,
                ...(meta.prompt ? { prompt: meta.prompt } : {}),
                ...(meta.model ? { model: meta.model } : {}),
                ...(meta.ratio ? { ratio: meta.ratio } : {}),
              })
            } catch (e) {
              platform.logger.log('warn', '[ecommerce] 收藏结果失败', { error: String(e) })
            }
          }
        : undefined

    /** 新口径：结果真源是 ecommerceResults；内部节点只用来跑引擎 / 释放重跑入口。 */
    if (activeTask) {
      return resultRows.map((row) => {
        const node = graph.nodes.find((n) => n.id === row.nodeId)
        const hash = row.assetHash ?? (node ? assetHashesOfNode(node)[0] : undefined)
        const natural = (node?.data as { naturalSize?: { width?: unknown; height?: unknown } } | undefined)
          ?.naturalSize
        const width =
          row.width ?? (typeof natural?.width === 'number' && natural.width > 0 ? natural.width : undefined)
        const height =
          row.height ??
          (typeof natural?.height === 'number' && natural.height > 0 ? natural.height : undefined)
        const liveState = exec.nodeStateOf(row.nodeId)
        const status: EcommerceResultItem['status'] = resultDisplayStatus({
          stored: row.status,
          ...(liveState?.kind ? { live: liveState.kind } : {}),
          hasAsset: !!hash,
        })
        const rerunnable = !!node && status !== 'running'
        const rerun = async (inPlace = false) => {
          const before = new Set(store.getSnapshot().nodes.map((item) => item.id))
          await exec.runNode(row.nodeId, inPlace ? { inPlace: true } : undefined)
          let taskForRefresh = activeTask
          if (!inPlace) {
            const carriers = store
              .getSnapshot()
              .nodes.filter(
                (item) =>
                  !before.has(item.id) &&
                  (item.data as { __carrierOf?: string }).__carrierOf === row.nodeId,
              )
            if (carriers.length > 0) {
              const appended = await taskRepo.appendResults(
                activeTask.id,
                carriers.map((item) => item.id),
                carriers.map(() => resultMetadataOf(row)),
              )
              taskForRefresh = appended.task
              setActiveTask(appended.task)
              setResultRows(appended.results)
              for (const carrier of carriers) {
                await syncResultRow(activeTask.id, carrier.id)
              }
            } else {
              await syncResultRow(activeTask.id, row.nodeId)
            }
          } else {
            await syncResultRow(activeTask.id, row.nodeId)
          }
          await refreshTask(taskForRefresh)
          await refreshTaskHistory()
          await queueWorkbenchRefresh()
        }
        return {
          nodeId: row.nodeId,
          resultId: row.id,
          status,
          imageHash: hash,
          ...(row.mime ? { mime: row.mime } : {}),
          pixelSize: width !== undefined && height !== undefined ? { width, height } : null,
          error:
            row.errorText ??
            (liveState?.kind === 'failed' ? describeError(liveState.error) : undefined) ??
            (row.status === 'canceled' ? '已取消（结果仍保留在库里）' : undefined),
          preview: hash ? <ResultPreview hash={hash} mime={row.mime} /> : undefined,
          sourcePreview: activeTask.sourceAssetHash ? (
            <ResultPreview hash={activeTask.sourceAssetHash} />
          ) : undefined,
          ...(row.prompt ? { prompt: row.prompt } : {}),
          ...(row.model ?? activeTask.request.model
            ? { model: row.model ?? activeTask.request.model }
            : {}),
          ratio: row.ratio ?? activeTask.request.ratio,
          ...(row.shotTitle ? { shotTitle: row.shotTitle } : {}),
          ...(row.brief ? { brief: row.brief } : {}),
          ...(row.headline ? { headline: row.headline } : {}),
          ...(row.subheadline ? { subheadline: row.subheadline } : {}),
          ...(row.visualSystem ? { visualSystem: row.visualSystem } : {}),
          ...(activeTask.request.note ? { note: activeTask.request.note } : {}),
          createdAt: row.createdAt,
          onDownload: downloadOf(hash),
          onSaveToLibrary: saveToLibraryOf(hash, {
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
            ...(row.prompt ? { prompt: row.prompt } : {}),
            ...(row.model ? { model: row.model } : {}),
            ...((row.ratio ?? activeTask.request.ratio)
              ? { ratio: row.ratio ?? activeTask.request.ratio }
              : {}),
          }),
          /**
           * 失败 / 取消后的“重新生成”必须先把结果行切回 running。
           * 直接 `rerun(false)` 会让旧 failed RunRecord 继续压住新状态，
           * 用户点击后看到的仍是失败卡，无法判断请求是否真的发出。
           */
          onRerun:
            row.status === 'failed' || row.status === 'canceled'
              ? () => retryWorkbenchResult(row.id)
              : rerunnable
                ? () => rerun(false)
                : undefined,
          onReplace: rerunnable ? () => rerun(true) : undefined,
          onRemoveFailed:
            row.status === 'failed'
              ? () => void removeFailedResult(activeTask.id, row.id)
              : undefined,
        }
      })
    }

    /** 老项目还没有任务行：沿用旧口径从内部节点兜底；下一次生成就会写入新表。 */
    return nodeIds.map((id) => {
      const node = graph.nodes.find((n) => n.id === id)
      const data = node?.data as
        | { prompt?: unknown; model?: unknown; ratio?: unknown; assetMime?: unknown }
        | undefined
      const state = exec.nodeStateOf(id)
      const hash = node ? assetHashesOfNode(node)[0] : undefined
      const sizeRaw = (node?.data as { naturalSize?: { width?: unknown; height?: unknown } } | undefined)
        ?.naturalSize
      const pixelSize =
        typeof sizeRaw?.width === 'number' &&
        typeof sizeRaw?.height === 'number' &&
        sizeRaw.width > 0 &&
        sizeRaw.height > 0
          ? { width: sizeRaw.width, height: sizeRaw.height }
          : null
      const status: EcommerceResultItem['status'] =
        resultDisplayStatus({
          stored: 'pending',
          ...(state?.kind ? { live: state.kind } : {}),
          hasAsset: !!hash,
        })
      return {
        nodeId: id,
        status,
        imageHash: hash,
        ...(typeof data?.assetMime === 'string' && data.assetMime
          ? { mime: data.assetMime }
          : {}),
        pixelSize,
        error: state?.kind === 'failed' ? describeError(state.error) : undefined,
        preview: hash ? (
          <ResultPreview
            hash={hash}
            mime={typeof data?.assetMime === 'string' ? data.assetMime : undefined}
          />
        ) : undefined,
        onDownload: downloadOf(hash),
        onSaveToLibrary: saveToLibraryOf(hash, {
          ...(pixelSize ? { width: pixelSize.width, height: pixelSize.height } : {}),
          ...(typeof data?.prompt === 'string' && data.prompt ? { prompt: data.prompt } : {}),
          ...(typeof data?.model === 'string' && data.model ? { model: data.model } : {}),
          ...(typeof data?.ratio === 'string' && data.ratio ? { ratio: data.ratio } : {}),
        }),
        onRerun:
          status === 'running' ? undefined : () => exec.runNode(id),
        onReplace:
          status === 'running' ? undefined : () => exec.runNode(id, { inPlace: true }),
      }
    })
  }, [
    activeTask,
    resultRows,
    nodeIds,
    exec,
    graph.nodes,
    platform,
    projectId,
    syncResultRow,
    refreshTask,
    refreshTaskHistory,
    assetLibraryRepo,
    taskRepo,
    store,
  ])

  /*
   * 阶段条的第二条真相来源：页面已经拿到的结果状态。
   *
   * 单张执行 Promise 在跨路由 / 并发批次的收尾时机并不适合作为唯一进度来源；
   * 只要结果表或实时节点状态已经给出终态，就在这里补齐 x/N 与“已结束”，
   * 避免结果卡已经完成而阶段条还停在 1/N。
   */
  useEffect(() => {
    if (!activeTask || results.length === 0) return
    const terminal = results.filter((result) => result.status !== 'running').length
    if (terminal === 0) return
    setGenerationStage((current) => {
      if (terminal >= results.length) {
        const label = `本批已结束 ${results.length}/${results.length}`
        return current?.phase === 'done' && current.label === label
          ? current
          : {
              phase: 'done',
              label,
              current: results.length,
              total: results.length,
            }
      }
      if (current?.phase === 'done') return current
      const label = `正在生成 ${terminal}/${results.length}`
      return current?.phase === 'generate' && current.label === label
        ? current
        : {
            phase: 'generate',
            label,
            current: terminal,
            total: results.length,
          }
    })
  }, [activeTask, results])

  const failedCount = results.filter((r) => r.status === 'failed').length
  const downloadableCount = results.filter((r) => r.status === 'done' && r.imageHash).length

  /** 串行下载当前批次；并发触发多个下载会被浏览器拦。 */
  const downloadAll = useCallback(async () => {
    let index = 0
    for (const result of results) {
      if (result.status !== 'done' || !result.imageHash) continue
      index += 1
      await downloadAsset(
        { assets: platform.assets, files: platform.files },
        result.imageHash,
        `轻画-电商-${index}`,
      )
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }, [platform, results])

  /** 一键重试失败 / 取消的结果；逐张跑，全部走既有执行链路。 */
  const retryFailed = useCallback(async () => {
    const ids = activeTask
      ? resultRows
          .filter((r) => r.status === 'failed' || r.status === 'canceled')
          .map((r) => r.id)
      : results
          .filter((r) => r.status === 'failed')
          .flatMap((r) => (r.resultId ? [r.resultId] : []))
    if (ids.length === 0) return
    for (const resultId of ids) await retryWorkbenchResult(resultId)
  }, [
    activeTask,
    retryWorkbenchResult,
    resultRows,
    results,
  ])

  /**
   * 长图拼合的输入（对账 #420）：只取**已完成且有真实像素**的。
   *
   * `results` 本身是 memo（依赖执行状态与图），空闲时引用稳定 ⇒ 长图不会每帧重画。
   */
  const longTiles = useMemo<LongImageTileSource[]>(
    () =>
      results.flatMap((r) => {
        if (
          r.status !== 'done' ||
          !r.imageHash ||
          !r.pixelSize ||
          r.mime?.startsWith('video/')
        )
          return []
        return [
          {
            id: r.nodeId,
            hash: r.imageHash,
            width: r.pixelSize.width,
            height: r.pixelSize.height,
          },
        ]
      }),
    [results],
  )

  /* 草稿读出来再挂工作台：否则会先闪一版默认值，再把刚恢复的上传槽顶掉。 */
  if (savedDraft === undefined) return null

  return (
    <EcommerceStudio
      projectName={projectName || '未命名项目'}
      initialDraft={savedDraft}
      initialProducts={initialUploads.products}
      initialReferences={initialUploads.references}
      onDraftChange={handleDraftChange}
      platforms={platforms}
      models={models}
      videoModels={videoModels}
      imageParamOptionsByModel={imageParamOptionsByModel}
      editModels={editModels}
      model={model}
      onModelChange={setModel}
      onUpload={onUpload}
      onWriteSellingPoints={onWriteSellingPoints}
      onGenerate={onGenerate}
      onEditResult={editResult}
      onEditResults={editResults}
      onUpscaleResult={upscaleResult}
      upscaleProfiles={upscaleProfiles}
      running={submitting || preparingShots}
      results={results}
      workbench={
        <EcommerceWorkbench
          projectId={projectId}
          items={canvasItems}
          results={workbenchResults}
          tasks={taskHistory}
          runs={workbenchRuns}
          activeResults={resultRows}
          running={exec.isRunning}
          availableActions={['download', 'save', 'retry']}
          onItemsChange={handleCanvasItemsChange}
          onCanvasUpload={onWorkbenchUpload}
          onAction={handleWorkbenchAction}
          channelLabelOf={(channelId) =>
            channelList.find((channel) => channel.id === channelId)?.name ?? channelId
          }
          onRemoveFailed={(resultId) => {
            const row =
              workbenchResults.find((result) => result.id === resultId) ??
              resultRows.find((result) => result.id === resultId)
            if (row) void removeFailedResult(row.taskId, resultId)
          }}
        />
      }
      onRetryFailed={failedCount > 0 ? () => void retryFailed() : undefined}
      failedCount={failedCount}
      onDownloadAll={downloadableCount > 0 ? () => void downloadAll() : undefined}
      downloadableCount={downloadableCount}
      onParseIntent={onParseIntent}
      parsingIntent={parsingIntent}
      intent={intent}
      planHistory={planHistory}
      onRestorePlan={onRestorePlan}
      onRemovePlan={onRemovePlan}
      taskHistory={taskHistory}
      activeTaskId={activeTask?.id ?? ''}
      onSelectTask={(taskId) => void onSelectTask(taskId)}
      onRemoveTask={(taskId) => void onRemoveTask(taskId)}
      chatTargetLabel={chatTarget?.label ?? ''}
      chatModels={intentModelOptions}
      intentModel={intentModel}
      onIntentModelChange={setIntentModel}
      onConfigureChannels={() => openGlobalSettings('channels')}
      intentError={intentError}
      onIntentApplied={() => setIntent(null)}
      onIntentDiscard={() => {
        setIntent(null)
        setIntentError('')
      }}
      onPlanShots={onPlanShots}
      shotPlanNote={shotPlanNote}
      generationStage={generationStage}
      onOpenLongImage={() => setLongOpen(true)}
      longImage={(tools) =>
        longOpen ? (
          <LongImagePanel
            tiles={longTiles}
            tools={tools}
            onClose={() => setLongOpen(false)}
          />
        ) : null
      }
    />
  )
}
