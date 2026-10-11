import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../app/providers/SkillStoreProvider'
import { createProjectRepository } from '../../state/project/repository'
import { createStoryboardStore } from '../../state/project/storyboardStore'
import { createStore } from '../../state/createStore'
import { canvasStoreFor } from '../../state/workbenches/canvas/storeCache'
import { CanvasStoreProvider, useCanvasStore, useGraph } from '../../workbenches/canvas/storeContext'
import {
  CanvasExecutionProvider,
  useCanvasExecution,
} from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { useAsset } from '../../workbenches/canvas/hooks/useAsset'
import { applyDefaults, resolveDefaults } from '../../features/canvas/createNodeWithDefaults'
import { assetHashesOfNode } from '../../domain/canvas/graph/assetRefs'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { projectRoute } from '../../domain/shared/workbench'
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
  parseSplitReply,
  planSplitBatches,
  splitSource,
  type EpisodeEnrichment,
} from '../../domain/storyboard/episodes'
import { asAppError, describeError } from '../../shared/result'
import {
  addCharacter,
  addEpisode,
  addScene,
  addShot,
  assetBasePrompt,
  attachShotImages,
  attachShotNodes,
  attachShotVideos,
  bindShotScene,
  exportStoryboardMarkdown,
  moveEpisode,
  moveShot,
  planShotRefEdges,
  removeCharacter,
  removeEpisode,
  removeScene,
  removeShot,
  setAssetBaseHash,
  setAssetNode,
  setShotVideoNode,
  shotPromptWithAssets,
  shotRefNodeIds,
  shotsNeedingNode,
  shotsOf,
  storyboardStats,
  toggleShotCharacter,
  updateCharacter,
  updateEpisode,
  updateScene,
  updateScript,
  updateShot,
  updateSourceText,
  type DramaAsset,
  type DramaCharacter,
  type DramaScene,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import styles from './StoryboardPage.module.css'

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
  const cached = canvasStoreFor(projectId, () =>
    createStore({ workbench: 'canvas', platform, projectId }),
  )
  const store = cached.store

  useEffect(() => () => store.dispose(), [store])

  /** 只读一次库（与画布页 / 电商页同一条口径），避免把内存里正在跑的写入盖回去 */
  useEffect(() => {
    if (cached.hydrated) return
    let cancelled = false
    void (async () => {
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
    })()
    return () => {
      cancelled = true
    }
  }, [cached, platform, projectId, store])

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
  const selectedIndex = selected ? episodes.findIndex((e) => e.id === selected.id) : -1
  /** 画布上现在还活着的节点（"这一镜铺没铺过"要看它，不能只看 `shot.nodeId`） */
  const liveNodeIds = new Set(graph.nodes.map((n) => n.id))
  const needNodes = shotsNeedingNode(shots, liveNodeIds)
  const laidCount = shots.filter((s) => s.nodeId && liveNodeIds.has(s.nodeId)).length

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
        const result = await channels.completeWithTools({
          channelId: chatTarget.channelId,
          model: chatTarget.model,
          tools: [],
          messages: [
            { role: 'system', content: buildSplitSystem() },
            { role: 'user', content: buildSplitText(batch, i, batches.length) },
          ],
          signal: ac.signal,
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

  const patchShot = (id: string, patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId'>>) => {
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
      setBreakMsg('还没有可用的对话模型 —— 去「全局设置 → 渠道配置」给一条渠道勾上对话模型')
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
      const result = await channels.completeWithTools({
        channelId: chatTarget.channelId,
        model: chatTarget.model,
        tools: [],
        messages: [
          { role: 'system', content: buildBreakdownSystem(skill?.content) },
          { role: 'user', content: breakdownText(doc, selected) },
        ],
        signal: ac.signal,
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
   * ② 建一个 `mode:'video'` 的**新节点**，并把这一镜的图节点**连上去** ——
   *    上游图正是靠这条连线进 `inputs` 的（G141 验过：`[{kind:'asset',…}]`）；
   * ③ **建完节点立刻写进文档**（`setShotVideoNode`）—— 跑视频是长任务、中途失败很常见，
   *    那时节点已经躺在画布上了；不写，用户再点一次会又建一个，画布上慢慢堆起没人认领的空节点；
   * ④ 产物 hash 由上面那条镜像 effect 收回文档，列表才知道这一镜有视频了。
   *
   * **为什么另铺节点、而不像出图那样 `inPlace`**：写回会把这一镜的**图**顶掉，
   * 而图还得留着 —— 它既是视频的输入，也是分镜表里的画面。图与视频各占一个节点，两条都在。
   */
  const makeShotVideo = async (shot: StoryboardShot) => {
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId)) {
      setLay({ kind: 'error', text: '这一镜还没铺到画布 —— 先铺一次，出了图再出视频' })
      return
    }
    if (!shot.imageHash) {
      setLay({ kind: 'error', text: '这一镜还没有图 —— 图生视频要先有画面，先点「出图」' })
      return
    }
    try {
      /**
       * 视频模型由**渠道解析**决定（与画布同一条口径：模型定下来，谁提供它由选路决定）。
       * 解析不到就如实说 —— 不硬编一个预设名去请求（#414 那条教训）。
       */
      const recipe = await channels.defaultForNewNode({}, 'video')
      if (!recipe?.channelId || !recipe?.model) {
        setLay({
          kind: 'error',
          text: '还没有可用的视频渠道 —— 先去「全局设置 → 渠道配置」配一条并勾上视频模型',
        })
        return
      }
      const imageNode = graph.nodes.find((n) => n.id === shot.nodeId)
      const data = await resolveDefaults({
        channels,
        type: 'generation',
        extraData: {
          mode: 'video',
          model: recipe.model,
          prompt: shotPromptWithAssets(doc, shot),
        },
      })
      let nodeId = ''
      canvasStore.beginPlan('storyboard:shot-video', '这一镜出视频')
      try {
        nodeId =
          applyDefaults({
            store: canvasStore,
            channels,
            projectId,
            type: 'generation',
            /* 贴着这一镜的图节点往右放（与模板「图生视频」的摆法一致，一眼看得出谁喂谁） */
            at: { x: (imageNode?.x ?? 40) + 280, y: imageNode?.y ?? 40 },
            data,
          }) ?? ''
        /* 这一步是"图进请求"的全部机制：连线就是 inputs（G141 验过） */
        if (nodeId) {
          canvasStore.dispatch({ kind: 'edge.connect', source: shot.nodeId, target: nodeId })
        }
      } finally {
        canvasStore.endPlan()
      }
      if (!nodeId) {
        setLay({ kind: 'error', text: '视频节点没能建出来（渠道或模型没配全）' })
        return
      }
      const current = docRef.current
      if (current) apply(setShotVideoNode(current, shot.id, nodeId, 0))
      setLay({ kind: 'running', text: '这一镜的视频在跑…' })
      await exec.runNode(nodeId)
      setLay({ kind: 'done', text: '这一镜的视频已出（画布里就挂在这一镜的图右边）' })
    } catch (e) {
      setLay({ kind: 'error', text: humanError(e) })
    }
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

  const onExport = async () => {
    try {
      await flush()
      const markdown = exportStoryboardMarkdown(doc)
      const base = (doc.script.title.trim() || projectName.trim() || '未命名漫剧').replace(
        /[\\/:*?"<>|]/g,
        '_',
      )
      await platform.files.saveFile(
        `${base}-分镜表.md`,
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      )
      setStatus('已导出分镜表')
    } catch {
      setStatus('导出失败')
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
                onPatch={(patch) => apply(updateCharacter(doc, c.id, patch, 0))}
                onRemove={() => removeOneAsset('char', c.id)}
                onMake={() => void makeAssetBase('char', c.id)}
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
              />
            ))}
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
                    : '还没有可用的对话模型 —— 去「全局设置 → 渠道配置」给一条渠道勾上对话模型'}
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
                        onMove={(id, delta) => apply(moveShot(doc, id, delta, 0))}
                        onRemove={removeOneShot}
                        onRun={() => runShot(shot)}
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
  onPatch: (id: string, patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId'>>) => void
  onMove: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onRun: () => void
  onBindScene: (sceneId: string | null) => void
  onToggleCharacter: (characterId: string) => void
  /** 「在画布里定位这一镜」（对账 #424）：跳过去选中并居中这一镜的节点；没有节点就不传 */
  onLocate?: () => void
  /** 「出视频」（对账 #429）：这一镜有图且节点还在时才传；不传就不渲染这个入口 */
  onMakeVideo?: () => void
}) {
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
              title="拿这一镜的图去生成一段视频（另起一个视频节点，这一镜的图不会被顶掉）"
              onClick={onMakeVideo}
            >
              {shot.videoHash ? '重出这一镜的视频' : '出视频'}
            </button>
          ) : null}
        </div>
      </div>
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
          <select
            className={styles.select}
            value={shot.sceneId ?? ''}
            data-storyboard-shot-scene-bind={shot.id}
            onChange={(e) => onBindScene(e.target.value || null)}
          >
            <option value="">未指定</option>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
        <label className={styles.field}>
          <span className={styles.label}>台词 / 旁白</span>
          <input
            className={styles.input}
            value={shot.dialogue}
            placeholder="可以是空的（空镜）"
            data-storyboard-shot-dialogue={shot.id}
            onChange={(e) => onPatch(shot.id, { dialogue: e.target.value })}
          />
        </label>
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
  onPatch,
  onRemove,
  onMake,
}: {
  asset: DramaAsset
  kind: 'char' | 'scene'
  /** 有多少镜在用（删除确认里如实报数） */
  usedBy: number
  confirming: boolean
  /** 这条资产的生成节点**现在还在画布上**（不是"曾经建过"） */
  hasNode: boolean
  state?: RunTaskState
  onPatch: (patch: Partial<Pick<DramaAsset, 'name' | 'description' | 'aliases'>>) => void
  onRemove: () => void
  onMake: () => void
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
  return (
    <div
      className={styles.assetRow}
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
        </div>
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

/** 这一镜的出图缩略图：按 hash 取素材（hook 必须落在子组件里，不能在 map 里调） */
function ShotThumb({ hash }: { hash: string }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img className={styles.shotImg} src={url} alt="" />
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
