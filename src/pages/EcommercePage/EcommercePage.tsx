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
  chatTargetOptions,
  resolveChatTarget,
  userConfiguredChannels,
} from '../../domain/shared/chatTarget'
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
import { assetHashesOfNode } from '../../domain/canvas/graph/assetRefs'
import { projectRoute } from '../../domain/shared/workbench'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { asAppError, describeError } from '../../shared/result'
import { createId } from '../../shared/id'
import { createPackStore } from '../../state/project/packStore'
import { loadEcommerceDraft, saveEcommerceDraft } from '../../state/project/ecommerceDraft'
import { createEcommerceTaskRepository } from '../../state/project/ecommerceTaskRepository'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import { ensureEcommerceCanvasCopy } from '../../features/ecommerce/ensureCanvasCopy'
import {
  cleanEcommerceDraftRefs,
  type EcommerceFormDraft,
} from '../../domain/ecommerce/draft'
import {
  resultDisplayStatus,
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
import type { Edge } from '../../domain/canvas/model/edge'
import type { EcommerceRequest } from '../../domain/ecommerce/types'
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
 * 结果字节仍是内容寻址的 `assets`。所以"发送到画布"在这里就是「在画布里打开」
 * —— 结果本来就已经是这个项目的画布节点。专业版（#380）要独立数据模型时再补表。
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
        上传产品图、选平台与用途，右边直接出图。结果会落成这个项目的画布节点，
        所以随时能换个界面继续细修。
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
  const navigate = useNavigate()
  const taskRepo = useMemo(() => createEcommerceTaskRepository(platform.storage), [platform])
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
  const models = useMemo(() => panelModelOptions('image'), [])
  const videoModels = useMemo(() => panelModelOptions('video'), [])
  /**
   * 平台清单 = 内置 + **扩展包带进来的规则**（对账 #386 的 E3）。
   *
   * 同 id 时以扩展包为准：包就是用来"更新规则而不必等应用发版"的，
   * 若被内置那份压住，这个机制就白做了。
   */
  const [platforms, setPlatforms] = useState<readonly EcommercePlatform[]>(ECOMMERCE_PLATFORMS)

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
      const [latestRow, initialList] = await Promise.all([
        taskRepo.latestWithResults(projectId),
        taskRepo.list(projectId),
      ])
      if (cancelled) return
      let latest = latestRow
      let list = initialList
      for (const runningTask of initialList.filter((task) => task.status === 'running')) {
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
    })()
    return () => {
      cancelled = true
    }
  }, [taskRepo, projectId])

  /** 把某一格从内部节点的最新状态同步回结果表（跑完 / 失败 / 取消都走这里）。 */
  const syncResultRow = useCallback(
    async (taskId: string, nodeId: string) => {
      const node = store.getSnapshot().nodes.find((n) => n.id === nodeId)
      const state = exec.nodeStateOf(nodeId)
      const hash = node ? assetHashesOfNode(node)[0] : undefined
      const natural = (node?.data as { naturalSize?: { width?: unknown; height?: unknown } } | undefined)
        ?.naturalSize
      const data = node?.data as
        | { prompt?: unknown; model?: unknown; assetMime?: unknown }
        | undefined
      const width =
        typeof natural?.width === 'number' && natural.width > 0 ? natural.width : undefined
      const height =
        typeof natural?.height === 'number' && natural.height > 0 ? natural.height : undefined
      const current = (await taskRepo.results(taskId)).find((r) => r.nodeId === nodeId)
      if (!current) return
      const status: EcommerceResultRecord['status'] =
        state?.kind === 'canceled'
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
        ...(state?.kind === 'failed' ? { errorText: describeError(state.error) } : {}),
      }
      await taskRepo.updateResult(next)
      setResultRows((rows) => rows.map((row) => (row.id === next.id ? next : row)))
    },
    [exec, store, taskRepo],
  )

  /** 用最新的逐格状态收口整批任务（running / partial / done / failed / canceled）。 */
  const refreshTask = useCallback(
    async (task: EcommerceTaskRecord) => {
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
    [taskRepo],
  )
  /** 刷新历史批次列表（#399 第二期 / #479 的任务列表 UI）。 */
  const refreshTaskHistory = useCallback(async () => {
    try {
      setTaskHistory(await taskRepo.list(projectId))
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 任务历史读取失败', { error: String(e) })
    }
  }, [platform, projectId, taskRepo])

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

  const openCanvasCopy = useCallback(
    (row: EcommerceResultRecord, mode?: 'extract' | 'crop' | 'annotate' | 'rotate') => {
      try {
        const copy = ensureResultCopy(row)
        navigate(
          projectRoute(
            'canvas',
            projectId,
            mode
              ? { focus: copy.nodeId, [mode]: true }
              : { focus: copy.nodeId },
          ),
        )
      } catch (error) {
        platform.logger.log('warn', '[ecommerce] 创建画布副本失败', { error: String(error) })
        store.notify('创建画布副本失败，请稍后重试', 'error')
      }
    },
    [ensureResultCopy, navigate, platform, projectId],
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
   * 对话渠道：**只认用户真勾过对话模型的启用渠道**，找不到就如实说没配
   * （`resolveChatTarget`，与漫剧拆镜同一条口径 —— 对账 #414 / #422）。
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
  const ownChatChannels = useMemo(
    () => userConfiguredChannels(channelList),
    [channelList],
  )
  const intentModelOptions = useMemo(
    () => chatTargetOptions(ownChatChannels),
    [ownChatChannels],
  )
  const [intentModel, setIntentModel] = useState('')
  const chatTarget = useMemo(
    () => resolveChatTarget(ownChatChannels, intentModel),
    [intentModel, ownChatChannels],
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
    return { nodeId, hash: asset.hash, preview: <ResultPreview hash={asset.hash} /> }
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
  const requestShots = async (request: EcommerceRequest): Promise<ShotPlanResult> => {
    if (!chatTarget) {
      return {
        ok: false,
        error: '没有可用的对话模型 —— 先去「设置 → 渠道配置」给一条渠道勾上对话模型',
      }
    }
    const ac = new AbortController()
    /* 30 秒兜底：分镜是一次小请求，卡住就该早点回落去出图 */
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: buildShotsSystem() },
          { role: 'user', content: buildShotsText(request, platforms) },
        ],
        signal: ac.signal,
      })
      const parsed = parseShotsReply(result.text, request.count)
      return parsed.ok ? { ok: true, shots: parsed.shots } : { ok: false, error: parsed.error }
    } catch (e) {
      const err = asAppError(e)
      return {
        ok: false,
        error: ac.signal.aborted
          ? '分镜请求超时（30 秒没回）。'
          : err
            ? describeError(err)
            : '分镜请求失败。',
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
    /**
     * ① **先按确定性脚本建一次计划**：它同时完成**全部校验**。
     *
     * 顺序有讲究 —— 校验不过就当场抛错，**绝不在一个非法请求上先花掉一次对话额度**
     * （先问分镜再校验，等于让用户为一次必然失败的生成多付一次对话费）。
     */
    let plan = buildEcommercePlan(request, { platforms })

    /**
     * ② **分镜**（对账 #406 / #423）。三条路，按优先级：
     *  - **A 用户已经确认过一份**（`shotPlan`，条数与张数对得上）⇒ 直接用，**不再多花**；
     *  - **B 值得问、且有对话模型** ⇒ 现问一次（判据与确认卡那句提示是同一个纯函数）；
     *  - **C 其余** ⇒ 用第 ① 步那份确定性脚本。
     * 无论走哪条，**绝不因为分镜失败而让用户出不了图**，并且**如实说走了哪条、为什么**。
     */
    const usablePlan = shotPlan && shotPlan.length === request.count ? shotPlan : null
    if (usablePlan) {
      plan = buildEcommercePlan(request, { platforms, shots: usablePlan })
      setShotPlanNote(`这 ${request.count} 张的镜头用的是你刚确认的那份方案。`)
    } else if (shouldExpandShots(request)) {
      if (!chatTarget) {
        setShotPlanNote('这几张用的是默认镜头脚本：没有可用的对话模型。')
      } else {
        const target = chatTarget
        setPreparingShots(true)
        try {
          const out = await requestShots(request)
          if (out.ok) {
            plan = buildEcommercePlan(request, { platforms, shots: out.shots })
            setShotPlanNote(
              `这 ${request.count} 张的镜头是按你的要求现写的（${target.label}，多花了一次对话额度）。`,
            )
          } else {
            setShotPlanNote(`这几张用了默认镜头脚本：${out.error}`)
          }
        } finally {
          setPreparingShots(false)
        }
      }
    } else {
      /* 这一趟没打算问模型：把上一次的说明清掉，免得挂在界面上误导 */
      setShotPlanNote('')
    }

    const mediaKind = request.mediaKind ?? 'image'
    const recipe = await channels.defaultForNewNode({}, mediaKind)
    if (!recipe?.channelId || !recipe?.model) {
      throw new Error(
        mediaKind === 'video'
          ? '还没有可用的视频渠道 —— 先去「全局设置 → 渠道配置」配一条并勾上视频模型'
          : '还没有可用的生图渠道 —— 先去「全局设置 → 渠道配置」配一条并勾上模型',
      )
    }
    /* 用户选过就用他选的；没选过还是走解析出来的默认那一套 */
    const modelForRun = request.model || recipe.model
    const requestedChannel = channelList.find(
      (channel) =>
        channel.enabled &&
        channel.id === request.channelId &&
        channel.models.some(
          (model) => model.id === modelForRun && model.category === mediaKind,
        ),
    )
    const modelChannel = channelList.find(
      (channel) =>
        channel.enabled &&
        channel.models.some(
          (model) => model.id === modelForRun && model.category === mediaKind,
        ),
    )
    const channelForRun = requestedChannel?.id ?? modelChannel?.id ?? recipe.channelId

    /**
     * **两段式**（对账 #410）：
     *
     * ① 先把 N 张节点的默认值**全部异步解析完**（读渠道配方是异步的）；
     * ② 再在一个 `beginPlan` / `endPlan` 里**同步**落节点与连线。
     *
     * 为什么不能写成"循环里 await + 外面包一层 plan"：`beginPlan` 之间一旦让出
     * 事务边界，撤销就会断成好几步（`createNodeWithDefaults` 的文件注释记着当年怎么栽的）。
     * 于是用户按一次撤销，5 张套图应当**整批**退回去，而不是退 5 次还留着连线。
     */
    const batchId = createId('ecb')
    const prescribed: { at: { x: number; y: number }; data: Record<string, unknown> }[] = []
    for (let i = 0; i < plan.count; i += 1) {
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: mediaKind,
          channelId: channelForRun,
          model: modelForRun,
          ecommerceBatch: batchId,
          /**
           * 逐张提示词（用户 2026-10-10 #10）：第 i 张用 `plan.prompts[i]`。
           * 白底图时 N 条相同（抽卡），主图 / 详情页 / 套图逐张不同（镜头脚本）。
           */
          prompt: plan.prompts[i] ?? plan.prompt,
          ratio: ecommerceAspectRatio(plan.ratio),
          count: 1,
          ...(request.scale ? { scale: request.scale } : {}),
          ...(mediaKind === 'video' ? { durationSec: request.durationSec ?? 5 } : {}),
        },
      })
      prescribed.push({ at: { x: 420 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 240 }, data })
    }
    const created: string[] = []
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
        store.setSelection([id])
        /* 产品图与参考图都连成上游：引擎按上游素材收集输入，这是"不改产品外观"的物理来源 */
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
    /**
     * 先落任务与逐格结果，再跑引擎。
     *
     * 写失败**不挡出图**：内部节点仍会跑完，界面退回旧口径；下一次存储可用时
     * 再写入新表。结果表是结果真源，但不能反过来变成"存储一写失败就出不了图"。
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
    /* 一次生成 N 张就是 N 个独立任务；和画布一致，同时发请求，不做“排队”等待。 */
    await Promise.all(
      created.map(async (id) => {
        await exec.runNode(id)
        if (task) await syncResultRow(task.id, id)
      }),
    )
    if (task) await refreshTask(task)
    await refreshTaskHistory()
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
        }
        return {
          nodeId: row.nodeId,
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
          ratio: activeTask.request.ratio,
          ...(activeTask.request.note ? { note: activeTask.request.note } : {}),
          createdAt: row.createdAt,
          onDownload: downloadOf(hash),
          onSaveToLibrary: saveToLibraryOf(hash, {
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
            ...(row.prompt ? { prompt: row.prompt } : {}),
            ...(row.model ? { model: row.model } : {}),
            ...(activeTask.request.ratio ? { ratio: activeTask.request.ratio } : {}),
          }),
          onRerun: rerunnable ? () => rerun(false) : undefined,
          onReplace: rerunnable ? () => rerun(true) : undefined,
          onFocusInCanvas: () => openCanvasCopy(row),
          onExtractInCanvas: () => openCanvasCopy(row, 'extract'),
          onCropInCanvas: () => openCanvasCopy(row, 'crop'),
          onAnnotateInCanvas: () => openCanvasCopy(row, 'annotate'),
          onRotateInCanvas: () => openCanvasCopy(row, 'rotate'),
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
        onFocusInCanvas: () => navigate(projectRoute('canvas', projectId, { focus: id })),
        onExtractInCanvas: () =>
          navigate(projectRoute('canvas', projectId, { focus: id, extract: true })),
        onCropInCanvas: () =>
          navigate(projectRoute('canvas', projectId, { focus: id, crop: true })),
        onAnnotateInCanvas: () =>
          navigate(projectRoute('canvas', projectId, { focus: id, annotate: true })),
        onRotateInCanvas: () =>
          navigate(projectRoute('canvas', projectId, { focus: id, rotate: true })),
      }
    })
  }, [
    activeTask,
    resultRows,
    nodeIds,
    exec,
    graph.nodes,
    platform,
    navigate,
    projectId,
    openCanvasCopy,
    syncResultRow,
    refreshTask,
    refreshTaskHistory,
    assetLibraryRepo,
    taskRepo,
    store,
  ])

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
          .map((r) => r.nodeId)
      : results.filter((r) => r.status === 'failed').map((r) => r.nodeId)
    if (ids.length === 0) return
    for (const nodeId of ids) {
      /**
       * 重试失败项 = 把这一格救回来，不是再抽一张。
       * 必须显式原地运行；否则失败节点一旦已有旧产物，会另铺承载节点，
       * 而结果行仍盯着原节点，界面看起来“重试成功但结果没变”。
       */
      await exec.runNode(nodeId, { inPlace: true })
      if (activeTask) await syncResultRow(activeTask.id, nodeId)
    }
    if (activeTask) await refreshTask(activeTask)
    await refreshTaskHistory()
  }, [
    activeTask,
    exec,
    refreshTask,
    refreshTaskHistory,
    resultRows,
    results,
    syncResultRow,
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
        const edit =
          r.onFocusInCanvas &&
            r.onExtractInCanvas &&
            r.onCropInCanvas &&
            r.onAnnotateInCanvas &&
            r.onRotateInCanvas
            ? {
                focus: r.onFocusInCanvas,
                extract: r.onExtractInCanvas,
                crop: r.onCropInCanvas,
                annotate: r.onAnnotateInCanvas,
                rotate: r.onRotateInCanvas,
              }
            : undefined
        return [
          {
            id: r.nodeId,
            hash: r.imageHash,
            width: r.pixelSize.width,
            height: r.pixelSize.height,
            ...(edit ? { edit } : {}),
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
      running={exec.isRunning || preparingShots}
      results={results}
      onOpenCanvas={() => navigate(projectRoute('canvas', projectId))}
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
