import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../app/providers/SkillStoreProvider'
import { flushOnPageHide } from '../../app/session'
import { createProjectRepository } from '../../state/project/repository'
import { createStoryboardStore } from '../../state/project/storyboardStore'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import {
  StoryboardCanvasHost,
  useStoryboardCanvasRuntime,
} from '../../app/workbenchHosts/StoryboardCanvasHost'
import { StoryboardExecutionHost } from '../../app/workbenchHosts/StoryboardExecutionHost'
import { assetHashesOfNode } from '../../domain/canvas/graph/assetRefs'
import { projectRoute } from '../../domain/shared/workbench'
import { resolveSpeechTarget } from '../../domain/shared/chatTarget'
import {
  BREAKDOWN_SKILL_ID,
  resolveChatTarget,
} from '../../domain/storyboard/breakdown'
import {
  episodeSourceText,
} from '../../domain/storyboard/episodes'
import {
  type MergeSuggestion,
} from '../../domain/storyboard/mergeSuggest'
import { fingerprintBytesSync } from '../../domain/shared/hash'
import { createId } from '../../shared/id'
import {
  episodeTimeline,
  srtOf,
} from '../../domain/storyboard/ffmpegPack'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { createStoryboardExportController } from '../../workbenches/storyboard/useStoryboardExportController'
import { createStoryboardAudioController } from '../../workbenches/storyboard/useStoryboardAudioController'
import { createStoryboardAuthoringController } from '../../workbenches/storyboard/useStoryboardAuthoringController'
import { createStoryboardAssetController } from '../../workbenches/storyboard/useStoryboardAssetController'
import { createStoryboardShotController } from '../../workbenches/storyboard/useStoryboardShotController'
import {
  createStoryboardVideoController,
  type VideoEraseTarget,
  type VideoEditTarget,
  type VideoExtendTarget,
  type VideoUpscaleTarget,
} from '../../workbenches/storyboard/useStoryboardVideoController'
import { EpisodePreview } from './EpisodePreview'
import { SourcePreview } from './SourcePreview'
import { AssetRow } from './AssetRow'
import { BgmField } from './BgmField'
import { ShotCard } from './ShotCard'
import { IconDown, IconTrash, IconUp } from './StoryboardIcons'
import {
  addCharacter,
  addEpisode,
  addScene,
  addShot,
  addShotLine,
  attachShotImages,
  attachShotVideos,
  bindShotScene,
  moveEpisode,
  moveShot,
  mergeAsset,
  removeCharacter,
  removeEpisode,
  removeScene,
  removeShot,
  removeShotLine,
  setAssetBaseHash,
  setAssetTurnaroundHash,
  shotsNeedingNode,
  shotsOf,
  storyboardStats,
  toggleShotCharacter,
  updateCharacter,
  updateEpisode,
  updateScene,
  updateScript,
  updateShot,
  updateShotLine,
  updateSourceText,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import {
  VIDEO_UPSCALE_MODEL_IDS,
  videoUpscaleOptionsOf,
} from '../../domain/storyboard/videoUpscale'
import { VIDEO_ERASE_MODEL_IDS } from '../../domain/storyboard/videoErase'
import {
  VIDEO_EDIT_MODEL_IDS,
  videoEditRequiresReferenceImage,
  videoEditResolutionsOf,
} from '../../domain/storyboard/videoEdit'
import {
  VIDEO_EXTEND_MODEL_IDS,
  videoExtendDurationsOf,
  videoExtendResolutionsOf,
} from '../../domain/storyboard/videoExtend'
import styles from './StoryboardPage.module.css'

const DIGITAL_HUMAN_MODEL_IDS = [
  'Kling V2 数字人口播 Std',
  'Kling V2 数字人口播 Pro',
] as const

/** 防抖窗口：连打一串字只落一次库（与外观偏好同一条口径） */
const SAVE_DEBOUNCE_MS = 400

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
export function StoryboardProject({ projectId }: { projectId: string }) {
  return (
    <StoryboardExecutionHost projectId={projectId}>
      <StoryboardCanvasHost
        projectId={projectId}
        renderLoading={(error) => (
          <div className={styles.emptyWrap} data-storyboard-hydrating>
            <p className={styles.emptyText}>
              {error ? `项目读取失败：${error}` : '正在读取这个漫剧项目…'}
            </p>
          </div>
        )}
      >
        <StoryboardEditor projectId={projectId} />
      </StoryboardCanvasHost>
    </StoryboardExecutionHost>
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
      scopeId?: string
      kind: 'text' | 'video' | 'speech'
      channelId: string
      model: string
      payload: unknown
      inputs?: DirectRunTraceInput['inputs']
      params?: Record<string, unknown>
    }): DirectRunTraceInput => ({
      projectId,
      scopeVersion: 1,
      workbench: 'storyboard',
      subjectId: args.subjectId,
      scopeId: args.scopeId ?? projectId,
      operationId: createId('op'),
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
      sentChannelId: args.channelId,
      sentModel: args.model,
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
  const {
    canvas,
    graph,
  } = useStoryboardCanvasRuntime()
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

  const { makeVideoUpscale, makeVideoErase, makeVideoEdit, makeVideoExtend } =
    createStoryboardVideoController({
      currentDoc: () => docRef.current,
      graphNodes: graph.nodes,
      liveNodeIds,
      channels,
      canvas,
      directTrace,
      apply,
      setLay,
      videoUpscaleBusy,
      setVideoUpscaleBusy,
      videoEraseBusy,
      setVideoEraseBusy,
      videoEditBusy,
      setVideoEditBusy,
      videoExtendBusy,
      setVideoExtendBusy,
    })

  const { makeAssetBase, makeAssetTurnaround } =
    createStoryboardAssetController({
      doc,
      currentDoc: () => docRef.current,
      liveNodeIds,
      canvas,
      apply,
      setLay,
    })

  const {
    layOut,
    runShot,
    makeShotVideo,
    makeDigitalHuman,
    runEpisodeVideos,
    syncPrompts,
    runEpisode,
  } = createStoryboardShotController({
    doc,
    currentDoc: () => docRef.current,
    selected,
    shots,
    needNodes,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    liveNodeIds,
    channels,
    canvas,
    platform,
    directTrace,
    digitalHumanTarget,
    apply,
    setLay,
    setDigitalHumanBusy,
  })

  const {
    scanMerges,
    acceptMerge,
    dismissMergeSuggestion,
    runSplit,
    cancelSplit,
    runBreakdown,
    cancelBreakdown,
  } = createStoryboardAuthoringController({
    doc,
    currentDoc: () => docRef.current,
    selected,
    shots,
    chatTarget,
    breakdownSkillContent: skills.skills.find(
      (skill) => skill.id === BREAKDOWN_SKILL_ID,
    )?.content,
    channels,
    projectId,
    directTrace,
    apply,
    split,
    setSplit,
    splitConfirm,
    setSplitConfirm,
    splitAbort,
    breaking,
    setBreaking,
    setBreakMsg,
    breakConfirm,
    setBreakConfirm,
    breakAbort,
    setMergeScan,
    setMerges,
    setMergeConfirmId,
  })

  const { voiceLine, runEpisodeVoices, onPickBgm, onRemoveBgm } =
    createStoryboardAudioController({
      doc,
      currentDoc: () => docRef.current ?? doc,
      selected,
      shots,
      speechTarget,
      platform,
      channels,
      canvas,
      directTrace,
      apply,
      setStatus,
      setVoiceBusy,
    })

  const { onExport, onExportPack, onExportSrt, renderEpisode } =
    createStoryboardExportController({
      doc,
      projectName,
      episodes,
      selected,
      timelineSrt,
      timelineSrtCues,
      platform,
      flush,
      setStatus,
      setRendering,
    })
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
                state={c.nodeId ? canvas.nodeStateOf(c.nodeId) : undefined}
                hasTurnaroundNode={Boolean(
                  c.turnaroundNodeId && liveNodeIds.has(c.turnaroundNodeId),
                )}
                turnaroundState={
                  c.turnaroundNodeId ? canvas.nodeStateOf(c.turnaroundNodeId) : undefined
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
                state={s.nodeId ? canvas.nodeStateOf(s.nodeId) : undefined}
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
                      disabled={laidCount === 0 || canvas.isRunning}
                      onClick={() => void runEpisode()}
                    >
                      这一集出图
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-run-all-video
                      disabled={videoPending === 0 || canvas.isRunning}
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
                        state={shot.nodeId ? canvas.nodeStateOf(shot.nodeId) : undefined}
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
