import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../app/providers/SkillStoreProvider'
import { flushOnPageHide } from '../../app/session'
import { useProjectWriteSafety } from '../../app/useProjectWriteSafety'
import { createProjectRepository } from '../../state/project/repository'
import { createStoryboardStore } from '../../state/project/storyboardStore'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import { createStore } from '../../state/createStore'
import { canvasStoreFor } from '../../state/workbenches/canvas/storeCache'
import { rememberActiveWorkbench } from '../../state/project/activeCanvas'
import { CanvasStoreProvider, useCanvasStore, useGraph } from '../../workbenches/canvas/storeContext'
import {
  CanvasExecutionProvider,
  useCanvasExecution,
} from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { useAsset, useAssetMeta } from '../../features/shared/assets/index'
import { applyDefaults, resolveDefaults } from '../../features/canvas/createNodeWithDefaults'
import { assetHashesOfNode } from '../../domain/canvas/graph/assetRefs'
import { videoParamsFor } from '../../domain/canvas/layout/videoParams'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { projectRoute } from '../../domain/shared/workbench'
import { resolveSpeechTarget, type SpeechTarget } from '../../domain/shared/chatTarget'
import {
  BREAKDOWN_SKILL_ID,
  breakdownGuard,
  breakdownText,
  buildBreakdownResult,
  buildBreakdownSystem,
  parseBreakdownReply,
  replaceEpisodeShots,
  resolveChatTarget,
} from '../../domain/storyboard/breakdown'
import {
  applySplit,
  buildSplitSystem,
  buildSplitText,
  episodeSourceText,
  parseSplitReply,
  planSplitBatches,
  splitSource,
  type EpisodeEnrichment,
} from '../../domain/storyboard/episodes'
import {
  buildMergeSystem,
  buildMergeText,
  parseMergeReply,
  withoutDismissed,
  type MergeSuggestion,
} from '../../domain/storyboard/mergeSuggest'
import { asAppError, describeError } from '../../shared/result'
import { fingerprintBytesSync } from '../../domain/shared/hash'
import { digitalHumanPlanOf } from '../../domain/storyboard/digitalHuman'
import {
  buildEpisodePack,
  episodeTimeline,
  ffmpegArgs,
  srtOf,
  type PackClip,
} from '../../domain/storyboard/ffmpegPack'
import { toBytes } from '../../platform/assets'
import { mixAudioSequentially } from '../../platform/web/audioMix'
import { importAudioAsset } from '../../features/storyboard/importAudioAsset'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { EpisodePreview } from './EpisodePreview'
import { SourcePreview } from './SourcePreview'
import {
  addCharacter,
  addEpisode,
  addScene,
  addShot,
  addShotLine,
  assetBasePrompt,
  assetTurnaroundPrompt,
  attachShotImages,
  attachShotNodes,
  attachShotVideos,
  bindShotScene,
  DEFAULT_TRANSITION_SECONDS,
  dismissMerge,
  exportStoryboardMarkdown,
  moveEpisode,
  moveShot,
  mergeAsset,
  planShotRefEdges,
  removeCharacter,
  removeEpisode,
  removeScene,
  removeShot,
  removeShotLine,
  setAssetBaseHash,
  setAssetNode,
  setAssetTurnaroundHash,
  setAssetTurnaroundNode,
  setShotVideoNode,
  shotPromptWithAssets,
  shotRefNodeIds,
  shotVideoPrompt,
  shotsNeedingNode,
  shotsOf,
  speechSettingsOf,
  storyboardStats,
  toggleShotCharacter,
  updateCharacter,
  updateEpisode,
  updateScene,
  updateScript,
  updateShot,
  updateShotLine,
  updateSourceText,
  type DramaAsset,
  type DramaCharacter,
  type DramaScene,
  type StoryboardDoc,
  type StoryboardEpisode,
  type StoryboardLine,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import {
  normalizeVideoUpscaleSettings,
  VIDEO_UPSCALE_MODEL_IDS,
  videoUpscaleActionOf,
  videoUpscaleOptionsOf,
  type VideoUpscaleModelId,
} from '../../domain/storyboard/videoUpscale'
import {
  VIDEO_ERASE_MODEL_IDS,
  type VideoEraseModelId,
} from '../../domain/storyboard/videoErase'
import {
  normalizeVideoEditResolution,
  VIDEO_EDIT_MODEL_IDS,
  videoEditRequiresReferenceImage,
  videoEditResolutionsOf,
  type VideoEditModelId,
} from '../../domain/storyboard/videoEdit'
import {
  normalizeVideoExtendSettings,
  VIDEO_EXTEND_MODEL_IDS,
  videoExtendDurationsOf,
  videoExtendResolutionsOf,
  type VideoExtendModelId,
} from '../../domain/storyboard/videoExtend'
import styles from './StoryboardPage.module.css'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'

const DIGITAL_HUMAN_MODEL_IDS = [
  'Kling V2 数字人口播 Std',
  'Kling V2 数字人口播 Pro',
] as const

interface VideoUpscaleTarget {
  channelId: string
  channelName: string
  model: VideoUpscaleModelId
  label: string
  resolutions: readonly string[]
  frameRates: readonly number[]
}

interface VideoEraseTarget {
  channelId: string
  channelName: string
  model: VideoEraseModelId
  label: string
}

interface VideoEditTarget {
  channelId: string
  channelName: string
  model: VideoEditModelId
  label: string
  resolutions: readonly string[]
  supportsReferenceImage: boolean
  requiresReferenceImage: boolean
}

interface VideoExtendTarget {
  channelId: string
  channelName: string
  model: VideoExtendModelId
  label: string
  resolutions: readonly string[]
  durations: readonly number[]
}

/**
 * 漫剧工作台页（对账 #382，第一阶段）。
 *
 * 这一页只做**视频前段**：剧本 → 分集 → 分镜，出得去一份分镜表（Markdown）。
 * 逐镜视频 / 配音 / 成片合成**不在这一阶段** —— 调研稿 §4.4 的结论是：
 * 视频参数表还没补齐（#120），现在接视频只会做出一个"看着全流程、实际跑不通"的壳。
 *
 * 为什么这一页不挂画布 store：分镜不是节点图。形态若被用起来（用户真的按这个流程干活），
 * 再决定要不要把镜头接进画布出图；现在接就是替用户决定他的工作流。
 */

/** 防抖窗口：连打一串字只落一次库（与外观偏好同一条口径） */
const SAVE_DEBOUNCE_MS = 400

export function StoryboardPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <StoryboardEmpty />
  return <StoryboardProject key={projectId} projectId={projectId} />
}

/** 没有项目时的引导页：给出口，不空白（与电商工作台同一条口径） */
function StoryboardEmpty() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.create({ name: '漫剧', workbench: 'storyboard' })
      navigate(projectRoute('storyboard', project.id))
    } catch {
      setError('新建项目失败，稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className={styles.emptyWrap} data-storyboard-empty-page>
      <h1 className={styles.emptyTitle}>漫剧工作台</h1>
      <p className={styles.emptyText}>
        先把剧本写下来，再拆成分集与分镜；每一镜的画面与提示词都能直接拿去生图。
        做完导出「分镜表」，可以直接交给后面的人和工具。
      </p>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        data-storyboard-create
        onClick={() => void create()}
      >
        {busy ? '正在新建…' : '新建漫剧项目'}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.emptyHint}>也可以从「项目」页新建 —— 新建菜单里选「漫剧工作台」。</p>
    </div>
  )
}

/**
 * 漫剧项目页（**装配层**，对账 #415）：把「这一镜」与画布上的**生成节点**接起来。
 *
 * 为什么不把画布这层塞进分镜编辑器里：分镜本身不是节点图，但「出图」只有画布执行引擎会做
 * （渠道解析 / 落位 / 写回 / 留痕都在那儿）。所以这一层学电商页：页面认识两个工作台，
 * 两个工作台**彼此不认识**（架构那条 no-workbench-cross-talk 仍然成立）。
 *
 * 与画布页 / 电商页共用同一个 store 实例（`canvasStoreFor`）：在这一页铺下的节点，
 * 点「在画布里打开」之后看到的就是**同一份内存图**，不会出现两套撤销栈（对账 #411）。
 */
function StoryboardProject({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  useEffect(() => {
    rememberActiveWorkbench('storyboard', projectId)
  }, [projectId])
  const cached = canvasStoreFor(projectId, () =>
    createStore({ workbench: 'canvas', platform, projectId }),
  )
  const store = cached.store
  /**
   * 水合门与电商页同源：工作区一旦可点，用户就可能立刻铺镜头 / 上传资产；
   * 后台水合若随后补一次 `store.hydrate()`，会把刚写进内存的节点覆盖掉。
   */
  const [hydrated, setHydrated] = useState(cached.hydrated)
  const [hydrateError, setHydrateError] = useState('')

  useEffect(() => () => store.dispose(), [store])

  /**
   * 与画布页 / 电商页**共用同一份写盘保险**（对账 #453 的同款）：离开前台 / 关窗口前强制把
   * 画布那一边的写入冲一次，并在改动后广播给别的窗口。
   * 少了它，「在这一页铺到画布 → 立刻关窗口」那 ≤800ms 的写入没人兜底，
   * 两个窗口并排时也不会有人在对面收到提示。
   */
  useProjectWriteSafety(projectId, store)

  /** 只读一次库（与画布页 / 电商页同一条口径），避免把内存里正在跑的写入盖回去 */
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
      <div className={styles.emptyWrap} data-storyboard-hydrating>
        <p className={styles.emptyText}>
          {hydrateError ? `项目读取失败：${hydrateError}` : '正在读取这个漫剧项目…'}
        </p>
      </div>
    )
  }

  return (
    <CanvasStoreProvider store={store}>
      <CanvasExecutionProvider>
        <StoryboardEditor projectId={projectId} />
      </CanvasExecutionProvider>
    </CanvasStoreProvider>
  )
}

function StoryboardEditor({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const channels = useChannels()
  const channelState = useSyncExternalStore(
    channels.subscribe,
    channels.getState,
    channels.getState,
  )
  const directTrace = useCallback(
    (args: {
      subjectId: string
      kind: 'text' | 'video' | 'speech'
      channelId: string
      model: string
      payload: unknown
      inputs?: DirectRunTraceInput['inputs']
      params?: Record<string, unknown>
    }): DirectRunTraceInput => ({
      projectId,
      workbench: 'storyboard',
      subjectId: args.subjectId,
      scopeId: projectId,
      operationId: `${args.kind}:${args.subjectId}`,
      inputs: args.inputs ?? [],
      params: {
        kind: args.kind,
        channelId: args.channelId,
        model: args.model,
        ...args.params,
      },
      fingerprint: fingerprintBytesSync(
        new TextEncoder().encode(
          JSON.stringify({
            kind: args.kind,
            channelId: args.channelId,
            model: args.model,
            payload: args.payload,
            params: args.params ?? {},
          }),
        ),
      ),
    }),
    [projectId],
  )
  const digitalHumanTarget = useMemo(() => {
    for (const modelId of DIGITAL_HUMAN_MODEL_IDS) {
      const channel = channelState.channels.find(
        (item) =>
          item.enabled &&
          item.models.some(
            (model) => model.id === modelId && model.category === 'video',
          ),
      )
      if (channel) {
        return {
          channelId: channel.id,
          channelName: channel.name,
          model: modelId,
        }
      }
    }
    return null
  }, [channelState.channels])
  const videoUpscaleTargets = useMemo(() => {
    const out: VideoUpscaleTarget[] = []
    for (const channel of channelState.channels) {
      if (!channel.enabled) continue
      for (const model of VIDEO_UPSCALE_MODEL_IDS) {
        const capability = channel.models.find(
          (item) =>
            item.id === model &&
            item.category === 'video' &&
            item.inputTypes.includes('video'),
        )
        const options = videoUpscaleOptionsOf(model)
        if (!capability || !options) continue
        out.push({
          channelId: channel.id,
          channelName: channel.name,
          model,
          label: `${model} · ${channel.name}`,
          resolutions: options.resolutions,
          frameRates: options.frameRates,
        })
      }
    }
    return out
  }, [channelState.channels])
  const videoEditTargets = useMemo(() => {
    const out: VideoEditTarget[] = []
    for (const channel of channelState.channels) {
      if (!channel.enabled) continue
      for (const model of VIDEO_EDIT_MODEL_IDS) {
        const capability = channel.models.find(
          (item) =>
            item.id === model &&
            item.category === 'video' &&
            item.inputTypes.includes('video'),
        )
        const resolutions = videoEditResolutionsOf(model)
        if (!capability) continue
        out.push({
          channelId: channel.id,
          channelName: channel.name,
          model,
          label: `${model} · ${channel.name}`,
          resolutions,
          supportsReferenceImage: capability.inputTypes.includes('image'),
          requiresReferenceImage: videoEditRequiresReferenceImage(model),
        })
      }
    }
    return out
  }, [channelState.channels])
  const videoEraseTargets = useMemo(() => {
    const out: VideoEraseTarget[] = []
    for (const channel of channelState.channels) {
      if (!channel.enabled) continue
      for (const model of VIDEO_ERASE_MODEL_IDS) {
        const capability = channel.models.find(
          (item) =>
            item.id === model &&
            item.category === 'video' &&
            item.inputTypes.includes('video'),
        )
        if (!capability) continue
        out.push({
          channelId: channel.id,
          channelName: channel.name,
          model,
          label: `${model} · ${channel.name}`,
        })
      }
    }
    return out
  }, [channelState.channels])
  const videoExtendTargets = useMemo(() => {
    const out: VideoExtendTarget[] = []
    for (const channel of channelState.channels) {
      if (!channel.enabled) continue
      for (const model of VIDEO_EXTEND_MODEL_IDS) {
        const capability = channel.models.find(
          (item) =>
            item.id === model &&
            item.category === 'video' &&
            item.inputTypes.includes('video'),
        )
        const resolutions = videoExtendResolutionsOf(model)
        const durations = videoExtendDurationsOf(model)
        if (!capability) continue
        out.push({
          channelId: channel.id,
          channelName: channel.name,
          model,
          label: `${model} · ${channel.name}`,
          resolutions,
          durations,
        })
      }
    }
    return out
  }, [channelState.channels])
  const skills = useSkillsOptional()
  const navigate = useNavigate()
  /** 画布那一边：铺节点要 store，出图要执行引擎（都在 Provider 里） */
  const canvasStore = useCanvasStore()
  const graph = useGraph()
  const exec = useCanvasExecution()
  const store = useMemo(() => createStoryboardStore(platform.storage), [platform])
  const [doc, setDoc] = useState<StoryboardDoc | null>(null)
  const [projectName, setProjectName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState('')
  /** 二次确认：'' | `ep:<id>` | `shot:<id>`（删除是不可撤销的，第一下只改文案） */
  const [confirming, setConfirming] = useState('')
  /**
   * 资产合并（对账 #436）：正在合并哪一条 + 并进哪一条。
   * `keepId` 空 = 还在选目标；有值 = 第二下确认（与删资产那条"两下确认"同一条口径，
   * 但**合并不可撤销的程度不同** —— 它会把引用的 id 换掉，所以后果要先说清）。
   */
  const [merge, setMerge] = useState<{ dropId: string; keepId: string | null } | null>(null)
  /**
   * **同义归并查重**（对账 #437）：候选 + 扫描状态 + "哪一张卡在等第二下"。
   * 候选**不进文档**：模型给的是"疑似"，只有用户点了确认才真合并。
   */
  const [merges, setMerges] = useState<MergeSuggestion[]>([])
  const [mergeScan, setMergeScan] = useState<{ kind: 'idle' | 'running' | 'done' | 'error'; text: string }>({
    kind: 'idle',
    text: '',
  })
  const [mergeConfirmId, setMergeConfirmId] = useState('')
  const timer = useRef<number | null>(null)
  const pending = useRef<StoryboardDoc | null>(null)
  /**
   * 拆解（#414）：`chatTarget` = 现在会用谁去拆（没配对话模型就是 null）。
   *
   * 用 `useSyncExternalStore` 订渠道表，而不是"挂载时读一次"：用户在设置里刚配好渠道、
   * 切回这一页时，提示语与按钮状态必须立刻跟上 —— 读一次会停在"没有可用的对话模型"上，
   * 看起来就像功能坏了。
   */
  const channelList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const chatTarget = useMemo(() => resolveChatTarget(channelList), [channelList])
  const speechTarget = useMemo(() => resolveSpeechTarget(channelList), [channelList])
  const [voiceBusy, setVoiceBusy] = useState<Record<string, boolean>>({})
  const [digitalHumanBusy, setDigitalHumanBusy] = useState<string | null>(null)
  const [videoUpscaleBusy, setVideoUpscaleBusy] = useState<string | null>(null)
  const [videoEraseBusy, setVideoEraseBusy] = useState<string | null>(null)
  const [videoEditBusy, setVideoEditBusy] = useState<string | null>(null)
  const [videoExtendBusy, setVideoExtendBusy] = useState<string | null>(null)
  const [breaking, setBreaking] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [breakMsg, setBreakMsg] = useState('')
  const [breakConfirm, setBreakConfirm] = useState(false)
  const breakAbort = useRef<AbortController | null>(null)
  /** 铺到画布 / 出图这一组动作的状态行（与拆镜那条分开，免得互相盖掉） */
  /**
   * 铺到画布 / 出图 / 出视频这一组动作的状态行。
   *
   * `running` 是给"这一镜出视频"加的（对账 #429）：视频是长任务，`await` 期间
   * 界面得**如实说在跑**，而不是把上一句"已铺 N 镜"留在那儿（那会被读成"跑完了"）。
   */
  const [lay, setLay] = useState<{ kind: 'idle' | 'running' | 'done' | 'error'; text: string }>({
    kind: 'idle',
    text: '',
  })
  /**
   * 时间轴预览（对账 #432）：`null` = 没开；开着的时候记着**播到第几段 + 在不在播**。
   * 片段清单本身不进 state —— 它由 `episodeTimeline(doc, 选中集)` 现算（doc 一变就跟着变），
   * 存一份状态就有两个来源。
   */
  const [preview, setPreview] = useState<{ at: number; playing: boolean } | null>(null)
  const [rendering, setRendering] = useState(false)
  /** 原文预览（对账 #547）：分集与分镜共用；只读，不在这里编辑文档。 */
  const [sourcePreview, setSourcePreview] = useState<{
    title: string
    range?: { from: number; to: number }
    text: string
  } | null>(null)
  /** 拆集（#417）的状态行与二次确认；也各自独立 */
  const [split, setSplit] = useState<{ kind: 'idle' | 'running' | 'done' | 'error'; text: string }>({
    kind: 'idle',
    text: '',
  })
  const [splitConfirm, setSplitConfirm] = useState(false)
  const splitAbort = useRef<AbortController | null>(null)
  /** 异步回来的那一拍要拿**最新的**文档打底（跑的过程中用户可能又改了字） */
  const docRef = useRef<StoryboardDoc | null>(null)
  docRef.current = doc
  useEffect(
    () => () => {
      breakAbort.current?.abort()
      splitAbort.current?.abort()
    },
    [],
  )
  /**
   * 换一集就把「上次拆解的结果 / 待确认」清掉。
   *
   * 不清的后果很具体：在 A 集拆完显示「已拆出 3 镜」，切到还没有分镜的 B 集，
   * 那行字还挂着 —— 用户会以为 B 集已经有 3 镜了。
   */
  useEffect(() => {
    setBreakConfirm(false)
    setBreaking('idle')
    setBreakMsg('')
  }, [selectedId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await platform.storage.open()
      const [loaded, project] = await Promise.all([
        store.load(projectId),
        createProjectRepository(platform.storage).get(projectId),
      ])
      if (cancelled) return
      setDoc(loaded)
      setProjectName(project?.name ?? '')
      setSelectedId(loaded.episodes[0]?.id ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId, store])

  /** 把还没到防抖时间的写入立刻落库（导出前、离开页面前各冲一次） */
  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const next = pending.current
    pending.current = null
    if (!next) return
    await store.save(next)
  }, [store])

  useEffect(
    () => () => {
      void flush()
    },
    [flush],
  )

  /**
   * **关窗口 / 切到后台**也要把这份分镜文档冲一次（对账 #454）。
   *
   * 上面那条 cleanup 只在**路由离开**时跑；用户改完分镜**直接关窗口**时它不执行 ——
   * 而这里的保存是 **400ms 防抖**，最后那一次编辑就没了（画布页/电商页早有这道保险）。
   */
  useEffect(() => flushOnPageHide(() => void flush()), [flush])

  const apply = (next: StoryboardDoc) => {
    const stamped = { ...next, updatedAt: Date.now() }
    setDoc(stamped)
    pending.current = stamped
    setStatus('正在保存…')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      const toSave = pending.current
      pending.current = null
      if (!toSave) return
      void store.save(toSave).then(
        () => setStatus('已保存'),
        () => setStatus('保存失败'),
      )
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * **出图结果镜像回文档**（对账 #415）。
   *
   * 引擎把产物写回的是**画布节点**（真相在那儿），分镜这边要的是"这一镜出图了没有 / 是哪张"。
   * 所以在图变化时扫一遍：节点上有 hash、而文档里还没记（或记的不是这一个）⇒ 镜像过来。
   *
   * 三条边界：
   * - **只在变化时写**（`hash !== shot.imageHash`）：不然每次拖动节点都会触发一次无意义的落库；
   * - 依赖是 `graph.nodes` + `doc`：**必须用 state 里的文档、不能用 ref** ——
   *    「建节点 + 立刻跑」是一次点击里做完的（定妆图 #419 就是），ref 在那一拍还停在旧文档上
   *    （角色上还没有 nodeId），镜像会整个漏掉；而这次漏掉的 Graph 变化之后不会再来了。
   *    放进依赖不会循环：第一次写完文档，第二次跑时所有 hash 都已对上 ⇒ 没有变化 ⇒ 不再写。
   * - 用户**重出**这一镜时 hash 会变，这条判据照样把新图镜像过来（不是"有值就跳过"）。
   */
  const applyRef = useRef(apply)
  applyRef.current = apply
  useEffect(() => {
    if (!doc) return
    let next = doc
    const updates: { shotId: string; hash: string }[] = []
    for (const shot of doc.shots) {
      if (!shot.nodeId) continue
      const node = graph.nodes.find((n) => n.id === shot.nodeId)
      const hash = node ? assetHashesOfNode(node)[0] : undefined
      if (hash && hash !== shot.imageHash) updates.push({ shotId: shot.id, hash })
    }
    if (updates.length > 0) next = attachShotImages(next, updates, 0)
    /**
     * 视频那一侧（对账 #429）：同一条镜像纪律，只是走 `videoNodeId`。
     * 重出视频时 hash 会换，所以判据同样要"变了才写"（不是"有值就跳过"）。
     */
    const videoUpdates: { shotId: string; hash: string }[] = []
    for (const shot of doc.shots) {
      if (!shot.videoNodeId) continue
      const node = graph.nodes.find((n) => n.id === shot.videoNodeId)
      const hash = node ? assetHashesOfNode(node)[0] : undefined
      if (hash && hash !== shot.videoHash) videoUpdates.push({ shotId: shot.id, hash })
    }
    if (videoUpdates.length > 0) next = attachShotVideos(next, videoUpdates, 0)
    /**
     * 资产那一侧也一样（对账 #419）：定妆图 / 基准图跑完，把节点上的 hash 镜像回资产。
     * 逐条判断、有变化才写（`setAssetBaseHash` 自己会判同值），避免拖动节点时反复落库。
     */
    for (const kind of ['char', 'scene'] as const) {
      const list = kind === 'char' ? next.characters : next.scenes
      for (const asset of list) {
        if (!asset.nodeId) continue
        const node = graph.nodes.find((n) => n.id === asset.nodeId)
        const hash = node ? assetHashesOfNode(node)[0] : undefined
        /* 与镜头同一条判据：**变了才写**（重出定妆图时 hash 会换，也要镜像过来） */
        if (hash && hash !== asset.baseHash) next = setAssetBaseHash(next, kind, asset.id, hash, 0)
        if (kind === 'char' && asset.turnaroundNodeId) {
          const turnaroundNode = graph.nodes.find((n) => n.id === asset.turnaroundNodeId)
          const turnaroundHash = turnaroundNode ? assetHashesOfNode(turnaroundNode)[0] : undefined
          if (turnaroundHash && turnaroundHash !== asset.turnaroundHash) {
            next = setAssetTurnaroundHash(next, 'char', asset.id, turnaroundHash, 0)
          }
        }
      }
    }
    if (next !== doc) applyRef.current(next)
  }, [graph.nodes, doc])

  if (!doc) {
    return (
      <div className={styles.loading} data-storyboard-loading>
        正在打开漫剧项目…
      </div>
    )
  }

  const stats = storyboardStats(doc)
  const episodes = doc.episodes
  const selected = episodes.find((e) => e.id === selectedId) ?? episodes[0] ?? null
  const shots = selected ? shotsOf(doc, selected.id) : []
  const selectedSourceText = selected ? episodeSourceText(doc, selected) : ''
  const openSelectedSource = selected
    ? () =>
        setSourcePreview({
          title: selected.title,
          ...(selected.sourceRange ? { range: selected.sourceRange } : {}),
          text: selectedSourceText,
        })
    : undefined
  const selectedIndex = selected ? episodes.findIndex((e) => e.id === selected.id) : -1
  /** 画布上现在还活着的节点（"这一镜铺没铺过"要看它，不能只看 `shot.nodeId`） */
  const liveNodeIds = new Set(graph.nodes.map((n) => n.id))
  const needNodes = shotsNeedingNode(shots, liveNodeIds)
  const laidCount = shots.filter((s) => s.nodeId && liveNodeIds.has(s.nodeId)).length
  const videoPending = shots.filter(
    (shot) =>
      shot.nodeId &&
      liveNodeIds.has(shot.nodeId) &&
      shot.imageHash &&
      (!shot.videoHash ||
        !shot.videoNodeId ||
        !liveNodeIds.has(shot.videoNodeId)),
  ).length
  const voicePending = shots.reduce(
    (count, shot) =>
      count +
      shot.lines.filter((line) => line.text.trim() && !line.audioHash).length,
    0,
  )
  /**
   * 这一集的时间轴（预览播放与合成包**共用** `episodeTimeline`）。
   *
   * 不放进 `useMemo`：它在早退（`if (!doc)`）之后才轮到，用 hook 会踩"条件调用 hook"那条规则；
   * 而它本身是几个查表的纯函数，一集几十镜的开销可以忽略。
   */
  const timeline = selected ? episodeTimeline(doc, selected.id) : { clips: [], missing: [] }
  const timelineSrt = srtOf(timeline.clips)
  const timelineSrtCues = timelineSrt ? timelineSrt.split('-->').length - 1 : 0

  /**
   * **把"这一镜该接的参考图"同步到连线上**（对账 #430）。
   *
   * #419 做出来的定妆图 / 基准图此前**一个字节都没喂进生成**：它只被显示、被镜像，
   * 请求里从来没有它（这就是"假功能"长什么样）。这一步把它接上 —— 而且**不加任何新机制**：
   * 上游图正是靠连线进 `inputs` 的（G141 在视频那条链上验过同一条路）。
   *
   * 三条纪律：
   * ① **按快照算**：`getSnapshot()` 是同步真相，同一轮里已经接上的线不会再接一遍
   *    （`canConnect` 也会挡重复边）；
   * ② **没有增减就一条命令都不发**：免得每次出图都往撤销栈里塞一步空事务；
   * ③ **只断我们自己接的那些** —— 用户手工连进来的参考图一律不动（见 `planShotRefEdges`）。
   */
  const syncShotRefs = (shot: StoryboardShot, targetNodeId: string) => {
    const snapshot = canvasStore.getSnapshot()
    const live = new Set(snapshot.nodes.map((n) => n.id))
    if (!live.has(targetNodeId)) return
    const incoming = snapshot.edges
      .filter((e) => e.target === targetNodeId)
      .map((e) => e.source)
    const plan = planShotRefEdges(doc, shot, incoming, live)
    if (plan.disconnect.length === 0 && plan.connect.length === 0) return
    for (const source of plan.disconnect) {
      for (const edge of snapshot.edges) {
        if (edge.source === source && edge.target === targetNodeId) {
          canvasStore.dispatch({ kind: 'edge.remove', id: edge.id })
        }
      }
    }
    for (const source of plan.connect) {
      canvasStore.dispatch({ kind: 'edge.connect', source, target: targetNodeId })
    }
  }

  const pick = (id: string) => {
    setSelectedId(id)
    setConfirming('')
  }

  const addOneEpisode = () => {
    const next = addEpisode(doc, 0)
    apply(next)
    setSelectedId(next.episodes[next.episodes.length - 1]?.id ?? '')
    setConfirming('')
  }

  const removeOneEpisode = (id: string) => {
    if (confirming !== `ep:${id}`) {
      setConfirming(`ep:${id}`)
      return
    }
    const at = episodes.findIndex((e) => e.id === id)
    const next = removeEpisode(doc, id, 0)
    apply(next)
    setConfirming('')
    if (selected?.id === id) {
      const fallback = next.episodes[Math.min(Math.max(at, 0), next.episodes.length - 1)]
      setSelectedId(fallback?.id ?? '')
    }
  }

  const addOneShot = () => {
    if (!selected) return
    apply(addShot(doc, selected.id, 0))
    setConfirming('')
  }

  /**
   * 删资产：**两下确认**，第一下只把后果写在按钮上。
   *
   * 为什么值得单独一条：删角色不是"少一个名字"，它会**从所有引用它的镜头里去掉**
   * （领域层 `removeCharacter` / `removeScene` 做引用检查）。把"会从 N 镜里去掉"
   * 说在第二下之前，比事后让用户去猜"我那几镜的角色呢"要好。
   */
  const removeOneAsset = (kind: 'char' | 'scene', id: string) => {
    const key = `${kind}:${id}`
    if (confirming !== key) {
      setConfirming(key)
      return
    }
    apply(kind === 'char' ? removeCharacter(doc, id, 0) : removeScene(doc, id, 0))
    setConfirming('')
  }

  /**
   * 这一条可以并进哪些同类资产（对账 #436）。`refs` = 目标那条被多少镜引用 ——
   * 摆这个数字是为了让用户挑的时候看得见"并过去之后这些镜会改成谁"。
   */
  const mergeChoicesOf = (kind: 'char' | 'scene', dropId: string) =>
    (kind === 'char' ? doc.characters : doc.scenes)
      .filter((a) => a.id !== dropId)
      .map((a) => ({
        id: a.id,
        name: a.name.trim() || '未命名',
        refs: doc.shots.filter((s) =>
          kind === 'char' ? (s.characterIds ?? []).includes(a.id) : s.sceneId === a.id,
        ).length,
      }))

  /**
   * **查一遍重复**（对账 #437；研究稿 §370「归并去重，别省」）。
   *
   * 三条纪律与其它 LLM 入口一致：
   * ① **点之前就说清会花一次对话额度**（界面那行小字）；
   * ② 模型只给候选 + 理由，**一个字都不自动改文档**；
   * ③ 解析不过如实报错，不改任何状态。
   */
  const scanMerges = async () => {
    if (!chatTarget) {
      setMergeScan({
        kind: 'error',
        text: '没有可用的对话模型 —— 先去「设置 → 模型服务」给一条服务勾上对话模型',
      })
      return
    }
    setMergeScan({ kind: 'running', text: '' })
    setMerges([])
    setMergeConfirmId('')
    const ac = new AbortController()
    /* 30 秒兜底：这是一次"看一眼清单"的小请求，卡住不该让按钮一直转 */
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const system = buildMergeSystem()
      const user = buildMergeText(doc)
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        signal: ac.signal,
        trace: directTrace({
          subjectId: `project:${projectId}:merge-scan`,
          kind: 'text',
          channelId: chatTarget.channelId,
          model: chatTarget.model,
          payload: { system, user },
        }),
      })
      const parsed = parseMergeReply(result.text, doc)
      if (!parsed.ok) {
        setMergeScan({ kind: 'error', text: parsed.error })
        return
      }
      /* 用户已经说过"不是同一个"的那些不再提（#437 的第四条口径） */
      const fresh = withoutDismissed(doc, parsed.suggestions)
      setMerges(fresh)
      setMergeScan(
        fresh.length === 0
          ? { kind: 'done', text: '没发现还没确认过的重复' }
          : { kind: 'done', text: `找到 ${fresh.length} 组疑似重复 —— 逐条看过再决定` },
      )
    } catch (e) {
      if (ac.signal.aborted) {
        setMergeScan({ kind: 'error', text: '查重超时（30 秒没回）。稍后再试。' })
      } else {
        const err = asAppError(e)
        setMergeScan({ kind: 'error', text: err ? describeError(err) : '查重失败：这次没拿到结果' })
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 确认合并这一组（一次合并组里其余每一条；`mergeAsset` 一次只吃一个 drop） */
  const acceptMerge = (suggestion: MergeSuggestion) => {
    let next = doc
    for (const dropId of suggestion.dropIds) {
      next = mergeAsset(next, suggestion.kind, suggestion.keepId, dropId, 0)
    }
    apply(next)
    setMerges((list) => list.filter((item) => item !== suggestion))
    setMergeConfirmId('')
    setMergeScan({ kind: 'done', text: '已合并 —— 别名与引用都跟着过来了' })
  }

  /** 「不是同一个」：记进文档，以后不再问这一对 */
  const dismissMergeSuggestion = (suggestion: MergeSuggestion) => {
    let next = doc
    for (const dropId of suggestion.dropIds) {
      next = dismissMerge(next, suggestion.kind, suggestion.keepId, dropId, 0)
    }
    apply(next)
    setMerges((list) => list.filter((item) => item !== suggestion))
    setMergeConfirmId('')
  }

  /**
   * 「出定妆图 / 基准图」（对账 #419）：这一条资产没有节点就先建一个（提示词按资产拼），
   * 再**原地跑一次**（`inPlace`，产物写回它自己的节点，不铺第二个）。
   *
   * 节点被用户在画布上删过（悬空）时同样算"没有节点"：这里会重新建一个 ——
   * 与镜头上「铺到画布」那条判据同源（缓存不是真相）。
   */
  const makeAssetBase = async (kind: 'char' | 'scene', assetId: string) => {
    const asset = kind === 'char' ? doc.characters.find((c) => c.id === assetId) : doc.scenes.find((s) => s.id === assetId)
    if (!asset) return
    const alive = asset.nodeId && liveNodeIds.has(asset.nodeId) ? asset.nodeId : null
    try {
      let nodeId = alive
      if (!nodeId) {
        const data = await resolveDefaults({
          channels,
          type: 'generation',
          extraData: { mode: 'image', prompt: assetBasePrompt(asset, kind) },
        })
        const base = graph.nodes.length
        canvasStore.beginPlan('storyboard:asset-base', kind === 'char' ? '定妆图 ×1' : '基准图 ×1')
        try {
          nodeId = applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            at: { x: 40, y: 40 + base * 200 },
            data,
          })
        } finally {
          canvasStore.endPlan()
        }
        if (!nodeId) return
        const current = docRef.current
        if (current) apply(setAssetNode(current, kind, assetId, nodeId, 0))
      }
      await exec.runNode(nodeId, { inPlace: true })
    } catch (e) {
      setLay({ kind: 'error', text: humanError(e) })
    }
  }

  /**
   * 「多视角 turnaround」：角色专用。先建一个独立的生成节点，再原地跑。
   *
   * 如果定妆图节点还活着，就把它连成参考图 —— 多视角要的是**同一个角色**，
   * 只靠文字描述很容易生成成另一个人。节点与边放在同一个 plan 里，一次撤销全退。
   */
  const makeAssetTurnaround = async (assetId: string) => {
    const asset = doc.characters.find((c) => c.id === assetId)
    if (!asset) return
    const alive =
      asset.turnaroundNodeId && liveNodeIds.has(asset.turnaroundNodeId)
        ? asset.turnaroundNodeId
        : null
    try {
      let nodeId = alive
      if (!nodeId) {
        const data = await resolveDefaults({
          channels,
          type: 'generation',
          extraData: { mode: 'image', prompt: assetTurnaroundPrompt(asset) },
        })
        const base = graph.nodes.length
        canvasStore.beginPlan('storyboard:asset-turnaround', '多视角 ×1')
        try {
          nodeId = applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            at: { x: 40, y: 40 + base * 200 },
            data,
          })
          if (!nodeId) return
          const baseNodeId =
            asset.nodeId && liveNodeIds.has(asset.nodeId) ? asset.nodeId : null
          if (baseNodeId) {
            canvasStore.dispatch({ kind: 'edge.connect', source: baseNodeId, target: nodeId })
          }
        } finally {
          canvasStore.endPlan()
        }
        if (!nodeId) return
        const current = docRef.current
        if (current) apply(setAssetTurnaroundNode(current, 'char', assetId, nodeId, 0))
      }
      await exec.runNode(nodeId, { inPlace: true })
    } catch (e) {
      setLay({ kind: 'error', text: humanError(e) })
    }
  }

  /**
   * 「拆成多集」（对账 #417；调研稿 M7-2）。
   *
   * 分工是刻意的：**切分点由结构决定，模型只起名**。
   * - 没配对话模型 ⇒ 照样拆（章节标记 / 字数兜底都是确定性的），只是标题用结构值；
   * - 模型回错 / 超时 ⇒ **先落地结构切分**再如实报错 —— 切分不该因为模型挂了就一集都拆不出来；
   * - 已有分集 ⇒ 两下确认，第二下说清"会替换 N 集（含 M 个镜头）"（`applySplit` 会清镜头）。
   */
  const runSplit = async () => {
    if (split.kind === 'running') return
    const chunks = splitSource(doc.sourceText)
    if (chunks.length === 0) {
      setSplit({ kind: 'error', text: '还没有原文可拆：先把小说 / 大纲粘进上面的「原文」' })
      setSplitConfirm(false)
      return
    }
    if (doc.episodes.length > 0 && !splitConfirm) {
      setSplitConfirm(true)
      setSplit({ kind: 'idle', text: '' })
      return
    }
    setSplitConfirm(false)
    if (!chatTarget) {
      apply(applySplit(doc, chunks, null, 0))
      setSplit({
        kind: 'done',
        text: `按结构拆出 ${chunks.length} 集（没配对话模型，标题用章节名 / 第 N 集）`,
      })
      return
    }
    const ac = new AbortController()
    splitAbort.current = ac
    setSplit({ kind: 'running', text: '' })
    try {
      const batches = planSplitBatches(chunks)
      const enrichment: EpisodeEnrichment[] = []
      let named = 0
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i]!
        const system = buildSplitSystem()
        const user = buildSplitText(batch, i, batches.length)
        const result = await channels.completeWithTools({
          channelId: chatTarget.channelId,
          model: chatTarget.model,
          tools: [],
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          signal: ac.signal,
          trace: directTrace({
            subjectId: `project:${projectId}:split:${i + 1}`,
            kind: 'text',
            channelId: chatTarget.channelId,
            model: chatTarget.model,
            payload: { system, user },
          }),
        })
        if (ac.signal.aborted) return
        const parsed = parseSplitReply(result.text, batch.length)
        if (parsed) {
          enrichment.push(...parsed)
          named += parsed.length
        } else {
          /* 这一批没按契约来：整批回落结构标题（不硬对，免得标题整体错位） */
          for (let k = 0; k < batch.length; k += 1) {
            enrichment.push({ title: '', summary: '', hookOpen: '', hookEnd: '' })
          }
        }
      }
      const base = docRef.current
      if (!base) return
      apply(applySplit(base, chunks, enrichment, 0))
      setSplit({
        kind: 'done',
        text:
          named === chunks.length
            ? `已拆出 ${chunks.length} 集（标题 / 梗概 / 钩子由模型给）`
            : named === 0
              ? `已拆出 ${chunks.length} 集 —— 模型这次没按契约返回，标题用章节名 / 第 N 集`
              : `已拆出 ${chunks.length} 集（${named} 集有模型命名，其余用结构标题）`,
      })
    } catch (e) {
      if (ac.signal.aborted) return
      const base = docRef.current ?? doc
      apply(applySplit(base, chunks, null, 0))
      setSplit({ kind: 'error', text: `${humanError(e)} —— 已按结构先拆出 ${chunks.length} 集` })
    } finally {
      if (splitAbort.current === ac) splitAbort.current = null
    }
  }

  const cancelSplit = () => {
    splitAbort.current?.abort()
    splitAbort.current = null
    setSplit({ kind: 'idle', text: '' })
    setSplitConfirm(false)
  }

  const removeOneShot = (id: string) => {
    if (confirming !== `shot:${id}`) {
      setConfirming(`shot:${id}`)
      return
    }
    apply(removeShot(doc, id, 0))
    setConfirming('')
  }

  /** 改这一镜的通用字段（画面 / 时长 / 提示词）—— **对白层不走这里**（见 #435 的三条专属路径） */
  const patchShot = (
    id: string,
    patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId' | 'lines'>>,
  ) => {
    apply(updateShot(doc, id, patch))
  }

  /**
   * 「用模型拆这一集」（#414）。
   *
   * 四道门，一道都不省：**有对话模型** → **这一集有内容可拆** → **已有镜头时两下确认**
   * → **解析校验通过才落库**。任何一道没过都只改界面上的说明，绝不写文档。
   */
  const runBreakdown = async () => {
    if (!selected || breaking === 'running') return
    const guard = breakdownGuard(doc, selected)
    if (guard) {
      setBreaking('error')
      setBreakMsg(guard)
      setBreakConfirm(false)
      return
    }
    if (!chatTarget) {
      setBreaking('error')
      setBreakMsg('还没有可用的对话模型 —— 去「全局设置 → 模型服务」给一条服务勾上对话模型')
      setBreakConfirm(false)
      return
    }
    if (shots.length > 0 && !breakConfirm) {
      setBreakConfirm(true)
      setBreaking('idle')
      setBreakMsg('')
      return
    }
    setBreakConfirm(false)
    const ac = new AbortController()
    breakAbort.current = ac
    setBreaking('running')
    setBreakMsg('')
    try {
      /* 系统指令取**内置技能**正文（改技能即改行为），后面接机器契约（见 breakdown.ts） */
      const skill = skills.skills.find((s) => s.id === BREAKDOWN_SKILL_ID)
      const system = buildBreakdownSystem(skill?.content)
      const user = breakdownText(doc, selected)
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        signal: ac.signal,
        trace: directTrace({
          subjectId: `episode:${selected.id}:breakdown`,
          kind: 'text',
          channelId: chatTarget.channelId,
          model: chatTarget.model,
          payload: { system, user },
        }),
      })
      if (ac.signal.aborted) return
      const parsed = parseBreakdownReply(result.text)
      if (!parsed.ok) {
        setBreaking('error')
        setBreakMsg(parsed.error)
        return
      }
      const base = docRef.current
      if (!base) return
      /**
       * 拆镜 + 资产提取一起落（对账 #416）：模型给的是**名字**，先归并进资产库
       * （同名 / 别名合成一条、已有资产只增不减），再把名字翻成 id 绑到这一集的镜头上。
       */
      const built = buildBreakdownResult(base, selected.id, parsed)
      apply(replaceEpisodeShots(built.doc, selected.id, built.shots, 0))
      setBreaking('done')
      setBreakMsg(`已拆出 ${built.shots.length} 镜`)
    } catch (e) {
      if (ac.signal.aborted) return
      setBreaking('error')
      setBreakMsg(humanError(e))
    } finally {
      if (breakAbort.current === ac) breakAbort.current = null
    }
  }

  const cancelBreakdown = () => {
    breakAbort.current?.abort()
    breakAbort.current = null
    setBreaking('idle')
    setBreakMsg('')
    setBreakConfirm(false)
  }

  /**
   * 「铺到画布」：给这一集**还没铺**（或铺过的节点已被删）的镜头各建一个生成节点。
   *
   * 两条纪律：
   * ① **整批一个事务**（`beginPlan` / `endPlan`）：用户按一次撤销，这一批节点一起退回去；
   * ② 先把异步的默认配方**全部解析完**再进事务 —— 事务里夹 `await` 会把撤销断成好几步
   *    （`createNodeWithDefaults` 的文件注释记着当年怎么栽的，电商页也是这么写的）。
   *
   * 提示词就用这一镜的 `shotPrompt`（留空回落画面描述）—— 分镜里写的那句话，
   * 到此为止一直是纯文本，这一步才第一次变成"真能跑的节点"。
   */
  const layOut = async () => {
    if (!selected) return
    const targets = needNodes
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '这一集的镜头都已经在画布上了' })
      return
    }
    try {
      const base = graph.nodes.length
      const prescribed: { shotId: string; data: Record<string, unknown> }[] = []
      for (const shot of targets) {
        const data = await resolveDefaults({
          channels,
          type: 'generation',
          extraData: { mode: 'image', prompt: shotPromptWithAssets(doc, shot) },
        })
        prescribed.push({ shotId: shot.id, data })
      }
      const pairs: { shotId: string; nodeId: string }[] = []
      canvasStore.beginPlan('storyboard:lay-out', `漫剧铺到画布 ×${prescribed.length}`)
      try {
        prescribed.forEach((item, i) => {
          const nodeId = applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            at: { x: 40, y: 40 + (base + i) * 200 },
            data: item.data,
          })
          if (nodeId) pairs.push({ shotId: item.shotId, nodeId })
        })
        /**
         * 铺完立刻把参考图接上（对账 #430）：**已经出过定妆图 / 基准图**的角色与场景，
         * 它们的图就是这一镜的输入。放在同一个事务里 —— 用户按一次撤销，
         * 节点与这几条线一起退回去（线单独成事务就会散成好几步）。
         */
        for (const pair of pairs) {
          const shot = doc.shots.find((s) => s.id === pair.shotId)
          if (shot) syncShotRefs(shot, pair.nodeId)
        }
      } finally {
        canvasStore.endPlan()
      }
      const current = docRef.current
      if (current && pairs.length > 0) apply(attachShotNodes(current, pairs, 0))
      setLay({ kind: 'done', text: `已把 ${pairs.length} 镜铺到画布` })
    } catch (e) {
      setLay({ kind: 'error', text: humanError(e) })
    }
  }

  /**
   * 出图：产物**写回这一镜自己的节点**（`inPlace`，对账 #413 那条能力在这里第二次被用上）。
   *
   * 为什么不铺新节点：分镜要的是"这一镜的图"，不是"这一镜的十张候选"。
   * 想留旧图比稿的用户可以先用单镜重出（每次覆盖），或到画布上用 Alt+R —— 两条路都在。
   *
   * 出图前先 `syncShotRefs`：**定妆图是后补的**（先铺了分镜、之后才给角色出定妆图）
   * 也得吃进这一趟请求 —— 只在铺的时候接一次，后补的那张就永远喂不进去。
   */
  const runShot = (shot: StoryboardShot) => {
    if (!shot.nodeId) return
    syncShotRefs(shot, shot.nodeId)
    const refs = shotRefNodeIds(doc, shot, new Set(graph.nodes.map((n) => n.id))).length
    if (refs > 0) setLay({ kind: 'running', text: `这一镜在跑（带 ${refs} 张参考图）…` })
    void exec.runNode(shot.nodeId, { inPlace: true }).then(
      () => {
        /**
         * 「跑完」不等于「出成」：失败是**记在状态里**的（`nodeStates`），不抛异常。
         * 只看 then 就把失败报成"已出"，正是 #188 那个坑。
         */
        if (refs === 0) return
        const state = exec.nodeStateOf(shot.nodeId!)
        if (state?.kind === 'failed') {
          setLay({ kind: 'error', text: `这一镜出图失败：${describeError(state.error)}` })
          return
        }
        setLay({ kind: 'done', text: `这一镜的图已出（带了 ${refs} 张参考图）` })
      },
      (e: unknown) => setLay({ kind: 'error', text: humanError(e) }),
    )
  }

  /**
   * **「这一镜出视频」**（对账 #429）—— #428 查实"引擎那条路是通的，差的只是接线"。
   *
   * 四件事，一件都不能省：
   * ① 这一镜得先有图（图生视频是拿图去动的，没图就没得动）；
   * ② 第一次建一个 `mode:'video'` 的**新节点**；重出时**复用**它。把这一镜的图节点
   *    连上去，下一镜已出图且模型支持时再接一条尾帧 —— 上游图正是靠这两条连线进
   *    `inputs` 的（G141 验过：`[{kind:'asset',…}]`）；
   * ③ **建完节点立刻写进文档**（`setShotVideoNode`）—— 跑视频是长任务、中途失败很常见，
   *    那时节点已经躺在画布上了；不写，用户再点一次会又建一个，画布上慢慢堆起没人认领的空节点；
   * ④ 产物 hash 由上面那条镜像 effect 收回文档，列表才知道这一镜有视频了。
   *
   * **为什么另铺节点、而不像出图那样 `inPlace`**：写回会把这一镜的**图**顶掉，
   * 而图还得留着 —— 它既是视频的输入，也是分镜表里的画面。图与视频各占一个节点，两条都在。
   */
  const makeShotVideo = async (
    shot: StoryboardShot,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    const report = (kind: 'running' | 'done' | 'error', text: string) => {
      if (!options.quiet) setLay({ kind, text })
    }
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId)) {
      report('error', '这一镜还没铺到画布 —— 先铺一次，出了图再出视频')
      return false
    }
    if (!shot.imageHash) {
      report('error', '这一镜还没有图 —— 图生视频要先有画面，先点「出图」')
      return false
    }
    try {
      /**
       * 视频模型由**渠道解析**决定（与画布同一条口径：模型定下来，谁提供它由选路决定）。
       * 解析不到就如实说 —— 不硬编一个预设名去请求（#414 那条教训）。
       */
      const recipe = await channels.defaultForNewNode({}, 'video')
      if (!recipe?.channelId || !recipe?.model) {
        report('error', '还没有可用的视频模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上视频模型')
        return false
      }
      const latestDoc = docRef.current
      const episodeShots = latestDoc ? shotsOf(latestDoc, shot.episodeId) : []
      const shotIndex = episodeShots.findIndex((item) => item.id === shot.id)
      const nextShot = shotIndex >= 0 ? episodeShots[shotIndex + 1] : undefined
      const nextFrameNodeId =
        nextShot?.nodeId && nextShot.imageHash && liveNodeIds.has(nextShot.nodeId)
          ? nextShot.nodeId
          : ''
      const liveChannel = channels
        .getState()
        .channels.find((channel) => channel.id === recipe.channelId)
      const logicalModel =
        Object.entries(liveChannel?.modelMap ?? {}).find(
          ([, upstream]) => upstream === recipe.model,
        )?.[0] ?? recipe.model
      const videoSpec = videoParamsFor(logicalModel)
      /**
       * 未声明能力时不设限（项目既有口径）：认不出的渠道模型仍可按首尾帧发，
       * 由适配器 / 上游如实报错；只有**明确声明了不支持**时才回落单张首帧。
       */
      const supportsFirstLastFrame =
        !!nextFrameNodeId &&
        (videoSpec ? videoSpec.modes.includes('first-last-frame') : true)
      const endFrameNodeId = supportsFirstLastFrame ? nextFrameNodeId : ''
      const singleImageMode = videoSpec?.modes.includes('image-to-video')
        ? 'image-to-video'
        : videoSpec?.modes.includes('all-purpose')
          ? 'all-purpose'
          : undefined
      const videoMode = endFrameNodeId
        ? 'first-last-frame'
        : singleImageMode
      const videoPrompt = shotVideoPrompt(doc, shot, endFrameNodeId ? nextShot : undefined)
      const imageNode = graph.nodes.find((n) => n.id === shot.nodeId)
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'video',
          model: recipe.model,
          prompt: videoPrompt,
          durationSec: shot.durationSec,
          ...(videoMode ? { videoMode } : {}),
        },
      })
      let nodeId =
        shot.videoNodeId && liveNodeIds.has(shot.videoNodeId) ? shot.videoNodeId : ''
      canvasStore.beginPlan('storyboard:shot-video', '这一镜出视频')
      try {
        if (nodeId) {
          /**
           * 重出必须**复用原视频节点**：每次都新建会让画布堆出一排空视频节点，
           * 而分镜文档只认最后一个，前几个就永远没人认领。
           */
          canvasStore.dispatch({
            kind: 'node.updateData',
            id: nodeId,
            patch: {
              ...data,
              mode: 'video',
              model: recipe.model,
              prompt: videoPrompt,
              count: 1,
              durationSec: shot.durationSec,
              ...(videoMode ? { videoMode } : {}),
            },
          })
        } else {
          nodeId =
            applyDefaults({
              store: canvasStore,
              channels,
              projectId,
              type: 'generation',
              /* 贴着这一镜的图节点往右放（与模板「图生视频」的摆法一致，一眼看得出谁喂谁） */
              at: { x: (imageNode?.x ?? 40) + 280, y: (imageNode?.y ?? 40) },
              data,
            }) ?? ''
        }
        if (nodeId) {
          const connected = new Set(
            graph.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source),
          )
          /* 下一镜换了 / 被删了：只断我们自己记录的旧尾帧，用户手工参考图不动。 */
          if (
            shot.videoEndNodeId &&
            shot.videoEndNodeId !== endFrameNodeId &&
            connected.has(shot.videoEndNodeId)
          ) {
            const old = graph.edges.find(
              (edge) => edge.source === shot.videoEndNodeId && edge.target === nodeId,
            )
            if (old) {
              canvasStore.dispatch({ kind: 'edge.remove', id: old.id })
              connected.delete(shot.videoEndNodeId)
            }
          }
          /* 这一步是"图进请求"的全部机制：连线就是 inputs（G141 验过） */
          if (!connected.has(shot.nodeId)) {
            canvasStore.dispatch({ kind: 'edge.connect', source: shot.nodeId, target: nodeId })
            connected.add(shot.nodeId)
          }
          if (endFrameNodeId && !connected.has(endFrameNodeId)) {
            canvasStore.dispatch({
              kind: 'edge.connect',
              source: endFrameNodeId,
              target: nodeId,
            })
          }
        }
      } finally {
        canvasStore.endPlan()
      }
      if (!nodeId) {
        report('error', '视频节点没能建出来（模型服务或模型没配全）')
        return false
      }
      const current = docRef.current
      if (current) apply(setShotVideoNode(current, shot.id, nodeId, 0, endFrameNodeId))
      report(
        'running',
        endFrameNodeId
          ? '这一镜的视频在跑（首尾帧：接到下一镜的画面）…'
          : nextFrameNodeId
            ? '这一镜的视频在跑（当前视频模型不支持首尾帧，按单张首帧生成）…'
            : '这一镜的视频在跑…',
      )
      await exec.runNode(nodeId, { inPlace: true })
      const state = exec.nodeStateOf(nodeId)
      if (state?.kind === 'failed') {
        report('error', `这一镜的视频生成失败：${describeError(state.error)}`)
        return false
      }
      report(
        'done',
        endFrameNodeId
          ? '这一镜的视频已出（用了这一镜与下一镜的首尾帧）'
          : '这一镜的视频已出（画布里就挂在这一镜的图右边）',
      )
      return true
    } catch (e) {
      report('error', humanError(e))
      return false
    }
  }

  /**
   * 整镜数字人口播：RunningHub 官方数字人端点只接收一条音轨。
   * 同一角色的多句台词先按顺序合成一条 WAV；多角色镜头仍拒绝，避免把多人
   * 对白错误地映射到同一个人的口型上。
   */
  const makeDigitalHuman = async (shot: StoryboardShot) => {
    const plan = digitalHumanPlanOf(shot)
    if (!digitalHumanTarget) {
      setLay({
        kind: 'error',
        text: '当前没有可用的数字人口播模型：在 RunningHub 渠道勾选 Kling V2 数字人口播',
      })
      return
    }
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId) || !shot.imageHash) {
      setLay({ kind: 'error', text: '这一镜还没有可用的图片节点' })
      return
    }
    if (!plan.ok) {
      setLay({ kind: 'error', text: plan.reason })
      return
    }
    setDigitalHumanBusy(shot.id)
    setLay({
      kind: 'running',
      text: plan.lines.length > 1 ? '正在合并整镜配音并生成数字人视频…' : '正在调用数字人口播模型…',
    })
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const image = await platform.assets.read(shot.imageHash)
      const audioClips = await Promise.all(
        plan.lines.map(async (line) => {
          const audio = await platform.assets.read(line.audioHash!)
          if (!audio) throw new Error('有台词配音的素材字节已经不在库里')
          return audio
        }),
      )
      if (!image) {
        throw new Error('人像图或配音音频的素材字节已经不在库里')
      }
      const mixed = plan.lines.length > 1 ? await mixAudioSequentially(audioClips) : audioClips[0]!
      const audioHash =
        plan.lines.length > 1 ? fingerprintBytesSync(mixed.bytes) : plan.lines[0]!.audioHash!
      if (plan.lines.length > 1) {
        canvasStore.dispatch({
          kind: 'asset.put',
          asset: {
            hash: audioHash,
            mime: mixed.mime,
            bytes: mixed.bytes,
            createdAt: Date.now(),
            projectId,
          },
        })
      }
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: digitalHumanTarget.channelId,
        model: digitalHumanTarget.model,
        prompt:
          '生成单人数字人口播视频，保持人物身份、服装、构图与画面风格一致，口型自然贴合配音，避免夸张动作和镜头跳变。',
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.nodeId,
            assetHash: shot.imageHash,
            mime: image.mime || 'image/png',
          },
          {
            kind: 'asset',
            nodeId: shot.nodeId,
            assetHash: audioHash,
            mime: mixed.mime || 'audio/mpeg',
          },
        ],
        params: {},
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:digital-human`,
          kind: 'video',
          channelId: digitalHumanTarget.channelId,
          model: digitalHumanTarget.model,
          payload: {
            prompt:
              '生成单人数字人口播视频，保持人物身份、服装、构图与画面风格一致，口型自然贴合配音，避免夸张动作和镜头跳变。',
            imageHash: shot.imageHash,
            audioHash,
          },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('数字人口播模型没有返回视频')
      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          hash: output.hash,
          mime: output.mime || 'video/mp4',
          bytes: output.bytes,
          ...(output.url ? { url: output.url } : {}),
          createdAt: Date.now(),
          projectId,
        },
      })
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'video',
          channelId: digitalHumanTarget.channelId,
          model: digitalHumanTarget.model,
          prompt: '数字人口播',
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: output.mime || 'video/mp4',
        },
      })
      const imageNode = graph.nodes.find((node) => node.id === shot.nodeId)
      let videoNodeId =
        shot.videoNodeId && liveNodeIds.has(shot.videoNodeId) ? shot.videoNodeId : ''
      canvasStore.beginPlan('storyboard:digital-human', '单句数字人口播')
      try {
        if (videoNodeId) {
          canvasStore.dispatch({
            kind: 'node.updateData',
            id: videoNodeId,
            patch: {
              ...data,
              mode: 'video',
              channelId: digitalHumanTarget.channelId,
              model: digitalHumanTarget.model,
              prompt: '数字人口播',
              durationSec: shot.durationSec,
              assetHash: output.hash,
              assetMime: output.mime || 'video/mp4',
            },
          })
        } else {
          videoNodeId =
            applyDefaults({
              store: canvasStore,
              channels,
              projectId,
              type: 'generation',
              at: { x: (imageNode?.x ?? 40) + 280, y: (imageNode?.y ?? 40) },
              data,
            }) ?? ''
        }
        if (videoNodeId) {
          const connected = graph.edges.some(
            (edge) => edge.source === shot.nodeId && edge.target === videoNodeId,
          )
          if (!connected) {
            canvasStore.dispatch({
              kind: 'edge.connect',
              source: shot.nodeId,
              target: videoNodeId,
            })
          }
        }
      } finally {
        canvasStore.endPlan()
      }
      if (!videoNodeId) throw new Error('口播视频节点没能建出来')
      const current = docRef.current
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, videoNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text:
          plan.lines.length > 1
            ? `整镜 ${plan.lines.length} 句配音已合并，数字人口播视频已生成`
            : '这一句的数字人口播视频已生成',
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setDigitalHumanBusy(null)
      window.clearTimeout(timer)
    }
  }

  /**
   * 已有镜头视频 → 真实视频超清。
   *
   * 旧视频节点与素材一个都不动：超清结果落成新的视频节点，并把它作为旧节点的下游。
   * 镜头的 `videoNodeId / videoHash` 指向新结果；旧节点仍留在画布上可供对比 / 回退。
   */
  const makeVideoUpscale = async (
    shot: StoryboardShot,
    target: VideoUpscaleTarget,
    resolution: string,
    frameRate: number | null,
  ) => {
    if (videoUpscaleBusy) return
    if (
      !shot.videoHash ||
      !shot.videoNodeId ||
      !liveNodeIds.has(shot.videoNodeId)
    ) {
      setLay({ kind: 'error', text: '这一镜还没有可超清的视频节点' })
      return
    }
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'
    const action = videoUpscaleActionOf(target.model)
    const actionLabel = action === 'fps' ? '补帧' : '超清'
    const prompt = `视频${actionLabel}`

    setVideoUpscaleBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 处理这一镜…` })
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt,
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
        ],
        params: {
          ...(resolution ? { resolution } : {}),
          ...(frameRate !== null ? { fps: String(frameRate) } : {}),
        },
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-upscale`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: {
            prompt,
            videoHash: shot.videoHash,
            resolution,
            frameRate,
          },
          params: { resolution, frameRate },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error(`视频${actionLabel}模型没有返回视频`)
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`视频${actionLabel}返回了非视频产物：${mime}`)
      }

      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          hash: output.hash,
          mime,
          bytes: output.bytes,
          ...(output.url ? { url: output.url } : {}),
          createdAt: Date.now(),
          projectId,
        },
      })
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt,
          ...(resolution ? { resolution } : {}),
          ...(frameRate !== null ? { fps: String(frameRate) } : {}),
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: mime,
        },
      })

      let upscaleNodeId = ''
      canvasStore.beginPlan(`storyboard:video-${action}`, `镜头视频${actionLabel}`)
      try {
        upscaleNodeId =
          applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (upscaleNodeId) {
          canvasStore.dispatch({
            kind: 'edge.connect',
            source: shot.videoNodeId,
            target: upscaleNodeId,
          })
        }
      } finally {
        canvasStore.endPlan()
      }
      if (!upscaleNodeId) throw new Error(`视频${actionLabel}节点没能建出来`)

      const current = docRef.current
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, upscaleNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text: action === 'fps'
          ? '这一镜的视频补帧已完成'
          : `这一镜已生成 ${resolution}${frameRate !== null ? ` · ${frameRate}fps` : ''} 超清视频`,
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoUpscaleBusy(null)
      window.clearTimeout(timer)
    }
  }

  /** 已有镜头视频 → 用真实字幕擦除端点生成新视频节点，旧视频保留。 */
  const makeVideoErase = async (
    shot: StoryboardShot,
    target: VideoEraseTarget,
  ) => {
    if (videoEraseBusy) return
    if (!shot.videoHash || !shot.videoNodeId || !liveNodeIds.has(shot.videoNodeId)) {
      setLay({ kind: 'error', text: '这一镜还没有可擦除字幕的视频节点' })
      return
    }
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'

    setVideoEraseBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 擦除这一镜的字幕…` })
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt: '',
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
        ],
        params: {},
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-erase`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: { videoHash: shot.videoHash },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('字幕擦除模型没有返回视频')
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`字幕擦除返回了非视频产物：${mime}`)
      }

      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          hash: output.hash,
          mime,
          bytes: output.bytes,
          ...(output.url ? { url: output.url } : {}),
          createdAt: Date.now(),
          projectId,
        },
      })
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt: '视频字幕擦除',
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: mime,
        },
      })

      let eraseNodeId = ''
      canvasStore.beginPlan('storyboard:video-erase', '镜头视频字幕擦除')
      try {
        eraseNodeId =
          applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (eraseNodeId) {
          canvasStore.dispatch({
            kind: 'edge.connect',
            source: shot.videoNodeId,
            target: eraseNodeId,
          })
        }
      } finally {
        canvasStore.endPlan()
      }
      if (!eraseNodeId) throw new Error('字幕擦除节点没能建出来')

      const current = docRef.current
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, eraseNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({ kind: 'done', text: '这一镜的字幕已擦除，新视频已保存' })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoEraseBusy(null)
      window.clearTimeout(timer)
    }
  }

  /** 已有镜头视频 → 按文字指令编辑，结果落独立新视频节点，旧视频保留。 */
  const makeVideoEdit = async (
    shot: StoryboardShot,
    target: VideoEditTarget,
    instruction: string,
    resolution: string,
    useReferenceImage: boolean,
  ) => {
    if (videoEditBusy) return
    const prompt = instruction.trim()
    if (!prompt) {
      setLay({ kind: 'error', text: '先写清这段视频要改什么' })
      return
    }
    if (!shot.videoHash || !shot.videoNodeId || !liveNodeIds.has(shot.videoNodeId)) {
      setLay({ kind: 'error', text: '这一镜还没有可编辑的视频节点' })
      return
    }
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'
    const referenceNode =
      useReferenceImage && shot.nodeId && liveNodeIds.has(shot.nodeId)
        ? graph.nodes.find((node) => node.id === shot.nodeId)
        : null
    const referenceHash = useReferenceImage ? shot.imageHash : undefined
    if (
      useReferenceImage &&
      (!target.supportsReferenceImage || !referenceNode || !referenceHash)
    ) {
      setLay({ kind: 'error', text: '这一镜没有可引用的画面，取消参考图后再试' })
      return
    }
    if (target.requiresReferenceImage && !useReferenceImage) {
      setLay({ kind: 'error', text: '这个模型必须参考当前镜头画面' })
      return
    }
    const referenceMime =
      (referenceNode?.data as { assetMime?: string } | undefined)?.assetMime ?? 'image/png'

    setVideoEditBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 编辑这一镜…` })
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt,
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
          ...(referenceNode && referenceHash
            ? [
                {
                  kind: 'asset' as const,
                  nodeId: referenceNode.id,
                  assetHash: referenceHash,
                  mime: referenceMime,
                },
              ]
            : []),
        ],
        params: resolution ? { resolution } : {},
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-edit`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: {
            prompt,
            videoHash: shot.videoHash,
            referenceHash,
            resolution,
          },
          params: { resolution },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('视频编辑模型没有返回视频')
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`视频编辑返回了非视频产物：${mime}`)
      }

      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          hash: output.hash,
          mime,
          bytes: output.bytes,
          ...(output.url ? { url: output.url } : {}),
          createdAt: Date.now(),
          projectId,
        },
      })
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt,
          ...(resolution ? { resolution } : {}),
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: mime,
        },
      })

      let editNodeId = ''
      canvasStore.beginPlan('storyboard:video-edit', '镜头视频编辑')
      try {
        editNodeId =
          applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (editNodeId) {
          canvasStore.dispatch({
            kind: 'edge.connect',
            source: shot.videoNodeId,
            target: editNodeId,
          })
          if (referenceNode) {
            canvasStore.dispatch({
              kind: 'edge.connect',
              source: referenceNode.id,
              target: editNodeId,
            })
          }
        }
      } finally {
        canvasStore.endPlan()
      }
      if (!editNodeId) throw new Error('视频编辑节点没能建出来')

      const current = docRef.current
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, editNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text: resolution
          ? `这一镜的视频已按 ${resolution} 编辑完成${referenceNode ? '（已参考当前画面）' : ''}`
          : `这一镜的视频已编辑完成${referenceNode ? '（已参考当前画面）' : ''}`,
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoEditBusy(null)
      window.clearTimeout(timer)
    }
  }

  /** 已有镜头视频 → 续写后续动作，结果落独立新视频节点，旧视频保留。 */
  const makeVideoExtend = async (
    shot: StoryboardShot,
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => {
    if (videoExtendBusy) return
    if (!shot.videoHash || !shot.videoNodeId || !liveNodeIds.has(shot.videoNodeId)) {
      setLay({ kind: 'error', text: '这一镜还没有可续写的视频节点' })
      return
    }
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'
    const prompt =
      instruction.trim() || '延续当前镜头内容与运动，保持人物、场景和画风一致'

    setVideoExtendBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 续写这一镜…` })
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt,
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
        ],
        params: {
          ...(resolution ? { resolution } : {}),
          ...(duration !== null ? { duration } : {}),
        },
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-extend`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: {
            prompt,
            videoHash: shot.videoHash,
            resolution,
            duration,
          },
          params: { resolution, duration },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('视频续写模型没有返回视频')
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`视频续写返回了非视频产物：${mime}`)
      }

      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          hash: output.hash,
          mime,
          bytes: output.bytes,
          ...(output.url ? { url: output.url } : {}),
          createdAt: Date.now(),
          projectId,
        },
      })
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt,
          ...(resolution ? { resolution } : {}),
          ...(duration !== null ? { durationSec: duration } : {}),
          assetHash: output.hash,
          assetMime: mime,
        },
      })

      let extendNodeId = ''
      canvasStore.beginPlan('storyboard:video-extend', '镜头视频续写')
      try {
        extendNodeId =
          applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (extendNodeId) {
          canvasStore.dispatch({
            kind: 'edge.connect',
            source: shot.videoNodeId,
            target: extendNodeId,
          })
        }
      } finally {
        canvasStore.endPlan()
      }
      if (!extendNodeId) throw new Error('视频续写节点没能建出来')

      const current = docRef.current
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, extendNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text:
          duration !== null
            ? `这一镜已续写 ${duration} 秒${resolution ? ` · ${resolution}` : ''}`
            : `这一镜已按 ${resolution} 续写完成`,
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoExtendBusy(null)
      window.clearTimeout(timer)
    }
  }

  /** 这一集出视频：只跑“有图但还没有视频”的镜头，逐镜串行，避免免费额度被并发打满。 */
  const runEpisodeVideos = async () => {
    const targets = shots.filter(
      (shot) =>
        shot.nodeId &&
        liveNodeIds.has(shot.nodeId) &&
        shot.imageHash &&
        (!shot.videoHash ||
          !shot.videoNodeId ||
          !liveNodeIds.has(shot.videoNodeId)),
    )
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '这一集没有待出视频的镜头（要重出请用单镜那把）' })
      return
    }
    let ok = 0
    let failed = 0
    for (let i = 0; i < targets.length; i += 1) {
      setLay({
        kind: 'running',
        text: `这一集出视频 ${i + 1}/${targets.length}：第 ${shots.indexOf(targets[i]!) + 1} 镜…`,
      })
      const success = await makeShotVideo(targets[i]!, { quiet: true })
      if (success) ok += 1
      else failed += 1
    }
    setLay({
      kind: failed > 0 ? 'error' : 'done',
      text:
        failed > 0
          ? `这一集视频跑完：成功 ${ok} 镜，失败 ${failed} 镜（失败原因见各自状态）`
          : `这一集 ${ok} 镜视频已出`,
    })
  }

  /**
   * 「刷新提示词」：把**当前**资产设定重新拼进已经铺到画布的节点（对账 #418）。
   *
   * 为什么需要它：提示词是在**铺的那一刻**按当时的资产拼好的（快照）。改完角色描述，
   * 画布上的节点还是旧描述 —— 两条路：重新铺（会多铺节点，不行）或原地刷提示词（这条）。
   * 整批一个事务：按一次撤销，这一批提示词一起回到上一版。
   */
  const syncPrompts = () => {
    const targets = shots.filter((s) => s.nodeId && liveNodeIds.has(s.nodeId))
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '还没有铺到画布的镜头' })
      return
    }
    canvasStore.beginPlan('storyboard:sync-prompt', `按资产刷新提示词 ×${targets.length}`)
    try {
      for (const shot of targets) {
        canvasStore.dispatch({
          kind: 'node.updateData',
          id: shot.nodeId!,
          patch: { prompt: shotPromptWithAssets(doc, shot) },
          transient: false,
        })
      }
    } finally {
      canvasStore.endPlan()
    }
    setLay({ kind: 'done', text: `已按当前资产刷新 ${targets.length} 个节点的提示词` })
  }

  /** 这一集出图：逐镜串行（顺着分镜顺序），**已出过的跳过**；重出用单镜那把 */
  const runEpisode = async () => {
    const targets = shots.filter((s) => s.nodeId && liveNodeIds.has(s.nodeId) && !s.imageHash)
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '这一集没有待出图的镜头（要重出请用单镜那把）' })
      return
    }
    setLay({ kind: 'idle', text: '' })
    for (const shot of targets) {
      /* 整集出图与单镜出图同一条纪律：跑之前先把参考图接上（对账 #430） */
      syncShotRefs(shot, shot.nodeId!)
      await exec.runNode(shot.nodeId!, { inPlace: true })
    }
    setLay({ kind: 'done', text: `已跑完这一集 ${targets.length} 镜（失败的镜头各自标了原因）` })
  }

  const voiceLine = async (
    shot: StoryboardShot,
    lineId: string,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    const report = (text: string) => {
      if (!options.quiet) setStatus(text)
    }
    const line = shot.lines.find((item) => item.id === lineId)
    if (!line || !line.text.trim()) {
      report('先写台词，再生成配音')
      return false
    }
    if (!speechTarget) {
      report('还没有可用的配音模型：去设置里给渠道勾选一个 audio / tts 模型')
      return false
    }
    const speech = speechSettingsOf(docRef.current ?? doc, line)
    const voice = speech.voice || speechTarget.voices[0] || 'alloy'
    setVoiceBusy((current) => ({ ...current, [lineId]: true }))
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 120_000)
    try {
      const asset = await channels.generateSpeech({
        channelId: speechTarget.channelId,
        model: speechTarget.model,
        text: line.text,
        voice,
        speed: speech.speed,
        responseFormat: 'mp3',
        timeoutMs: 120_000,
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:line:${lineId}:speech`,
          kind: 'speech',
          channelId: speechTarget.channelId,
          model: speechTarget.model,
          payload: {
            text: line.text,
            voice,
            speed: speech.speed,
            responseFormat: 'mp3',
          },
          params: { voice, speed: speech.speed },
        }),
      })
      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          hash: asset.hash,
          mime: asset.mime,
          bytes: asset.bytes,
          createdAt: Date.now(),
          projectId,
        },
      })
      const base = docRef.current ?? doc
      const speaker = doc.characters.find((item) => item.id === line.speakerId)?.name ?? '旁白'
      apply(
        updateShotLine(
          base,
          shot.id,
          lineId,
          {
            audioHash: asset.hash,
            audioName: `${speaker}-${line.text.trim().slice(0, 16)}.mp3`,
          },
          Date.now(),
        ),
      )
      report(`已生成配音：${speaker} · ${line.text.trim().slice(0, 20)}`)
      return true
    } catch (error) {
      const appError = asAppError(error)
      report(appError ? describeError(appError) : String(error))
      return false
    } finally {
      window.clearTimeout(timer)
      setVoiceBusy((current) => {
        const next = { ...current }
        delete next[lineId]
        return next
      })
    }
  }

  /** 补齐本集配音：只跑“有台词且还没有音频”的句子，逐句串行，已有配音不重跑。 */
  const runEpisodeVoices = async () => {
    if (!speechTarget) {
      setStatus('还没有可用的配音模型：去设置里给渠道勾选一个 audio / tts 模型')
      return
    }
    const targets = shots.flatMap((shot) =>
      shot.lines
        .filter((line) => line.text.trim() && !line.audioHash)
        .map((line) => ({ shot, line })),
    )
    if (targets.length === 0) {
      setStatus('这一集没有待生成的台词配音')
      return
    }
    let ok = 0
    let failed = 0
    for (let i = 0; i < targets.length; i += 1) {
      const { shot, line } = targets[i]!
      setStatus(`正在补齐本集配音 ${i + 1}/${targets.length}：第 ${shots.indexOf(shot) + 1} 镜…`)
      const success = await voiceLine(
        shot,
        line.id,
        { quiet: true },
      )
      if (success) ok += 1
      else failed += 1
    }
    setStatus(
      failed > 0
        ? `本集配音跑完：成功 ${ok} 句，失败 ${failed} 句（失败原因见状态提示）`
        : `本集 ${ok} 句配音已生成`,
    )
  }

  /** 导出文件名的主干（剧名 → 项目名 → 未命名；顺手把文件名里不能用的字符换掉） */
  const exportBaseName = () =>
    (doc.script.title.trim() || projectName.trim() || '未命名漫剧').replace(/[\\/:*?"<>|]/g, '_')

  const onPickBgm = async () => {
    if (!selected) return
    setStatus('正在导入背景音乐…')
    try {
      const asset = await importAudioAsset({ platform, store: canvasStore, projectId })
      if (!asset) {
        setStatus('')
        return
      }
      apply(
        updateEpisode(
          doc,
          selected.id,
          {
            bgmHash: asset.hash,
            bgmName: asset.name,
            bgmVolume: selected.bgmVolume ?? 0.2,
          },
          Date.now(),
        ),
      )
      setStatus(`已导入背景音乐「${asset.name}」`)
    } catch (error) {
      const appError = asAppError(error)
      setStatus(appError ? describeError(appError) : String(error))
    }
  }

  const onRemoveBgm = () => {
    if (!selected) return
    apply(updateEpisode(doc, selected.id, { bgmHash: '' }, Date.now()))
    setStatus('已移除背景音乐')
  }

  const onExport = async () => {
    try {
      await flush()
      const markdown = exportStoryboardMarkdown(doc)
      await platform.files.saveFile(
        `${exportBaseName()}-分镜表.md`,
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      )
      setStatus('已导出分镜表')
    } catch {
      setStatus('导出失败')
    }
  }

  /** 只逐条读这一集真正会用到的素材元数据，不把整张 assets 表拉进内存。 */
  const loadPackAssetInfo = async (episode: StoryboardEpisode) => {
    const wanted = new Set<string>()
    for (const shot of shotsOf(doc, episode.id)) {
      const hash = shot.videoHash ?? shot.imageHash
      if (hash) wanted.add(hash)
      for (const line of shot.lines) {
        if (line.audioHash) wanted.add(line.audioHash)
      }
    }
    if (episode.bgmHash) wanted.add(episode.bgmHash)
    const info = new Map<string, { mime: string; local: boolean }>()
    for (const hash of wanted) {
      const rows = await platform.storage.query('assets', { id: hash })
      const row = rows[0] as { mime?: unknown; bytes?: unknown } | undefined
      if (!row) continue
      const bytes = toBytes(row.bytes)
      info.set(hash, {
        mime: typeof row.mime === 'string' && row.mime ? row.mime : 'image/png',
        local: !!bytes && bytes.length > 0,
      })
    }
    return info
  }

  /**
   * **导出合成包**（对账 #431；《轻画-漫剧形态调研.md》§M7-6）。
   *
   * 一份纯文本：素材清单 + **一条可直接跑的 FFmpeg 命令** + SRT 字幕。应用不替用户编码
   * （架构 §16.2：无服务端 / 无 WASM / 无原生模块），真正出片在用户本地的 FFmpeg 里。
   *
   * 素材的两种"不在本地"要**分开说**，混成一句用户就会以为包是完整的：
   * ① 还没出图的镜头 ⇒ 进不了命令（列在「缺料的镜头」）；
   * ② 出了图但只是**远端产物**（`assets` 行里只有 `url`、没有 `bytes`）⇒ 命令里有它、
   *    素材文件夹里却没有那个文件（列在「这几份素材不在素材文件夹里」）。
   */
  const onExportPack = async () => {
    if (!selected) return
    const episodeNo = episodes.findIndex((e) => e.id === selected.id) + 1
    setStatus('正在准备合成包…')
    try {
      await flush()
      /**
       * mime 与"有没有本地字节"要**逐条**查（`query('assets', { id })`）：
       * `assets` 每行都带全分辨率字节，按项目整表拉一次 = 把这一集的图全读进内存
       * （`ports.ts` 那条注释记着这个内存峰值的教训）。
       */
      const info = await loadPackAssetInfo(selected)
      const pack = buildEpisodePack({
        doc,
        episode: selected,
        episodeNo,
        assetOf: (hash) => info.get(hash),
        folderName: platform.assetFolder?.current()?.name ?? null,
      })
      if (pack.clips.length === 0) {
        setStatus('这一集还没有能合成的素材：先「铺到画布」再出图')
        return
      }
      const base = exportBaseName()
      await platform.files.saveFile(
        `${base}-第${episodeNo}集-合成包.md`,
        new Blob([pack.markdown], { type: 'text/markdown;charset=utf-8' }),
      )
      let files = 1
      if (pack.srt) {
        await platform.files.saveFile(
          `${base}-第${episodeNo}集.srt`,
          new Blob([pack.srt], { type: 'application/x-subrip;charset=utf-8' }),
        )
        files = 2
      }
      const remote = pack.clips.filter((c) => !c.local).length
      const remoteBgm = pack.bgm && !pack.bgm.local ? 1 : 0
      const remoteVoices = pack.voices.filter((voice) => !voice.local).length
      const notes = [
        pack.missing.length > 0 ? `${pack.missing.length} 镜没素材` : '',
        remote + remoteBgm + remoteVoices > 0
          ? `${remote + remoteBgm + remoteVoices} 份素材要先去下载`
          : '',
        pack.bgmMissing ? '背景音乐缺失，未进命令' : '',
        pack.voicesMissing.length > 0 ? `${pack.voicesMissing.length} 句配音缺失` : '',
      ].filter(Boolean)
      setStatus(
        `已导出合成包（${files} 个文件）${notes.length > 0 ? ` —— 包里写明了：${notes.join('、')}` : ''}`,
      )
    } catch {
      setStatus('导出合成包失败')
    }
  }

  /** 单独导出这一集的 SRT；时间轴与应用内内嵌字幕轨同源。 */
  const onExportSrt = async () => {
    if (!selected || !timelineSrt) return
    const episodeNo = episodes.findIndex((episode) => episode.id === selected.id) + 1
    try {
      await flush()
      await platform.files.saveFile(
        `${exportBaseName()}-第${episodeNo}集-字幕.srt`,
        new Blob([timelineSrt], {
          type: 'application/x-subrip;charset=utf-8',
        }),
      )
      setStatus(`第 ${episodeNo} 集字幕已导出（${timelineSrtCues} 条）`)
    } catch {
      setStatus('导出 SRT 字幕失败')
    }
  }

  /**
   * 桌面内直接调用本机 FFmpeg 出片。
   *
   * 浏览器没有子进程，入口不显示；桌面版把共享库素材通过本机回环 HTTP 地址交给
   * FFmpeg，避免把整集视频经 IPC / Base64 来回搬运。真正的成片仍由用户保存到本地。
   */
  const renderEpisode = async () => {
    if (!selected || !platform.cli) return
    const cli = platform.cli
    setRendering(true)
    setStatus('正在检查本机 FFmpeg…')
    try {
      await flush()
      const ffmpeg = await cli.which('ffmpeg')
      if (!ffmpeg) {
        setStatus('没找到本机 FFmpeg：先安装 FFmpeg，并让它能在终端里直接运行')
        return
      }
      const info = await loadPackAssetInfo(selected)
      const episodeNo = episodes.findIndex((episode) => episode.id === selected.id) + 1
      const pack = buildEpisodePack({
        doc,
        episode: selected,
        episodeNo,
        assetOf: (hash) => info.get(hash),
        folderName: platform.assetFolder?.current()?.name ?? null,
      })
      if (pack.clips.length === 0) {
        setStatus('这一集还没有能合成的素材：先「铺到画布」再出图')
        return
      }

      const urls = new Map<string, string>()
      const sourceOf = async (hash: string) => {
        const existing = urls.get(hash)
        if (existing) return existing
        const meta = info.get(hash)
        if (!meta) throw new Error(`素材库缺少 ${hash.slice(0, 8)}…，无法合成`)
        if (meta.local) {
          const local = platform.assets.sourceUrl?.(hash)
          if (local) {
            urls.set(hash, local)
            return local
          }
        }
        const remote = await platform.assets.readUrl(hash)
        if (remote?.url) {
          urls.set(hash, remote.url)
          return remote.url
        }
        throw new Error(`素材 ${hash.slice(0, 8)}… 既没有本地字节，也没有可读取的远端地址`)
      }

      const renderClips: PackClip[] = []
      for (const clip of pack.clips) {
        renderClips.push({ ...clip, file: await sourceOf(clip.hash) })
      }
      const bgmFile = pack.bgm ? await sourceOf(pack.bgm.hash) : ''
      const voiceFiles: { file: string; start: number }[] = []
      for (const voice of pack.voices) {
        voiceFiles.push({ file: await sourceOf(voice.hash), start: voice.start })
      }

      const outDir = await cli.outDir()
      const sep = outDir.includes('\\') ? '\\' : '/'
      const renderBase = `${exportBaseName()}-第${episodeNo}集-${Date.now()}`
      const output = `${outDir}${outDir.endsWith(sep) ? '' : sep}${renderBase}.mp4`
      let subtitleFile = ''
      if (pack.srt) {
        const writeOut = cli.writeOut
        if (!writeOut) {
          setStatus('当前桌面壳不支持写入字幕文件，请更新桌面版后重试')
          return
        }
        subtitleFile = await writeOut(
          `${renderBase}.srt`,
          new TextEncoder().encode(pack.srt),
        )
      }
      const args = ffmpegArgs(renderClips, {
        output,
        ...(pack.bgm
          ? { bgm: { file: bgmFile, volume: pack.bgm.volume } }
          : {}),
        ...(voiceFiles.length > 0 ? { voices: voiceFiles } : {}),
        ...(subtitleFile ? { subtitles: { file: subtitleFile } } : {}),
      })
      setStatus(`正在用本机 FFmpeg 合成第 ${episodeNo} 集…`)
      const outcome = await cli.run({
        id: `storyboard-render-${Date.now()}`,
        program: ffmpeg,
        args,
        timeoutMs: 30 * 60_000,
      })
      if (outcome.timedOut) {
        setStatus('本机 FFmpeg 合成超时（30 分钟）')
        return
      }
      if (outcome.code !== 0) {
        const reason = outcome.stderr.trim().slice(-500) || `退出码 ${String(outcome.code)}`
        setStatus(`本机 FFmpeg 合成失败：${reason}`)
        return
      }
      const bytes = await cli.readOut(output)
      await platform.files.saveFile(
        `${exportBaseName()}-第${episodeNo}集-成片.mp4`,
        new Blob([Uint8Array.from(bytes).buffer], { type: 'video/mp4' }),
      )
      setStatus(`第 ${episodeNo} 集成片已生成并保存`)
    } catch (error) {
      const appError = asAppError(error)
      setStatus(appError ? describeError(appError) : String(error))
    } finally {
      setRendering(false)
    }
  }

  return (
    <div className={styles.page} data-storyboard-page>
      <header className={styles.bar}>
        <div className={styles.titleWrap}>
          <h1 className={styles.title} data-storyboard-title>
            {doc.script.title || '未命名漫剧'}
          </h1>
          <p className={styles.sub}>{projectName || '漫剧项目'}</p>
        </div>
        <p className={styles.stats} data-storyboard-stats>
          {stats.episodes} 集 · {stats.shots} 镜 · 粗排 {stats.durationSec} 秒
        </p>
        <span className={styles.status} role="status" data-storyboard-status>
          {status}
        </span>
        <button type="button" className={styles.primary} data-storyboard-export onClick={() => void onExport()}>
          导出分镜表
        </button>
      </header>

      <div className={styles.body}>
        <section className={styles.left} aria-label="剧本与分集">
          {/**
           * 原文（对账 #417）：拆集的输入。它与「剧本」是两回事 ——
           * 原文是素材（小说 / 大纲，粘进来就是），剧本是可以自己改的中间产物。
           * 拆过集之后，拆镜优先喂**这一集对应的那一段原文**（不是整篇剧本）。
           */}
          <div className={styles.block}>
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle}>原文（小说 / 大纲）</h2>
              <div className={styles.headTools}>
                {split.kind === 'running' ? (
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-split-cancel
                    onClick={cancelSplit}
                  >
                    取消
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.ghost}
                  data-storyboard-split-run
                  disabled={split.kind === 'running'}
                  onClick={() => void runSplit()}
                >
                  {splitConfirm
                    ? `再点一次：替换这 ${doc.episodes.length} 集（含 ${doc.shots.length} 镜）`
                    : '拆成多集'}
                </button>
              </div>
            </div>
            <textarea
              className={styles.textarea}
              rows={7}
              value={doc.sourceText}
              placeholder="把小说 / 大纲粘进来。有「第一章 / 楔子 / Chapter 1」这类标记就按标记切，没有就按字数兜底"
              data-storyboard-source-text
              onChange={(e) => {
                setSplitConfirm(false)
                apply(updateSourceText(doc, e.target.value, 0))
              }}
            />
            <p className={styles.hint} data-storyboard-split-hint>
              {chatTarget
                ? `会用 ${chatTarget.label} 起名 / 写梗概；条数对不上就回落章节名`
                : '还没配对话模型也能拆：按结构切分，标题用章节名 / 第 N 集'}
            </p>
            {split.kind !== 'idle' ? (
              <p
                className={split.kind === 'error' ? styles.error : styles.hint}
                role="status"
                data-storyboard-split-status={split.kind}
              >
                {split.kind === 'running' ? '正在拆集…' : split.text}
              </p>
            ) : null}
          </div>

          <div className={styles.block}>
            <h2 className={styles.blockTitle}>剧本</h2>
            <label className={styles.field}>
              <span className={styles.label}>片名</span>
              <input
                className={styles.input}
                value={doc.script.title}
                data-storyboard-script-title
                onChange={(e) => apply(updateScript(doc, { title: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>一句话故事</span>
              <input
                className={styles.input}
                value={doc.script.logline}
                placeholder="一句话说清这个故事"
                data-storyboard-script-logline
                onChange={(e) => apply(updateScript(doc, { logline: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>正文</span>
              <textarea
                className={styles.textarea}
                rows={9}
                value={doc.script.body}
                placeholder="把故事写下来；分集与分镜从这一段拆"
                data-storyboard-script-body
                onChange={(e) => apply(updateScript(doc, { body: e.target.value }))}
              />
            </label>
          </div>

          <div className={styles.block}>
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle}>分集</h2>
              <button
                type="button"
                className={styles.ghost}
                data-storyboard-add-episode
                onClick={addOneEpisode}
              >
                新增一集
              </button>
            </div>
            {episodes.length === 0 ? (
              <p className={styles.hint} data-storyboard-episodes-empty>
                还没有分集。先加一集，再把这一集要讲什么写下来。
              </p>
            ) : (
              <ul className={styles.list}>
                {episodes.map((episode, index) => {
                  const on = selected?.id === episode.id
                  const isConfirming = confirming === `ep:${episode.id}`
                  const sourceText = episodeSourceText(doc, episode)
                  return (
                    <li
                      key={episode.id}
                      className={on ? `${styles.item} ${styles.itemOn}` : styles.item}
                      data-storyboard-episode={episode.id}
                      data-selected={on ? 'true' : 'false'}
                      onClick={() => pick(episode.id)}
                    >
                      <div className={styles.itemMain}>
                        <input
                          className={styles.itemTitle}
                          value={episode.title}
                          aria-label={`第 ${index + 1} 集标题`}
                          data-storyboard-episode-name={episode.id}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            apply(updateEpisode(doc, episode.id, { title: e.target.value }))
                          }
                        />
                        {episode.sourceRange ? (
                          <span className={styles.itemMeta} data-storyboard-episode-range={episode.id}>
                            原文 {episode.sourceRange.from + 1}–{episode.sourceRange.to} 字
                          </span>
                        ) : null}
                        <span className={styles.itemMeta}>{shotsOf(doc, episode.id).length} 镜</span>
                      </div>
                      <div className={styles.itemTools}>
                        {sourceText ? (
                          <button
                            type="button"
                            className={styles.ghost}
                            data-storyboard-episode-source={episode.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSourcePreview({
                                title: episode.title,
                                ...(episode.sourceRange ? { range: episode.sourceRange } : {}),
                                text: sourceText,
                              })
                            }}
                          >
                            看原文
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label="上移这一集"
                          title="上移"
                          disabled={index === 0}
                          data-storyboard-episode-up={episode.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            apply(moveEpisode(doc, episode.id, -1, 0))
                          }}
                        >
                          <IconUp />
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label="下移这一集"
                          title="下移"
                          disabled={index === episodes.length - 1}
                          data-storyboard-episode-down={episode.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            apply(moveEpisode(doc, episode.id, 1, 0))
                          }}
                        >
                          <IconDown />
                        </button>
                        <button
                          type="button"
                          className={isConfirming ? `${styles.iconBtn} ${styles.iconBtnDanger}` : styles.iconBtn}
                          aria-label={isConfirming ? '再点一次，删除这一集' : '删除这一集'}
                          title={isConfirming ? '再点一次，删除这一集' : '删除'}
                          data-storyboard-episode-remove={episode.id}
                          data-confirming={isConfirming ? 'true' : 'false'}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeOneEpisode(episode.id)
                          }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/**
           * 角色 / 场景库（对账 #416）。
           *
           * **项目级**（跨集复用）：同一角色在第 1 集和第 30 集必须是同一个对象，
           * 所以它挂在这里、不挂在某一集下面（调研稿 §6.1 的取舍表）。
           * 删资产会**连镜头上的引用一起清**（领域层做），按钮第一下先把"会从 N 镜里去掉"说清。
           */}
          <div className={styles.block}>
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle}>角色 / 场景</h2>
              <div className={styles.headTools}>
                <button
                  type="button"
                  className={styles.ghost}
                  data-storyboard-add-character
                  onClick={() => apply(addCharacter(doc, 0))}
                >
                  新增角色
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  data-storyboard-add-scene
                  onClick={() => apply(addScene(doc, 0))}
                >
                  新增场景
                </button>
              </div>
            </div>
            <p className={styles.hint} data-storyboard-assets-hint>
              项目级资产，跨集复用：拆镜时模型会提一遍，也可以在这里改 / 加 / 删。
            </p>
            {doc.characters.length === 0 && doc.scenes.length === 0 ? (
              <p className={styles.hint} data-storyboard-assets-empty>
                还没有角色 / 场景。拆一次镜，或点上面的「新增」自己建。
              </p>
            ) : null}
            {doc.characters.map((c) => (
              <AssetRow
                key={c.id}
                asset={c}
                kind="char"
                usedBy={doc.shots.filter((s) => s.characterIds?.includes(c.id)).length}
                confirming={confirming === `char:${c.id}`}
                hasNode={Boolean(c.nodeId && liveNodeIds.has(c.nodeId))}
                state={c.nodeId ? exec.nodeStateOf(c.nodeId) : undefined}
                hasTurnaroundNode={Boolean(
                  c.turnaroundNodeId && liveNodeIds.has(c.turnaroundNodeId),
                )}
                turnaroundState={
                  c.turnaroundNodeId ? exec.nodeStateOf(c.turnaroundNodeId) : undefined
                }
                voices={speechTarget?.voices ?? []}
                onPatch={(patch) => apply(updateCharacter(doc, c.id, patch, 0))}
                onRemove={() => removeOneAsset('char', c.id)}
                onMake={() => void makeAssetBase('char', c.id)}
                onTurnaround={() => void makeAssetTurnaround(c.id)}
                merge={merge?.dropId === c.id ? { keepId: merge.keepId } : null}
                mergeChoices={mergeChoicesOf('char', c.id)}
                onMergeOpen={() => {
                  setConfirming('')
                  setMerge({ dropId: c.id, keepId: null })
                }}
                onMergePick={(keepId) => setMerge({ dropId: c.id, keepId })}
                onMergeConfirm={() => {
                  if (!merge?.keepId) return
                  apply(mergeAsset(doc, 'char', merge.keepId, merge.dropId, 0))
                  setMerge(null)
                }}
                onMergeCancel={() => setMerge(null)}
              />
            ))}
            {doc.scenes.map((s) => (
              <AssetRow
                key={s.id}
                asset={s}
                kind="scene"
                usedBy={doc.shots.filter((x) => x.sceneId === s.id).length}
                confirming={confirming === `scene:${s.id}`}
                hasNode={Boolean(s.nodeId && liveNodeIds.has(s.nodeId))}
                state={s.nodeId ? exec.nodeStateOf(s.nodeId) : undefined}
                onPatch={(patch) => apply(updateScene(doc, s.id, patch, 0))}
                onRemove={() => removeOneAsset('scene', s.id)}
                onMake={() => void makeAssetBase('scene', s.id)}
                merge={merge?.dropId === s.id ? { keepId: merge.keepId } : null}
                mergeChoices={mergeChoicesOf('scene', s.id)}
                onMergeOpen={() => {
                  setConfirming('')
                  setMerge({ dropId: s.id, keepId: null })
                }}
                onMergePick={(keepId) => setMerge({ dropId: s.id, keepId })}
                onMergeConfirm={() => {
                  if (!merge?.keepId) return
                  apply(mergeAsset(doc, 'scene', merge.keepId, merge.dropId, 0))
                  setMerge(null)
                }}
                onMergeCancel={() => setMerge(null)}
              />
            ))}
            {/**
             * **查一遍重复**（对账 #437）：用对话模型找"同一个人的两种叫法"。
             *
             * 为什么值得花这一次额度：真实情形恰恰是**没有共同子串**的两种叫法
             * （"林轩" / "林公子" 只共享一个姓）—— 规则只能靠"同姓"这种弱信号，
             * 满屏误报比没有提示更糟。模型给的是**候选**，合并与否由用户逐条点。
             */}
            {doc.characters.length + doc.scenes.length >= 2 ? (
              <div className={styles.mergeScan} data-storyboard-merge-scan-box>
                <div className={styles.headTools}>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-merge-scan
                    disabled={mergeScan.kind === 'running'}
                    onClick={() => void scanMerges()}
                  >
                    {mergeScan.kind === 'running' ? '正在查…' : '查一遍重复'}
                  </button>
                  <span className={styles.hint} data-storyboard-merge-scan-note>
                    {chatTarget
                      ? `会用 ${chatTarget.label} 查（会花一次对话额度）`
                      : '还没有可用的对话模型：先去「设置 → 模型服务」给一条服务勾上对话模型'}
                  </span>
                </div>
                {mergeScan.text ? (
                  <p
                    className={mergeScan.kind === 'error' ? styles.error : styles.hint}
                    role={mergeScan.kind === 'error' ? 'alert' : undefined}
                    data-storyboard-merge-scan-status={mergeScan.kind}
                  >
                    {mergeScan.text}
                  </p>
                ) : null}
                {merges.map((suggestion) => {
                  const key = `${suggestion.keepId}|${suggestion.dropIds.join(',')}`
                  const list = suggestion.kind === 'char' ? doc.characters : doc.scenes
                  const nameOf = (id: string) => list.find((a) => a.id === id)?.name ?? '（已删）'
                  const drops = suggestion.dropIds.map(nameOf).join('、')
                  const refs = suggestion.dropIds.reduce(
                    (sum, id) =>
                      sum +
                      doc.shots.filter((shot) =>
                        suggestion.kind === 'char'
                          ? (shot.characterIds ?? []).includes(id)
                          : shot.sceneId === id,
                      ).length,
                    0,
                  )
                  return (
                    <div className={styles.suggestion} key={key} data-storyboard-merge-suggestion={key}>
                      <p className={styles.suggestionText}>
                        疑似重复：「{drops}」与「{nameOf(suggestion.keepId)}」
                        {suggestion.reason ? ` —— ${suggestion.reason}` : ''}
                      </p>
                      {mergeConfirmId === key ? (
                        <p className={styles.hint} data-storyboard-merge-accept-note={key}>
                          再点一次「确认合并」：会把 {refs} 镜的引用改到「{nameOf(suggestion.keepId)}
                          」，并删掉「{drops}」。
                        </p>
                      ) : null}
                      <div className={styles.headTools}>
                        <button
                          type="button"
                          className={styles.ghost}
                          data-storyboard-merge-accept={key}
                          onClick={() => {
                            if (mergeConfirmId === key) acceptMerge(suggestion)
                            else setMergeConfirmId(key)
                          }}
                        >
                          {mergeConfirmId === key ? '确认合并' : '合并'}
                        </button>
                        <button
                          type="button"
                          className={styles.ghost}
                          data-storyboard-merge-dismiss={key}
                          onClick={() => dismissMergeSuggestion(suggestion)}
                        >
                          不是同一个
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </section>

        <section className={styles.right} aria-label="这一集的分镜">
          {!selected ? (
            <div className={styles.placeholder} data-storyboard-no-episode>
              <p className={styles.hint}>左边还没有分集。先加一集，这一集的分镜就写在这里。</p>
            </div>
          ) : (
            <>
              <div className={styles.block}>
                <h2 className={styles.blockTitle}>第 {selectedIndex + 1} 集</h2>
                <label className={styles.field}>
                  <span className={styles.label}>这一集的标题</span>
                  <input
                    className={styles.input}
                    value={selected.title}
                    data-storyboard-episode-title={selected.id}
                    onChange={(e) =>
                      apply(updateEpisode(doc, selected.id, { title: e.target.value }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>这一集要讲什么</span>
                  <textarea
                    className={styles.textarea}
                    rows={3}
                    value={selected.summary}
                    placeholder="这一集的起止与转折"
                    data-storyboard-episode-summary={selected.id}
                    onChange={(e) =>
                      apply(updateEpisode(doc, selected.id, { summary: e.target.value }))
                    }
                  />
                </label>
                <div className={styles.row2}>
                  <label className={styles.field}>
                    <span className={styles.label}>开场钩子</span>
                    <input
                      className={styles.input}
                      value={selected.hookOpen ?? ''}
                      placeholder="开场抓人的那一句"
                      data-storyboard-episode-hook-open={selected.id}
                      onChange={(e) =>
                        apply(updateEpisode(doc, selected.id, { hookOpen: e.target.value }))
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>结尾钩子</span>
                    <input
                      className={styles.input}
                      value={selected.hookEnd ?? ''}
                      placeholder="结尾留的那一钩"
                      data-storyboard-episode-hook-end={selected.id}
                      onChange={(e) =>
                        apply(updateEpisode(doc, selected.id, { hookEnd: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <BgmField
                  episode={selected}
                  onPick={() => void onPickBgm()}
                  onRemove={onRemoveBgm}
                  onVolume={(volume) =>
                    apply(
                      updateEpisode(doc, selected.id, { bgmVolume: volume }, Date.now()),
                    )
                  }
                />
              </div>

              <div className={styles.block}>
                <div className={styles.blockHead}>
                  <h2 className={styles.blockTitle}>分镜</h2>
                  <div className={styles.headTools}>
                    {breaking === 'running' ? (
                      <button
                        type="button"
                        className={styles.ghost}
                        data-storyboard-breakdown-cancel
                        onClick={cancelBreakdown}
                      >
                        取消
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-breakdown-run
                      disabled={breaking === 'running' || !chatTarget}
                      onClick={() => void runBreakdown()}
                    >
                      {breakConfirm ? `再点一次：替换这 ${shots.length} 镜` : '用模型拆这一集'}
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-lay-out
                      disabled={shots.length === 0}
                      onClick={() => void layOut()}
                    >
                      {needNodes.length > 0 ? `铺到画布（${needNodes.length} 镜）` : '已铺到画布'}
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-run-all
                      disabled={laidCount === 0 || exec.isRunning}
                      onClick={() => void runEpisode()}
                    >
                      这一集出图
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-run-all-video
                      disabled={videoPending === 0 || exec.isRunning}
                      title={
                        videoPending > 0
                          ? `逐镜生成这一集还缺视频的 ${videoPending} 个镜头`
                          : '这一集没有待出视频的镜头'
                      }
                      onClick={() => void runEpisodeVideos()}
                    >
                      这一集出视频
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-run-all-voice
                      disabled={
                        voicePending === 0 ||
                        !speechTarget ||
                        Object.keys(voiceBusy).length > 0
                      }
                      title={
                        speechTarget
                          ? voicePending > 0
                            ? `逐句补齐这一集还缺配音的 ${voicePending} 句台词`
                            : '这一集没有待补配音的台词'
                          : '先去设置里给渠道勾选一个 audio / tts 模型'
                      }
                      onClick={() => void runEpisodeVoices()}
                    >
                      补齐本集配音
                    </button>
                    {/**
                     * 「预览这一集」（对账 #432）：调研稿 §M7-6 的预览那一半。
                     * 段数与导出**同源**（都取 `episodeTimeline`），所以预览看到几段、
                     * 命令里就有几个输入。一镜素材都没有时按钮是灰的 —— 不摆点了没反应的入口。
                     */}
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-preview
                      disabled={timeline.clips.length === 0}
                      onClick={() => setPreview({ at: 0, playing: true })}
                    >
                      预览这一集
                    </button>
                    {/**
                     * 「导出合成包」（对账 #431）：纯文本 —— 素材清单 + 一条能直接跑的 FFmpeg 命令 + SRT。
                     * 门槛放在"这一集有镜头"上：一镜都没有时导出的包只会是几段空说明。
                     */}
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-export-pack
                      disabled={shots.length === 0}
                      onClick={() => void onExportPack()}
                    >
                      导出合成包
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-export-srt
                      disabled={!timelineSrt}
                      title={
                        timelineSrt
                          ? `下载这一集的 SRT，共 ${timelineSrtCues} 条字幕`
                          : '这一集还没有可导出的台词字幕'
                      }
                      onClick={() => void onExportSrt()}
                    >
                      导出 SRT
                    </button>
                    {platform.cli ? (
                      <button
                        type="button"
                        className={styles.ghost}
                        data-storyboard-render-video
                        disabled={timeline.clips.length === 0 || rendering}
                        title="调用本机 FFmpeg 直接合成并保存成片；需要 FFmpeg 已加入 PATH"
                        onClick={() => void renderEpisode()}
                      >
                        {rendering ? '本机合成中…' : '本机合成成片'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-sync-prompts
                      disabled={laidCount === 0}
                      onClick={syncPrompts}
                    >
                      刷新提示词
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-add-shot
                      onClick={addOneShot}
                    >
                      新增一镜
                    </button>
                  </div>
                </div>
                <p className={styles.hint} data-storyboard-breakdown-hint>
                  {chatTarget
                    ? `将用 ${chatTarget.label} 拆解；结果只写进这一集`
                    : '还没有可用的对话模型 —— 去「全局设置 → 模型服务」给一条服务勾上对话模型'}
                </p>
                {breaking !== 'idle' ? (
                  <p
                    className={breaking === 'error' ? styles.error : styles.hint}
                    role="status"
                    data-storyboard-breakdown-status={breaking}
                  >
                    {breaking === 'running' ? '正在拆解…' : breakMsg}
                  </p>
                ) : null}
                <p className={styles.hint} data-storyboard-canvas-hint={laidCount}>
                  画布：这一集 {laidCount}/{shots.length} 镜已在画布上
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-storyboard-open-canvas
                    onClick={() => navigate(projectRoute('canvas', projectId))}
                  >
                    在画布里打开
                  </button>
                </p>
                {lay.kind !== 'idle' ? (
                  <p
                    className={lay.kind === 'error' ? styles.error : styles.hint}
                    role="status"
                    data-storyboard-lay-status={lay.kind}
                  >
                    {lay.text}
                  </p>
                ) : null}
                {shots.some((s) => s.sceneId || (s.characterIds?.length ?? 0) > 0) ? (
                  <p className={styles.hint} data-storyboard-asset-prompt-hint>
                    提示词里已带上绑定的场景 / 角色设定；改完描述点「刷新提示词」同步到画布。
                  </p>
                ) : null}
                {shots.length === 0 ? (
                  <p className={styles.hint} data-storyboard-shots-empty>
                    这一集还没有分镜。一镜 = 一个画面 + 一句台词 + 一个时长。
                  </p>
                ) : (
                  <ol className={styles.shots}>
                    {shots.map((shot, index) => (
                      <ShotCard
                        key={shot.id}
                        shot={shot}
                        index={index}
                        total={shots.length}
                        confirming={confirming === `shot:${shot.id}`}
                        laidOut={Boolean(shot.nodeId && liveNodeIds.has(shot.nodeId))}
                        state={shot.nodeId ? exec.nodeStateOf(shot.nodeId) : undefined}
                        characters={doc.characters}
                        scenes={doc.scenes}
                        onPatch={patchShot}
                        onAddLine={() => apply(addShotLine(doc, shot.id, {}, 0))}
                        onLinePatch={(lineId, patch) =>
                          apply(updateShotLine(doc, shot.id, lineId, patch, 0))
                        }
                        onLineRemove={(lineId) => apply(removeShotLine(doc, shot.id, lineId, 0))}
                        speechTarget={speechTarget}
                        voiceBusy={voiceBusy}
                        onVoice={(lineId) => void voiceLine(shot, lineId)}
                        onMakeDigitalHuman={
                          digitalHumanTarget ? () => void makeDigitalHuman(shot) : undefined
                        }
                        digitalHumanBusyShotId={digitalHumanBusy}
                        digitalHumanModel={digitalHumanTarget?.model}
                        onMove={(id, delta) => apply(moveShot(doc, id, delta, 0))}
                        onRemove={removeOneShot}
                        onRun={() => runShot(shot)}
                        onShowSource={selectedSourceText ? openSelectedSource : undefined}
                        /* 只有这一镜的节点**现在还在画布上**才给入口（节点被删了就没什么可定位的） */
                        onLocate={
                          shot.nodeId && liveNodeIds.has(shot.nodeId)
                            ? () =>
                                navigate(
                                  projectRoute('canvas', projectId, { focus: shot.nodeId! }),
                                )
                            : undefined
                        }
                        /* 有图才给"出视频"：图生视频要先有画面（不摆一个点了会被拒的按钮） */
                        onMakeVideo={
                          shot.nodeId && liveNodeIds.has(shot.nodeId) && shot.imageHash
                            ? () => void makeShotVideo(shot)
                            : undefined
                        }
                        videoPairHint={Boolean(
                          shots[index + 1]?.nodeId &&
                            liveNodeIds.has(shots[index + 1]!.nodeId!) &&
                            shots[index + 1]?.imageHash,
                        )}
                        videoUpscaleTargets={videoUpscaleTargets}
                        videoUpscaleBusyShotId={videoUpscaleBusy}
                        onVideoUpscale={
                          shot.videoHash &&
                          shot.videoNodeId &&
                          liveNodeIds.has(shot.videoNodeId) &&
                          videoUpscaleTargets.length > 0
                            ? (target, resolution, frameRate) =>
                                void makeVideoUpscale(
                                  shot,
                                  target,
                                  resolution,
                                  frameRate,
                                )
                            : undefined
                        }
                        videoEraseTargets={videoEraseTargets}
                        videoEraseBusyShotId={videoEraseBusy}
                        onVideoErase={
                          shot.videoHash &&
                          shot.videoNodeId &&
                          liveNodeIds.has(shot.videoNodeId) &&
                          videoEraseTargets.length > 0
                            ? (target) => void makeVideoErase(shot, target)
                            : undefined
                        }
                        videoEditTargets={videoEditTargets}
                        videoEditBusyShotId={videoEditBusy}
                        onVideoEdit={
                          shot.videoHash &&
                          shot.videoNodeId &&
                          liveNodeIds.has(shot.videoNodeId) &&
                          videoEditTargets.length > 0
                            ? (target, instruction, resolution, useReferenceImage) =>
                                void makeVideoEdit(
                                  shot,
                                  target,
                                  instruction,
                                  resolution,
                                  useReferenceImage,
                                )
                            : undefined
                        }
                        videoExtendTargets={videoExtendTargets}
                        videoExtendBusyShotId={videoExtendBusy}
                        onVideoExtend={
                          shot.videoHash &&
                          shot.videoNodeId &&
                          liveNodeIds.has(shot.videoNodeId) &&
                          videoExtendTargets.length > 0
                            ? (target, instruction, resolution, duration) =>
                                void makeVideoExtend(
                                  shot,
                                  target,
                                  instruction,
                                  resolution,
                                  duration,
                                )
                            : undefined
                        }
                        onDownloadVideo={
                          shot.videoHash
                            ? () =>
                                void downloadAsset(
                                  { assets: platform.assets, files: platform.files },
                                  shot.videoHash!,
                                )
                            : undefined
                        }
                        onBindScene={(sceneId) => apply(bindShotScene(doc, shot.id, sceneId, 0))}
                        onToggleCharacter={(characterId) =>
                          apply(toggleShotCharacter(doc, shot.id, characterId, 0))
                        }
                      />
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      {/**
       * 时间轴预览浮层（对账 #432）：只在真的开着、且这一集有可播片段时渲染。
       * `at` 由组件内部夹好范围（文档在播放期间被改短也不会越界）。
       */}
      {preview && timeline.clips.length > 0 ? (
        <EpisodePreview
          clips={timeline.clips}
          bgmHash={selected?.bgmHash}
          bgmName={selected?.bgmName}
          bgmVolume={selected?.bgmVolume}
          at={preview.at}
          playing={preview.playing}
          onAt={(at) => setPreview({ at, playing: true })}
          onTogglePlay={() => setPreview((p) => (p ? { ...p, playing: !p.playing } : p))}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {sourcePreview ? (
        <SourcePreview
          title={sourcePreview.title}
          range={sourcePreview.range}
          text={sourcePreview.text}
          onClose={() => setSourcePreview(null)}
        />
      ) : null}
    </div>
  )
}

function BgmField({
  episode,
  onPick,
  onRemove,
  onVolume,
}: {
  episode: StoryboardEpisode
  onPick: () => void
  onRemove: () => void
  onVolume: (volume: number) => void
}) {
  const meta = useAssetMeta(episode.bgmHash)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const volume = episode.bgmVolume ?? 0.2

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume, meta.url])

  return (
    <div className={styles.bgmField} data-storyboard-bgm={episode.id}>
      <div className={styles.bgmHead}>
        <div>
          <span className={styles.label}>背景音乐</span>
          <p className={styles.bgmName} data-storyboard-bgm-name>
            {episode.bgmHash ? episode.bgmName || episode.bgmHash.slice(0, 12) : '这一集还没有背景音乐'}
          </p>
        </div>
        <div className={styles.bgmActions}>
          <button type="button" className={styles.ghost} data-storyboard-bgm-pick onClick={onPick}>
            {episode.bgmHash ? '更换音频' : '选择音频'}
          </button>
          {episode.bgmHash ? (
            <button type="button" className={styles.ghost} data-storyboard-bgm-remove onClick={onRemove}>
              移除
            </button>
          ) : null}
        </div>
      </div>
      {episode.bgmHash ? (
        meta.missing ? (
          <p className={styles.bgmMissing} data-storyboard-bgm-missing>
            音频素材缺失{meta.expectedPath ? `（本该在 ${meta.expectedPath}）` : ''}
          </p>
        ) : meta.url ? (
          <div className={styles.bgmPlayer}>
            <audio ref={audioRef} controls src={meta.url} data-storyboard-bgm-audio />
            <label className={styles.bgmVolume}>
              <span>音量 {Math.round(volume * 100)}%</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(volume * 100)}
                data-storyboard-bgm-volume
                onChange={(e) => onVolume(Number(e.target.value) / 100)}
              />
            </label>
          </div>
        ) : (
          <p className={styles.hint}>正在读取音频…</p>
        )
      ) : (
        <p className={styles.hint}>支持 MP3 / WAV / OGG / M4A / AAC / FLAC，最大 50MB。</p>
      )}
    </div>
  )
}

function ShotCard({
  shot,
  index,
  total,
  confirming,
  laidOut,
  state,
  characters,
  scenes,
  onPatch,
  onMove,
  onRemove,
  onRun,
  onBindScene,
  onToggleCharacter,
  onLocate,
  onMakeVideo,
  videoPairHint,
  videoUpscaleTargets,
  videoUpscaleBusyShotId,
  onVideoUpscale,
  videoEraseTargets,
  videoEraseBusyShotId,
  onVideoErase,
  videoEditTargets,
  videoEditBusyShotId,
  onVideoEdit,
  videoExtendTargets,
  videoExtendBusyShotId,
  onVideoExtend,
  onDownloadVideo,
  onShowSource,
  onAddLine,
  onLinePatch,
  onLineRemove,
  speechTarget,
  voiceBusy,
  onVoice,
  onMakeDigitalHuman,
  digitalHumanBusyShotId,
  digitalHumanModel,
}: {
  shot: StoryboardShot
  index: number
  total: number
  confirming: boolean
  /** 这一镜的节点**现在还在画布上**（不是"曾经铺过"） */
  laidOut: boolean
  state?: RunTaskState
  characters: readonly DramaCharacter[]
  scenes: readonly DramaScene[]
  onPatch: (
    id: string,
    patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId' | 'lines'>>,
  ) => void
  /** 对白层的三个动作（增 / 改 / 删）—— 与 `updateShot` 分开，各管一件事 */
  onAddLine: () => void
  onLinePatch: (lineId: string, patch: Partial<Omit<StoryboardLine, 'id'>>) => void
  onLineRemove: (lineId: string) => void
  speechTarget: SpeechTarget | null
  voiceBusy: Record<string, boolean>
  onVoice: (lineId: string) => void
  onMakeDigitalHuman?: () => void
  digitalHumanBusyShotId: string | null
  digitalHumanModel?: string
  onMove: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onRun: () => void
  onBindScene: (sceneId: string | null) => void
  onToggleCharacter: (characterId: string) => void
  /** 「在画布里定位这一镜」（对账 #424）：跳过去选中并居中这一镜的节点；没有节点就不传 */
  onLocate?: () => void
  /** 「出视频」（对账 #429）：这一镜有图且节点还在时才传；不传就不渲染这个入口 */
  onMakeVideo?: () => void
  /** 下一镜也已经出图：视频将优先使用首尾帧，把两镜画面接起来 */
  videoPairHint?: boolean
  /** 当前启用渠道里真实可路由的视频超清模型 */
  videoUpscaleTargets: readonly VideoUpscaleTarget[]
  videoUpscaleBusyShotId: string | null
  onVideoUpscale?: (
    target: VideoUpscaleTarget,
    resolution: string,
    frameRate: number | null,
  ) => void
  videoEraseTargets: readonly VideoEraseTarget[]
  videoEraseBusyShotId: string | null
  onVideoErase?: (target: VideoEraseTarget) => void
  videoEditTargets: readonly VideoEditTarget[]
  videoEditBusyShotId: string | null
  onVideoEdit?: (
    target: VideoEditTarget,
    instruction: string,
    resolution: string,
    useReferenceImage: boolean,
  ) => void
  videoExtendTargets: readonly VideoExtendTarget[]
  videoExtendBusyShotId: string | null
  onVideoExtend?: (
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => void
  onDownloadVideo?: () => void
  /** 「看本集原文」（对账 #547）：这一集有可回看的原文片段时才传 */
  onShowSource?: () => void
}) {
  const [upscaleOpen, setUpscaleOpen] = useState(false)
  const [upscaleTargetIndex, setUpscaleTargetIndex] = useState(0)
  const [upscaleResolution, setUpscaleResolution] = useState('1080p')
  const [upscaleFrameRate, setUpscaleFrameRate] = useState<number | null>(30)
  const [videoEraseOpen, setVideoEraseOpen] = useState(false)
  const [videoEraseTargetIndex, setVideoEraseTargetIndex] = useState(0)
  const [videoEditOpen, setVideoEditOpen] = useState(false)
  const [videoEditTargetIndex, setVideoEditTargetIndex] = useState(0)
  const [videoEditInstruction, setVideoEditInstruction] = useState('')
  const [videoEditResolution, setVideoEditResolution] = useState('480p')
  const [videoEditUseReference, setVideoEditUseReference] = useState(false)
  const [videoExtendOpen, setVideoExtendOpen] = useState(false)
  const [videoExtendTargetIndex, setVideoExtendTargetIndex] = useState(0)
  const [videoExtendInstruction, setVideoExtendInstruction] = useState('')
  const [videoExtendResolution, setVideoExtendResolution] = useState('720P')
  const [videoExtendDuration, setVideoExtendDuration] = useState<number | null>(5)
  const currentUpscaleTarget =
    videoUpscaleTargets[Math.min(upscaleTargetIndex, videoUpscaleTargets.length - 1)]
  const currentVideoEraseTarget =
    videoEraseTargets[Math.min(videoEraseTargetIndex, videoEraseTargets.length - 1)]
  const currentVideoEditTarget =
    videoEditTargets[Math.min(videoEditTargetIndex, videoEditTargets.length - 1)]
  const currentVideoExtendTarget =
    videoExtendTargets[Math.min(videoExtendTargetIndex, videoExtendTargets.length - 1)]
  const canReferenceShotImage =
    Boolean(shot.imageHash) &&
    laidOut &&
    Boolean(currentVideoEditTarget?.supportsReferenceImage)
  const upscaleBusy = videoUpscaleBusyShotId === shot.id
  const videoErasing = videoEraseBusyShotId === shot.id
  const videoEditing = videoEditBusyShotId === shot.id
  const videoExtending = videoExtendBusyShotId === shot.id
  const digitalHumanPlan = digitalHumanPlanOf(shot)
  const digitalHumanBusy = digitalHumanBusyShotId === shot.id

  const openUpscale = () => {
    const target = videoUpscaleTargets[0]
    if (!target) return
    const normalized = normalizeVideoUpscaleSettings(target.model)
    setUpscaleTargetIndex(0)
    setUpscaleResolution(normalized.resolution)
    setUpscaleFrameRate(normalized.frameRate)
    setUpscaleOpen(true)
  }

  const openVideoEdit = () => {
    const target = videoEditTargets[0]
    if (!target) return
    setVideoEditTargetIndex(0)
    setVideoEditInstruction('')
    setVideoEditResolution(normalizeVideoEditResolution(target.model))
    setVideoEditUseReference(
      Boolean(target.supportsReferenceImage && shot.imageHash && laidOut),
    )
    setVideoEditOpen(true)
  }

  const openVideoExtend = () => {
    const target = videoExtendTargets[0]
    if (!target) return
    const normalized = normalizeVideoExtendSettings(target.model)
    setVideoExtendTargetIndex(0)
    setVideoExtendInstruction('延续当前镜头内容与运动，保持人物、场景和画风一致')
    setVideoExtendResolution(normalized.resolution)
    setVideoExtendDuration(normalized.duration)
    setVideoExtendOpen(true)
  }

  /**
   * 状态一格写完（界面 / 冒烟都读这一个属性）：
   * 没铺 → idle；铺了没跑 → laid；跑着 → running；失败 → failed；有图 → done。
   * **失败优先于"有图"**：重出失败时旧图还在，但用户此刻要知道的是"这次失败了"。
   */
  const kind = !laidOut
    ? 'idle'
    : state?.kind === 'failed'
      ? 'failed'
      : state?.kind === 'queued' || state?.kind === 'running'
        ? 'running'
        : shot.imageHash
          ? 'done'
          : 'laid'
  const stateText =
    kind === 'idle'
      ? '还没铺到画布'
      : kind === 'laid'
        ? '已在画布上'
        : kind === 'running'
          ? state?.kind === 'queued'
            ? '排队中…'
            : '生成中…'
          : kind === 'failed'
            ? '生成失败'
            : '已出图'
  const busy = state?.kind === 'queued' || state?.kind === 'running'
  return (
    <li className={styles.shot} data-storyboard-shot={shot.id}>
      <div className={styles.shotHead}>
        <span className={styles.shotNo}>第 {index + 1} 镜</span>
        <span
          className={kind === 'failed' ? `${styles.shotState} ${styles.shotStateBad}` : styles.shotState}
          data-storyboard-shot-status={shot.id}
          data-kind={kind}
        >
          {stateText}
        </span>
        <div className={styles.itemTools}>
          {onShowSource ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-source={shot.id}
              onClick={onShowSource}
            >
              看原文
            </button>
          ) : null}
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="上移这一镜"
            title="上移"
            disabled={index === 0}
            data-storyboard-shot-up={shot.id}
            onClick={() => onMove(shot.id, -1)}
          >
            <IconUp />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="下移这一镜"
            title="下移"
            disabled={index === total - 1}
            data-storyboard-shot-down={shot.id}
            onClick={() => onMove(shot.id, 1)}
          >
            <IconDown />
          </button>
          <button
            type="button"
            className={confirming ? `${styles.iconBtn} ${styles.iconBtnDanger}` : styles.iconBtn}
            aria-label={confirming ? '再点一次，删除这一镜' : '删除这一镜'}
            title={confirming ? '再点一次，删除这一镜' : '删除'}
            data-storyboard-shot-remove={shot.id}
            data-confirming={confirming ? 'true' : 'false'}
            onClick={() => onRemove(shot.id)}
          >
            <IconTrash />
          </button>
        </div>
      </div>
      <div className={styles.shotBar}>
        {shot.videoHash ? (
          <span className={styles.shotVideo} data-storyboard-shot-video-preview={shot.id}>
            <ShotVideo hash={shot.videoHash} />
          </span>
        ) : null}
        {shot.imageHash ? (
          <span className={styles.shotImage} data-storyboard-shot-image={shot.id}>
            <ShotThumb hash={shot.imageHash} />
          </span>
        ) : null}
        <div className={styles.itemTools}>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-shot-run={shot.id}
            disabled={!laidOut || busy}
            onClick={onRun}
          >
            {shot.imageHash ? '重出这一镜' : '出图'}
          </button>
          {/*
            在画布里定位这一镜（对账 #424）：以前只有这一集级别的「在画布里打开」，
            一集十几镜铺下去之后，要在画布上找到"刚才那一镜"只能靠肉眼扫。
          */}
          {onLocate ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-locate={shot.id}
              onClick={onLocate}
            >
              在画布里定位
            </button>
          ) : null}
          {/*
            「出视频」（对账 #429）：只在这一镜**已经铺到画布、且已经出了图**时出现 ——
            图生视频要先有画面。不摆一个点了会被拒的按钮。
            另起一个视频节点（图不会被顶掉），跑完 hash 由镜像 effect 收回文档。
          */}
          {onMakeVideo ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-video={shot.id}
              disabled={busy}
              title={
                videoPairHint
                  ? '下一镜也已出图：优先用这一镜和下一镜做首尾帧；模型不支持时回落单张首帧'
                  : '拿这一镜的图去生成一段视频（另起一个视频节点，这一镜的图不会被顶掉）'
              }
              onClick={onMakeVideo}
            >
              {shot.videoHash
                ? `重出这一镜的视频${videoPairHint ? ' · 首尾帧' : ''}`
                : `出视频${videoPairHint ? ' · 首尾帧' : ''}`}
            </button>
          ) : null}
          {onVideoUpscale && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-upscale={shot.id}
              disabled={busy || upscaleBusy}
              onClick={() => (upscaleOpen ? setUpscaleOpen(false) : openUpscale())}
            >
              {upscaleBusy ? '视频处理中…' : '视频后处理'}
            </button>
          ) : null}
          {onVideoErase && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-erase={shot.id}
              disabled={busy || videoErasing}
              onClick={() => setVideoEraseOpen((current) => !current)}
            >
              {videoErasing ? '字幕擦除中…' : '字幕擦除'}
            </button>
          ) : null}
          {onVideoEdit && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-edit={shot.id}
              disabled={busy || videoEditing}
              onClick={() =>
                videoEditOpen ? setVideoEditOpen(false) : openVideoEdit()
              }
            >
              {videoEditing ? '视频编辑中…' : '视频编辑'}
            </button>
          ) : null}
          {onVideoExtend && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-extend={shot.id}
              disabled={busy || videoExtending}
              onClick={() =>
                videoExtendOpen ? setVideoExtendOpen(false) : openVideoExtend()
              }
            >
              {videoExtending ? '视频续写中…' : '视频续写'}
            </button>
          ) : null}
          {onDownloadVideo && shot.videoHash ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-download-video={shot.id}
              onClick={onDownloadVideo}
            >
              下载视频
            </button>
          ) : null}
        </div>
      </div>
      {upscaleOpen && currentUpscaleTarget ? (
        <div className={styles.upscalePanel} data-storyboard-upscale-panel={shot.id}>
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-upscale-target-${shot.id}`}
              className={styles.select}
              value={String(upscaleTargetIndex)}
              ariaLabel="超清模型"
              options={videoUpscaleTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(next) => {
                const nextIndex = Number(next)
                const nextTarget = videoUpscaleTargets[nextIndex]
                if (!nextTarget) return
                const normalized = normalizeVideoUpscaleSettings(nextTarget.model)
                setUpscaleTargetIndex(nextIndex)
                setUpscaleResolution(normalized.resolution)
                setUpscaleFrameRate(normalized.frameRate)
              }}
            />
          </label>
          {currentUpscaleTarget.resolutions.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>清晰度</span>
              <ChoicePicker
                name={`storyboard-upscale-resolution-${shot.id}`}
                className={styles.select}
                value={upscaleResolution}
                ariaLabel="超清清晰度"
                options={currentUpscaleTarget.resolutions.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={setUpscaleResolution}
              />
            </label>
          ) : null}
          {currentUpscaleTarget.frameRates.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>帧率</span>
              <ChoicePicker
                name={`storyboard-upscale-fps-${shot.id}`}
                className={styles.select}
                value={upscaleFrameRate == null ? '' : String(upscaleFrameRate)}
                ariaLabel="超清帧率"
                options={currentUpscaleTarget.frameRates.map((value) => ({
                  value: String(value),
                  label: `${value}fps`,
                }))}
                onChange={(value) => setUpscaleFrameRate(Number(value))}
              />
            </label>
          ) : null}
          <div className={styles.upscaleActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-upscale-cancel={shot.id}
              disabled={upscaleBusy}
              onClick={() => setUpscaleOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-upscale-submit={shot.id}
              disabled={upscaleBusy}
              onClick={() => {
                setUpscaleOpen(false)
                onVideoUpscale?.(
                  currentUpscaleTarget,
                  upscaleResolution,
                  upscaleFrameRate,
                )
              }}
            >
              开始超清
            </button>
          </div>
        </div>
      ) : null}
      {videoEraseOpen && currentVideoEraseTarget ? (
        <div
          className={styles.videoEditPanel}
          data-storyboard-video-erase-panel={shot.id}
        >
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-video-erase-target-${shot.id}`}
              className={styles.select}
              value={String(videoEraseTargetIndex)}
              ariaLabel="字幕擦除模型"
              options={videoEraseTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(value) => setVideoEraseTargetIndex(Number(value))}
            />
          </label>
          <div className={styles.videoEditActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-erase-cancel={shot.id}
              disabled={videoErasing}
              onClick={() => setVideoEraseOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-video-erase-submit={shot.id}
              disabled={videoErasing}
              onClick={() => {
                setVideoEraseOpen(false)
                onVideoErase?.(currentVideoEraseTarget)
              }}
            >
              开始擦除
            </button>
          </div>
        </div>
      ) : null}
      {videoEditOpen && currentVideoEditTarget ? (
        <div
          className={styles.videoEditPanel}
          data-storyboard-video-edit-panel={shot.id}
        >
          <label className={`${styles.inlineField} ${styles.videoEditPrompt}`}>
            <span className={styles.label}>修改要求</span>
            <textarea
              className={styles.textarea}
              rows={2}
              value={videoEditInstruction}
              placeholder="例如：把白天改成雨夜，保留人物动作和镜头运动"
              data-storyboard-video-edit-instruction={shot.id}
              onChange={(e) => setVideoEditInstruction(e.target.value)}
            />
          </label>
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-video-edit-target-${shot.id}`}
              className={styles.select}
              value={String(videoEditTargetIndex)}
              ariaLabel="视频编辑模型"
              options={videoEditTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(value) => {
                const nextIndex = Number(value)
                const nextTarget = videoEditTargets[nextIndex]
                if (!nextTarget) return
                setVideoEditTargetIndex(nextIndex)
                setVideoEditResolution(normalizeVideoEditResolution(nextTarget.model))
                setVideoEditUseReference(
                  Boolean(nextTarget.supportsReferenceImage && shot.imageHash && laidOut),
                )
              }}
            />
          </label>
          {currentVideoEditTarget.resolutions.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>清晰度</span>
              <ChoicePicker
                name={`storyboard-video-edit-resolution-${shot.id}`}
                className={styles.select}
                value={videoEditResolution}
                ariaLabel="视频编辑清晰度"
                options={currentVideoEditTarget.resolutions.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={setVideoEditResolution}
              />
            </label>
          ) : null}
          {currentVideoEditTarget.supportsReferenceImage ? (
            <label
              className={styles.videoEditReference}
              title={
                canReferenceShotImage
                  ? '把当前镜头画面作为参考图一起发送'
                  : '当前镜头没有可引用的画面'
              }
            >
              <input
                type="checkbox"
                checked={videoEditUseReference && canReferenceShotImage}
                disabled={!canReferenceShotImage}
                data-storyboard-video-edit-reference={shot.id}
                onChange={(e) => setVideoEditUseReference(e.target.checked)}
              />
              <span>
                参考当前画面
                {currentVideoEditTarget.requiresReferenceImage ? '（必需）' : ''}
              </span>
            </label>
          ) : null}
          <div className={styles.videoEditActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-edit-cancel={shot.id}
              disabled={videoEditing}
              onClick={() => setVideoEditOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-video-edit-submit={shot.id}
              disabled={
                videoEditing ||
                !videoEditInstruction.trim() ||
                (currentVideoEditTarget.requiresReferenceImage &&
                  !(videoEditUseReference && canReferenceShotImage))
              }
              onClick={() => {
                setVideoEditOpen(false)
                onVideoEdit?.(
                  currentVideoEditTarget,
                  videoEditInstruction,
                  videoEditResolution,
                  videoEditUseReference && canReferenceShotImage,
                )
              }}
            >
              开始编辑
            </button>
          </div>
        </div>
      ) : null}
      {videoExtendOpen && currentVideoExtendTarget ? (
        <div
          className={styles.videoEditPanel}
          data-storyboard-video-extend-panel={shot.id}
        >
          <label className={`${styles.inlineField} ${styles.videoEditPrompt}`}>
            <span className={styles.label}>续写要求</span>
            <textarea
              className={styles.textarea}
              rows={2}
              value={videoExtendInstruction}
              placeholder="续写接下来发生什么，保持人物、场景和画风一致"
              data-storyboard-video-extend-instruction={shot.id}
              onChange={(e) => setVideoExtendInstruction(e.target.value)}
            />
          </label>
          <label className={styles.inlineField}>
            <span className={styles.label}>模型</span>
            <ChoicePicker
              name={`storyboard-video-extend-target-${shot.id}`}
              className={styles.select}
              value={String(videoExtendTargetIndex)}
              ariaLabel="视频续写模型"
              options={videoExtendTargets.map((target, targetIndex) => ({
                value: String(targetIndex),
                label: target.label,
              }))}
              onChange={(value) => {
                const nextIndex = Number(value)
                const nextTarget = videoExtendTargets[nextIndex]
                if (!nextTarget) return
                const normalized = normalizeVideoExtendSettings(nextTarget.model)
                setVideoExtendTargetIndex(nextIndex)
                setVideoExtendResolution(normalized.resolution)
                setVideoExtendDuration(normalized.duration)
              }}
            />
          </label>
          {currentVideoExtendTarget.resolutions.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>清晰度</span>
              <ChoicePicker
                name={`storyboard-video-extend-resolution-${shot.id}`}
                className={styles.select}
                value={videoExtendResolution}
                ariaLabel="视频续写清晰度"
                options={currentVideoExtendTarget.resolutions.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={setVideoExtendResolution}
              />
            </label>
          ) : null}
          {currentVideoExtendTarget.durations.length > 0 ? (
            <label className={styles.inlineField}>
              <span className={styles.label}>新增时长</span>
              <ChoicePicker
                name={`storyboard-video-extend-duration-${shot.id}`}
                className={styles.select}
                value={videoExtendDuration == null ? '' : String(videoExtendDuration)}
                ariaLabel="视频续写新增时长"
                options={currentVideoExtendTarget.durations.map((value) => ({
                  value: String(value),
                  label: `${value}s`,
                }))}
                onChange={(value) => setVideoExtendDuration(Number(value))}
              />
            </label>
          ) : null}
          <div className={styles.videoEditActions}>
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-video-extend-cancel={shot.id}
              disabled={videoExtending}
              onClick={() => setVideoExtendOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.primary}
              data-storyboard-video-extend-submit={shot.id}
              disabled={videoExtending}
              onClick={() => {
                setVideoExtendOpen(false)
                onVideoExtend?.(
                  currentVideoExtendTarget,
                  videoExtendInstruction,
                  videoExtendResolution,
                  videoExtendDuration,
                )
              }}
            >
              开始续写
            </button>
          </div>
        </div>
      ) : null}
      {state?.kind === 'failed' ? (
        <p className={styles.error} data-storyboard-shot-error={shot.id}>
          {describeError(state.error)}
        </p>
      ) : null}
      {/**
       * 这一镜绑了谁 / 在哪拍（对账 #416）。
       *
       * 一镜**一个场景**（场景是资产不是容器）+ 若干出场角色（点一下切换）。
       * 绑定只改文档，不动提示词：提示词仍以这一镜的 `prompt` / `scene` 为准
       * （把角色描述拼进提示词，是接参考图 / 定妆图那一步的事，别混在这一步里）。
       */}
      <div className={styles.shotBind}>
        <label className={styles.inlineField}>
          <span className={styles.label}>场景</span>
          <ChoicePicker
            name={`storyboard-shot-scene-${shot.id}`}
            className={styles.select}
            value={shot.sceneId ?? ''}
            ariaLabel="绑定场景"
            options={[
              { value: '', label: '未指定' },
              ...scenes.map((scene) => ({ value: scene.id, label: scene.name })),
            ]}
            onChange={(value) => onBindScene(value || null)}
          />
        </label>
        <div className={styles.inlineField}>
          <span className={styles.label}>出场角色</span>
          <div className={styles.chips} data-storyboard-shot-cast={shot.id}>
            {characters.length === 0 ? (
              <span className={styles.hint}>还没有角色</span>
            ) : (
              characters.map((c) => {
                const on = shot.characterIds?.includes(c.id) ?? false
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    aria-pressed={on}
                    data-storyboard-shot-character={shot.id}
                    data-character-id={c.id}
                    data-on={on ? 'true' : 'false'}
                    onClick={() => onToggleCharacter(c.id)}
                  >
                    {c.name}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>画面</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.scene}
          placeholder="这一镜画什么"
          data-storyboard-shot-scene={shot.id}
          onChange={(e) => onPatch(shot.id, { scene: e.target.value })}
        />
      </label>
      <div className={styles.row2}>
        {/**
         * **对白层**（对账 #435）：「一镜一句自由文本」升级成**一镜多句 + 谁说的**。
         * 两个理由都是实的：① 两个人对着说话的镜头本来就需要两条；
         * ② 说话人是**压字幕 / 将来喂 TTS** 的必需字段（研究稿 §34）。
         * 空态写清"可以是空的（空镜）"，不摆一个必须填的框。
         */}
        <div className={styles.field} data-storyboard-lines={shot.id}>
          <div className={styles.linesHead}>
            <span className={styles.label}>台词 / 旁白</span>
            <div className={styles.linesHeadActions}>
              {shot.lines.length > 0 ? (
                <button
                  type="button"
                  className={styles.ghost}
                  data-storyboard-shot-digital-human={shot.id}
                  disabled={!digitalHumanPlan.ok || digitalHumanBusy}
                  title={
                    digitalHumanPlan.ok
                      ? `用 ${digitalHumanModel ?? '数字人口播模型'} 生成这一镜的口播视频`
                      : digitalHumanPlan.reason
                  }
                  onClick={onMakeDigitalHuman}
                >
                  {digitalHumanBusy
                    ? '口播视频生成中…'
                    : shot.videoHash
                      ? shot.lines.length > 1
                        ? `重做数字人口播（${shot.lines.length} 句）`
                        : '重做数字人口播'
                      : shot.lines.length > 1
                        ? `数字人口播（${shot.lines.length} 句）`
                        : '数字人口播'}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.ghost}
                data-storyboard-line-add={shot.id}
                onClick={onAddLine}
              >
                加一句
              </button>
            </div>
          </div>
          {shot.lines.length === 0 ? (
            <p className={styles.hint} data-storyboard-lines-empty={shot.id}>
              可以是空的（空镜）
            </p>
          ) : (
            <ul className={styles.lineList}>
              {shot.lines.map((line) => {
                const voices = speechTarget?.voices.length ? speechTarget.voices : ['alloy', 'nova']
                const speaker = characters.find((item) => item.id === line.speakerId)
                const inheritedVoice = speaker?.voice?.trim() || ''
                const inheritedSpeed = speaker?.speed ?? 1
                const voiceOptions = [
                  ...new Set(
                    [line.voice, inheritedVoice, ...voices].filter(
                      (item): item is string => Boolean(item),
                    ),
                  ),
                ]
                const busy = !!voiceBusy[line.id]
                return (
                  <li key={line.id} className={styles.lineRow} data-storyboard-line={line.id}>
                    <div className={styles.lineMain}>
                      <ChoicePicker
                        name={`storyboard-line-speaker-${line.id}`}
                        className={styles.lineSpeaker}
                        value={line.speakerId ?? ''}
                        ariaLabel="谁说的"
                        options={[
                          { value: '', label: '谁说…' },
                          ...characters.map((character) => ({
                            value: character.id,
                            label: character.name,
                          })),
                        ]}
                        onChange={(value) => onLinePatch(line.id, { speakerId: value })}
                      />
                      <input
                        className={styles.input}
                        value={line.text}
                        placeholder="这一句"
                        aria-label="台词"
                        data-storyboard-line-text={line.id}
                        onChange={(e) => onLinePatch(line.id, { text: e.target.value })}
                      />
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label="删掉这一句"
                        data-storyboard-line-remove={line.id}
                        onClick={() => onLineRemove(line.id)}
                      >
                        ×
                      </button>
                    </div>
                    <div className={styles.lineVoiceControls}>
                      <label className={styles.lineVoiceSelect}>
                        <span>音色</span>
                        <ChoicePicker
                          name={`storyboard-line-voice-${line.id}`}
                          className={styles.select}
                          value={line.voice ?? ''}
                          ariaLabel="台词语音音色"
                          options={[
                            {
                              value: '',
                              label: inheritedVoice
                                ? `跟随角色（${inheritedVoice}）`
                                : '跟随渠道默认',
                            },
                            ...voiceOptions.map((item) => ({ value: item, label: item })),
                          ]}
                          onChange={(value) => onLinePatch(line.id, { voice: value })}
                        />
                      </label>
                      <label className={styles.lineVoiceSpeed}>
                        <span>语速</span>
                        <input
                          className={styles.input}
                          type="number"
                          min={0.25}
                          max={4}
                          step={0.05}
                          value={line.speed ?? inheritedSpeed}
                          data-storyboard-line-voice-speed={line.id}
                          onChange={(e) => onLinePatch(line.id, { speed: Number(e.target.value) })}
                        />
                      </label>
                      <button
                        type="button"
                        className={styles.ghost}
                        data-storyboard-line-voice={line.id}
                        disabled={!speechTarget || busy || !line.text.trim()}
                        title={speechTarget?.label ?? '先在设置里勾选配音模型'}
                        onClick={() => onVoice(line.id)}
                      >
                        {busy ? '生成中…' : line.audioHash ? '重配这一句' : '生成配音'}
                      </button>
                      {line.audioHash ? (
                        <LineVoiceAudio hash={line.audioHash} />
                      ) : (
                        <span className={styles.hint}>
                          {speechTarget ? `未生成 · ${speechTarget.label}` : '未配置配音模型'}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <label className={styles.field}>
          <span className={styles.label}>时长（秒）</span>
          <input
            className={styles.input}
            type="number"
            min={1}
            step={1}
            value={shot.durationSec}
            data-storyboard-shot-duration={shot.id}
            onChange={(e) => onPatch(shot.id, { durationSec: Number(e.target.value) })}
          />
        </label>
        {index < total - 1 ? (
          <>
            <label className={styles.field}>
              <span className={styles.label}>转场到下一镜</span>
              <ChoicePicker
                name={`storyboard-shot-transition-${shot.id}`}
                className={styles.select}
                value={shot.transition ?? 'cut'}
                ariaLabel="转场到下一镜"
                options={[
                  { value: 'cut', label: '硬切' },
                  { value: 'fade', label: '淡入淡出（黑场）' },
                ]}
                onChange={(value) =>
                  onPatch(shot.id, {
                    transition: value === 'fade' ? 'fade' : 'cut',
                  })
                }
              />
            </label>
            {shot.transition === 'fade' ? (
              <label className={styles.field}>
                <span className={styles.label}>转场时长（秒）</span>
                <input
                  className={styles.input}
                  type="number"
                  min={0.1}
                  max={1}
                  step={0.1}
                  value={shot.transitionSec ?? DEFAULT_TRANSITION_SECONDS}
                  data-storyboard-shot-transition-seconds={shot.id}
                  onChange={(e) =>
                    onPatch(shot.id, { transitionSec: Number(e.target.value) })
                  }
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>
      <label className={styles.field}>
        <span className={styles.label}>画面提示词</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.prompt}
          placeholder="留空就用上面的「画面」"
          data-storyboard-shot-prompt={shot.id}
          onChange={(e) => onPatch(shot.id, { prompt: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>视频提示词（运镜 / 动作）</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.videoPrompt ?? ''}
          placeholder="例如：镜头缓慢推进，人物抬头看向门口；留空则自动生成自然运动"
          data-storyboard-shot-video-prompt={shot.id}
          onChange={(e) => onPatch(shot.id, { videoPrompt: e.target.value })}
        />
      </label>
    </li>
  )
}

/**
 * 资产一行（角色 / 场景共用，对账 #416）。
 *
 * 别名的输入框**自己存一份原始文本**：文档里存的是数组，若直接把数组 join 回去，
 * 用户刚打完的顿号会被立刻吃掉（「林公子、」→ 数组 `['林公子']` → 回显「林公子」），
 * 下一个字就接到名字后面去了。所以原始文本进本地 state，文档只收解析后的数组；
 * 失焦时再把文本归一成数组的样子。行上带 `key={asset.id}`：换一条资产就重新挂载，
 * 不需要"同步 props 到 state"那种 effect（那类写法最容易和用户的输入打架）。
 */
function AssetRow({
  asset,
  kind,
  usedBy,
  confirming,
  hasNode,
  state,
  hasTurnaroundNode = false,
  turnaroundState,
  voices = [],
  onPatch,
  onRemove,
  onMake,
  onTurnaround,
  merge,
  mergeChoices = [],
  onMergeOpen,
  onMergePick,
  onMergeConfirm,
  onMergeCancel,
}: {
  asset: DramaAsset & Partial<Pick<DramaCharacter, 'voice' | 'speed'>>
  kind: 'char' | 'scene'
  /** 有多少镜在用（删除确认里如实报数） */
  usedBy: number
  confirming: boolean
  /** 这条资产的生成节点**现在还在画布上**（不是"曾经建过"） */
  hasNode: boolean
  state?: RunTaskState
  /** 多视角 turnaround 的节点现在还在画布上 */
  hasTurnaroundNode?: boolean
  turnaroundState?: RunTaskState
  voices?: readonly string[]
  onPatch: (
    patch: Partial<
      Pick<DramaCharacter, 'name' | 'description' | 'aliases' | 'voice' | 'speed'>
    >,
  ) => void
  onRemove: () => void
  onMake: () => void
  onTurnaround?: () => void
  /** 合并（#436）：`null` = 没在合并；`keepId` 空 = 还在选目标，有 = 等确认 */
  merge?: { keepId: string | null } | null
  /** 可以并进的同类资产（含各自的引用镜数）—— 没有别的同类资产时这个按钮不出现 */
  mergeChoices?: readonly { id: string; name: string; refs: number }[]
  onMergeOpen?: () => void
  onMergePick?: (keepId: string) => void
  onMergeConfirm?: () => void
  onMergeCancel?: () => void
}) {
  const [aliasText, setAliasText] = useState(asset.aliases.join('、'))
  const label = kind === 'char' ? '定妆图' : '基准图'
  /**
   * 状态一格写完（界面 / 冒烟都读这一个属性）：
   * 没节点 → idle；有节点没图 → laid；跑着 → running；失败 → failed；有图 → done。
   * **失败优先于"有图"**：重出失败时旧图还在，但用户此刻要知道的是"这次失败了"。
   */
  const statusKind = !hasNode
    ? 'idle'
    : state?.kind === 'failed'
      ? 'failed'
      : state?.kind === 'queued' || state?.kind === 'running'
        ? 'running'
        : asset.baseHash
          ? 'done'
          : 'laid'
  const statusText =
    statusKind === 'idle'
      ? `还没出${label}`
      : statusKind === 'laid'
        ? '已建节点'
        : statusKind === 'running'
          ? state?.kind === 'queued'
            ? '排队中…'
            : '生成中…'
          : statusKind === 'failed'
            ? '生成失败'
            : '已出图'
  const busy = state?.kind === 'queued' || state?.kind === 'running'
  const turnaroundBusy =
    turnaroundState?.kind === 'queued' || turnaroundState?.kind === 'running'
  const turnaroundStatusKind = !hasTurnaroundNode
    ? 'idle'
    : turnaroundState?.kind === 'failed'
      ? 'failed'
      : turnaroundBusy
        ? 'running'
        : asset.turnaroundHash
          ? 'done'
          : 'laid'
  const turnaroundStatusText =
    turnaroundStatusKind === 'idle'
      ? '还没出多视角'
      : turnaroundStatusKind === 'laid'
        ? '已建节点'
        : turnaroundStatusKind === 'running'
          ? '生成中…'
          : turnaroundStatusKind === 'failed'
            ? '生成失败'
            : '已出多视角'
  const voiceOptions = [
    ...new Set(
      [asset.voice, ...voices].filter((item): item is string => Boolean(item)),
    ),
  ]
  return (
    <div
      className={styles.assetRow}
      data-asset-kind={kind}
      {...(kind === 'char'
        ? { 'data-storyboard-character': asset.id }
        : { 'data-storyboard-scene': asset.id })}
    >
      <span className={styles.assetKind}>{kind === 'char' ? '角色' : '场景'}</span>
      <input
        className={styles.assetName}
        value={asset.name}
        aria-label="名字"
        data-storyboard-asset-name={asset.id}
        onChange={(e) => onPatch({ name: e.target.value })}
      />
      <input
        className={styles.assetDesc}
        value={asset.description}
        aria-label="描述"
        placeholder={kind === 'char' ? '外观 / 身份' : '场地与氛围'}
        data-storyboard-asset-desc={asset.id}
        onChange={(e) => onPatch({ description: e.target.value })}
      />
      <input
        className={styles.assetAliases}
        value={aliasText}
        aria-label="别名"
        placeholder="别名，用、分隔"
        data-storyboard-asset-aliases={asset.id}
        onChange={(e) => {
          setAliasText(e.target.value)
          onPatch({
            aliases: e.target.value
              .split(/[、,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }}
        onBlur={() => setAliasText(asset.aliases.join('、'))}
      />
      {kind === 'char' ? (
        <div className={styles.assetVoiceRow}>
          <label className={styles.inlineField}>
            <span className={styles.label}>默认音色</span>
            <ChoicePicker
              name={`storyboard-character-voice-${asset.id}`}
              className={styles.select}
              value={asset.voice ?? ''}
              ariaLabel="角色默认音色"
              options={[
                { value: '', label: '跟随渠道默认' },
                ...voiceOptions.map((voice) => ({ value: voice, label: voice })),
              ]}
              onChange={(voice) => onPatch({ voice })}
            />
          </label>
          <label className={styles.inlineField}>
            <span className={styles.label}>默认语速</span>
            <input
              className={styles.input}
              type="number"
              min={0.25}
              max={4}
              step={0.05}
              value={asset.speed ?? 1}
              data-storyboard-character-speed={asset.id}
              onChange={(e) => onPatch({ speed: Number(e.target.value) })}
            />
          </label>
        </div>
      ) : null}
      <button
        type="button"
        className={confirming ? `${styles.iconBtn} ${styles.iconBtnDanger}` : styles.iconBtn}
        aria-label={confirming ? `再点一次：会从 ${usedBy} 镜里去掉` : '删除'}
        title={confirming ? `再点一次：会从 ${usedBy} 镜里去掉` : '删除'}
        data-storyboard-asset-remove={asset.id}
        data-confirming={confirming ? 'true' : 'false'}
        onClick={onRemove}
      >
        <IconTrash />
      </button>
      <div className={styles.assetFoot}>
        <div className={styles.assetFootRow}>
          {asset.baseHash ? (
            <span className={styles.shotImage} data-storyboard-asset-image={asset.id}>
              <AssetThumb hash={asset.baseHash} />
            </span>
          ) : null}
          <span
            className={
              statusKind === 'failed' ? `${styles.shotState} ${styles.shotStateBad}` : styles.shotState
            }
            data-storyboard-asset-status={asset.id}
            data-kind={statusKind}
          >
            {statusText}
          </span>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-asset-base={asset.id}
            disabled={busy}
            onClick={onMake}
          >
            {asset.baseHash ? `重出${label}` : `出${label}`}
          </button>
          {kind === 'char' && asset.turnaroundHash ? (
            <span
              className={styles.shotImage}
              data-storyboard-asset-turnaround-image={asset.id}
            >
              <AssetThumb hash={asset.turnaroundHash} />
            </span>
          ) : null}
          {kind === 'char' && onTurnaround ? (
            <span
              className={
                turnaroundStatusKind === 'failed'
                  ? `${styles.shotState} ${styles.shotStateBad}`
                  : styles.shotState
              }
              data-storyboard-asset-turnaround-status={asset.id}
              data-kind={turnaroundStatusKind}
            >
              {turnaroundStatusText}
            </span>
          ) : null}
          {kind === 'char' && onTurnaround ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-asset-turnaround={asset.id}
              disabled={turnaroundBusy || busy}
              onClick={onTurnaround}
            >
              {asset.turnaroundHash ? '重出多视角' : '多视角'}
            </button>
          ) : null}
          {/**
           * 「并入…」（对账 #436）：拆镜按 `name + aliases` 自动归并，但模型换个叫法
           * （"林轩" / "林公子"）就会落下两条重复。以前只能删掉一条 —— 而删会把引用一起清掉。
           * 合并才是这件事的答案。没别的同类资产时按钮不出现（点了没人可并）。
           */}
          {onMergeOpen && mergeChoices.length > 0 ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-asset-merge={asset.id}
              onClick={onMergeOpen}
            >
              并入…
            </button>
          ) : null}
        </div>
        {merge ? (
          <div className={styles.mergeBox} data-storyboard-merge-box={asset.id}>
            {merge.keepId === null ? (
              <>
                <span className={styles.hint}>并入哪一条？</span>
                <div className={styles.mergeChoices}>
                  {mergeChoices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={styles.ghost}
                      data-storyboard-merge-target={choice.id}
                      onClick={() => onMergePick?.(choice.id)}
                    >
                      并入 {choice.name}（{choice.refs} 镜引用）
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/**
                 * 第二下**只说后果**：会改几镜的引用、然后删掉这一条。
                 * 与删资产那条"两下确认"同一条口径 —— 不可撤销的动作先把代价说清楚。
                 */}
                <p className={styles.hint} data-storyboard-merge-note={asset.id}>
                  把「{asset.name}」并进「
                  {mergeChoices.find((c) => c.id === merge.keepId)?.name ?? ''}」：会改 {usedBy}{' '}
                  镜的引用，然后删掉这一条。
                </p>
                <div className={styles.mergeChoices}>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-merge-confirm={asset.id}
                    onClick={onMergeConfirm}
                  >
                    确认合并
                  </button>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-merge-cancel={asset.id}
                    onClick={onMergeCancel}
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {state?.kind === 'failed' ? (
          <p className={styles.error} data-storyboard-asset-error={asset.id}>
            {describeError(state.error)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** 资产的基准图缩略图（角色定妆图 / 场景基准图）：按 hash 取素材 */
function AssetThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img className={styles.shotImg} src={url} alt="" />
}

function LineVoiceAudio({ hash }: { hash: string }) {
  const meta = useAssetMeta(hash)
  if (meta.missing) return <span className={styles.error}>配音素材缺失</span>
  if (!meta.url) return <span className={styles.hint}>正在读取配音…</span>
  return (
    <audio
      className={styles.lineVoiceAudio}
      controls
      preload="metadata"
      src={meta.url}
      data-storyboard-line-audio={hash}
    />
  )
}

/** 这一镜的出图缩略图：按 hash 取素材（hook 必须落在子组件里，不能在 map 里调） */
function ShotThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img className={styles.shotImg} src={url} alt="" />
}

/** 当前镜头视频预览：视频节点可能已被替换，但镜头 hash 始终指向当前版本。 */
function ShotVideo({ hash }: { hash: string }) {
  const meta = useAssetMeta(hash)
  if (meta.missing) return <span className={styles.error}>视频素材缺失</span>
  if (!meta.url) return <span className={styles.hint}>正在读取视频…</span>
  return (
    <video
      className={styles.shotVideoPlayer}
      controls
      playsInline
      preload="metadata"
      src={meta.url}
      data-storyboard-shot-video={hash}
    />
  )
}

/** 把任意异常翻成给用户看的句子（`asAppError` + `describeError` 是本项目统一的翻译对） */
function humanError(e: unknown): string {
  const appError = asAppError(e)
  return appError ? describeError(appError) : e instanceof Error ? e.message : String(e)
}

function IconUp() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}

function IconDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </svg>
  )
}
