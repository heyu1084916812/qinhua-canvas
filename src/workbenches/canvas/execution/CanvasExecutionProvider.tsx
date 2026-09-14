import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChannelAdapter } from '../../../platform/channels/types'
import { createChannelAdapter, type ResolvedChannelConfig } from '../../../platform/channels/registry'
import { buildRunPlan, type CanvasRunTask } from '../../../features/canvas/execution/buildRunPlan'
import { createCanvasPlacement } from '../../../features/canvas/execution/canvasPlacement'
// 执行引擎与宿主上移共享层（M6-5 路径 B）：画布注入自己的命令类型与落位适配器
import { useExecution } from '../../../features/shared/execution/useExecution'
import type { RunTaskState } from '../../../features/shared/execution/runEngine'
import type { Command } from '../../../state/commands'
import type { TransactionBoundary } from '../../../state/shared/types'
import { createChannelRepository } from '../../../state/project/channelRepository'
import type { Channel } from '../../../domain/project/channel'
import type { RunRequest } from '../../../domain/canvas/nodeSpecs/types'
import type { NodeInput } from '../../../domain/shared/execution/types'
import { boardSubgraph } from '../../../domain/canvas/board/boardSubgraph'
import { liveFingerprintOf, type RunRecord } from '../../../domain/canvas/model/runRecord'
import { staleNodeFingerprints, staleReport } from '../../../domain/canvas/staleness/staleNodes'
import { useCanvasStore, useGraph } from '../storeContext'
import { ConfirmDialog } from '../surface/ConfirmDialog'
import { RunHotkeys } from './RunHotkeys'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'

/**
 * 画布执行宿主（架构 §4.7 / §5.5）：把 `useExecution` 接到画布 store + 渠道解析器。
 * 节点视图只 emit `requestRun`，由这里翻译成 buildRunPlan + runEngine 调用；
 * 运行进度按 nodeId 反查后暴露给节点视图渲染（running / error / runMode）。
 *
 * 本层还持有两样**界面零认知的执行派生状态**：
 * - 各节点的成功指纹基线 → 对账出陈旧标记（§6.19.5）；
 * - 全图重跑的二次确认（§6.19.1）——顶栏按钮与快捷键都要经过它，放在这里避免各写一套。
 */
export interface CanvasExecutionApi {
  /** 单点生成（R / 面板 / 右键「生成」）；alt = `Alt+R`（保留旧内容，拓扑方向铺新下游） */
  runNode(nodeId: string, opts?: { alt?: boolean }): Promise<void>
  runBoard(boardId: string): Promise<void>
  /** 整条流程重新运行（P / 右键）：触发节点 + 全部下游按拓扑序覆盖式重跑 */
  rerunFrom(nodeId: string): Promise<void>
  /** 仅刷新陈旧（`Shift+R` = 触发节点下游；不传 = 全图，顶栏） */
  refreshStale(nodeId?: string): Promise<void>
  /** 全图重跑（`Ctrl+Enter` / 顶栏）——调用前必须已过二次确认 */
  rerunAll(): Promise<void>
  /** 请求全图重跑：弹二次确认（§6.19.1「确认前不进入执行引擎」） */
  requestRerunAll(): void
  /** 清除全图陈旧标记（§6.19.5 右键「清除陈旧标记」） */
  clearStale(): void
  cancel(): void
  nodeStateOf(nodeId: string): RunTaskState | undefined
  isRunning: boolean
  /** 追加 RunRecord（runEngine 之外的写入方，如版本恢复）并同步版本计数（§6.21） */
  appendRecord(record: RunRecord): Promise<void>
  /**
   * 文本 LLM 单次调用（提示词节点「优化 / 翻译 / 反推」，§6.7）。从渠道解析适配器并调 completeText
   *
   * `inputs` 是可带可不带：优化 / 翻译只处理文本，反推必须带上游图片素材——
   * 图若进不了这个请求，「上游图片送进 LLM」就永远只是界面上画了条线而已。
   */
  completeText(req: {
    channelId: string
    model: string
    /** 系统指令（优化 / 翻译 / 反推），与用户文本拼成最终 prompt */
    system: string
    text: string
    /** 随请求一起送出的素材（反推用）；不带即纯文本提问 */
    inputs?: NodeInput[]
    signal: AbortSignal
  }): Promise<string>
}

const Ctx = createContext<CanvasExecutionApi | null>(null)

export function CanvasExecutionProvider({ children }: { children: ReactNode }) {
  const store = useCanvasStore()
  /** 只用于驱动陈旧对账（图变更时重算），本组件不直接渲染它 */
  const graph = useGraph()
  const channels = useChannels()
  const platform = usePlatform()
  const repo = useMemo(
    () => createChannelRepository(platform.storage, platform.credentials),
    [platform.storage, platform.credentials],
  )

  const adapterMapRef = useRef<Map<string, ChannelAdapter>>(new Map())
  const taskToNodeRef = useRef<Map<string, string>>(new Map())
  const planIdRef = useRef<string | null>(null)
  const [nodeStates, setNodeStates] = useState<Map<string, RunTaskState>>(() => new Map())

  // 版本计数（§6.21「每次执行的版本号」）：nodeId → 已知最大 version。
  // 挂载时从 runRecords 表初始化；runEngine 经 nextVersion 递增；
  // 引擎之外的写入方（版本恢复）经 appendRecord 递增，保证计数与库一致。
  const versionMaxRef = useRef<Map<string, number>>(new Map())

  // —— 陈旧标记（§6.19.5）——
  // 成功基线：nodeId → { version, fingerprint }，即「version 最大且 succeeded」那条记录。
  // 用 ref 而非 state：引擎写回时要**同步**记账，不能让 React 的批处理拖后一帧。
  const liveRef = useRef<Map<string, { version: number; fingerprint: string }>>(new Map())
  /** 基线是可变 ref，用这个哑计数把变化告诉 useMemo / effect */
  const [liveTick, setLiveTick] = useState(0)
  /** 用户手动清除过的节点 → 清除那一刻的指纹；指纹再变一次，豁免自然失效、标记重现 */
  const dismissedRef = useRef<Map<string, string>>(new Map())
  const [confirmRerunAll, setConfirmRerunAll] = useState(false)

  // 挂载时读回历史：既初始化版本计数，也建立成功指纹基线（刷新后陈旧标记无需重跑即可复原）
  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = await platform.storage.query('runRecords', { projectId: store.getSnapshot().projectId })
      if (!alive) return
      const byNode = new Map<string, RunRecord[]>()
      for (const r of rows as unknown as RunRecord[]) {
        const list = byNode.get(r.nodeId)
        if (list) list.push(r)
        else byNode.set(r.nodeId, [r])
      }
      const versions = versionMaxRef.current
      const live = liveRef.current
      live.clear()
      for (const [nodeId, recs] of byNode) {
        let max = 0
        for (const r of recs) if (r.version > max) max = r.version
        versions.set(nodeId, Math.max(versions.get(nodeId) ?? 0, max))
        const fp = liveFingerprintOf(recs)
        if (fp) live.set(nodeId, { version: max, fingerprint: fp })
      }
      setLiveTick((n) => n + 1)
    })()
    return () => {
      alive = false
    }
  }, [platform, store])

  /**
   * 记下一条成功记录作为该节点的新基线。
   * 只有 succeeded 才算基线（失败 / 取消没有改变「已经产出的东西」）；
   * version 必须严格更大才覆盖（版本恢复追加更大的版本号，回退后基线随之更新）。
   */
  const noteRecord = useCallback((record: RunRecord) => {
    if (record.status !== 'succeeded') return
    const cur = liveRef.current.get(record.nodeId)
    if (cur && cur.version >= record.version) return
    liveRef.current.set(record.nodeId, { version: record.version, fingerprint: record.fingerprint })
    setLiveTick((n) => n + 1)
  }, [])

  /** 成功指纹基线：nodeId → fingerprint（无基线的节点不在表里） */
  const liveFingerprints = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const [id, v] of liveRef.current) m.set(id, v.fingerprint)
    return m
  }, [liveTick])
  // clearStale / refreshStale 走事件回调，需要读到最新基线而不重挂依赖
  const liveFingerprintsRef = useRef(liveFingerprints)
  liveFingerprintsRef.current = liveFingerprints

  /**
   * 陈旧标记对账：把「当前指纹 ≠ 成功基线」的节点标陈旧，把**能证明已回到基线**的撤掉。
   *
   * 两条纪律：
   * - **清除只认 `fresh` 集合**——「不在陈旧里」不构成清除理由，因为从未成功生成过的
   *   节点（无基线）也「不在陈旧里」。只清指纹已能被证明与基线一致的那些，
   *   才不会把导入时因「模型缺失」自带的 stale 悄悄抹掉（§6.19.5）。
   *   这比「记住本层标过谁」更稳：那份记忆一刷新就没了，而 `fresh` 每次都能重算出来。
   * - **拖动期间跳过**——拖动只改 x/y，而 x/y 不进指纹，陈旧集合不可能变；
   *   跳过省掉每帧一次 O(N) 重算（300 节点拖拽场景，架构 §1.7 性能预算）。
   */
  useEffect(() => {
    if (store.isDragging()) return
    const report = staleReport(graph, liveFingerprints)
    const toMark: string[] = []
    const toClear: string[] = []
    for (const n of graph.nodes) {
      // 用户手动清除过、且指纹未再变 → 尊重意愿，不重标（指纹一变，豁免自然失效）
      const dismissed = dismissedRef.current.get(n.id) === report.stale.get(n.id)
      const want = report.stale.has(n.id) && !dismissed
      const has = !!n.stale
      if (want && !has) toMark.push(n.id)
      else if (has && report.fresh.has(n.id)) toClear.push(n.id)
    }
    if (toMark.length > 0) store.dispatch({ kind: 'stale.mark', nodeIds: toMark })
    if (toClear.length > 0) store.dispatch({ kind: 'stale.clear', nodeIds: toClear })
  }, [graph, liveFingerprints, store])

  /**
   * 清除全图陈旧标记（§6.19.5 右键「清除陈旧标记」）。
   * 记下「被清除时的指纹」作为豁免：用户既然看着这个状态点了清除，就先别再提醒；
   * 上游再变一次 → 指纹变了 → 豁免失效，标记重新出现（陈旧与否是事实，不由用户意愿改写）。
   */
  const clearStale = useCallback(() => {
    const g = store.getSnapshot()
    const stale = g.nodes.filter((n) => n.stale)
    if (stale.length === 0) return
    const report = staleReport(g, liveFingerprintsRef.current)
    for (const n of stale) {
      const fp = report.stale.get(n.id)
      if (fp) dismissedRef.current.set(n.id, fp)
    }
    store.dispatch({ kind: 'stale.clear', nodeIds: stale.map((n) => n.id) })
    store.notify('已清除陈旧标记')
  }, [store])

  const host = useMemo(
    () => ({
      writeBack: (commands: Command[], transaction?: TransactionBoundary) => {
        for (const c of commands) {
          // 成功记录即新基线：同步记账，本帧随后的图变化会触发陈旧对账
          if (c.kind === 'node.runRecord.append') noteRecord(c.record)
          store.dispatch(c, transaction)
        }
      },
      channelResolver: (request: RunRequest): ChannelAdapter => {
        const a = adapterMapRef.current.get(request.channelId)
        if (!a) throw new Error(`[execution] 未解析到渠道适配器：${request.channelId}`)
        return a
      },
      projectId: store.getSnapshot().projectId,
      // 画布落位适配器：槽位/结果组等画布专有落位逻辑都在这里（架构 §5.5 路径 B）
      placement: createCanvasPlacement(() => store.getSnapshot().projectId),
      onTaskUpdate: (taskId: string, state: RunTaskState) => {
        const nodeId = taskToNodeRef.current.get(taskId)
        if (nodeId) setNodeStates((prev) => new Map(prev).set(nodeId, state))
      },
      onFinish: () => {
        void store.flush()
      },
      // 引擎为每个 task 各调一次（写回发生在两次调用之间），同步递增即得连续版本号
      nextVersion: (nodeId: string) => {
        const next = (versionMaxRef.current.get(nodeId) ?? 0) + 1
        versionMaxRef.current.set(nodeId, next)
        return next
      },
    }),
    [store, noteRecord],
  )

  const { startRun, cancelRun, isRunning } = useExecution<CanvasRunTask, Command>(host)

  /** 渠道预解析 + 状态注入 + 派发执行计划 + 启动运行（runNode / runBoard 共用） */
  const launch = useCallback(
    async (plan: ReturnType<typeof buildRunPlan>, originNodeId: string | undefined) => {
      // channelResolver 必须同步：预先把计划里涉及的渠道解析成适配器映射
      const map = new Map<string, ChannelAdapter>()
      const list: Channel[] = channels.getState().channels
      for (const task of plan.tasks) {
        const id = task.request.channelId
        if (map.has(id)) continue
        const ch = list.find((c) => c.id === id)
        if (!ch) continue
        const apiKey = ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null
        const cfg: ResolvedChannelConfig = {
          id: ch.id,
          protocol: ch.protocol,
          baseUrl: ch.baseUrl,
          credentialRef: ch.credentialRef,
          modelCache: ch.modelCache,
          apiKey,
        }
        map.set(id, createChannelAdapter(cfg, platform))
      }
      adapterMapRef.current = map
      taskToNodeRef.current = new Map(plan.tasks.map((t) => [t.id, t.nodeId]))
      planIdRef.current = plan.id

      setNodeStates((prev) => {
        const n = new Map(prev)
        for (const t of plan.tasks) n.set(t.nodeId, { kind: 'queued' })
        return n
      })

      // 落 tasks 表（执行计划图数据化形态，供日志与中断恢复）
      store.dispatch({
        kind: 'runPlan.execute',
        planId: plan.id,
        scope: plan.scope,
        mode: plan.mode,
        originNodeId,
      })

      await startRun(plan)

      setNodeStates((prev) => {
        const n = new Map(prev)
        for (const t of plan.tasks) n.delete(t.nodeId)
        return n
      })
      planIdRef.current = null
    },
    [store, channels, repo, platform, startRun],
  )

  const runNode = useCallback(
    async (nodeId: string, opts?: { alt?: boolean }) => {
      const graph = store.getSnapshot()
      const plan = buildRunPlan(
        'node',
        { originNodeId: nodeId },
        graph,
        opts?.alt ? 'single-alt' : 'single',
      )
      if (plan.tasks.length === 0) return
      await launch(plan, nodeId)
    },
    [store, launch],
  )

  /** 运行整个画板：取画板子图 → 拓扑重跑（rerunAll） */
  const runBoard = useCallback(
    async (boardId: string) => {
      const graph = store.getSnapshot()
      const boardNode = graph.nodes.find((n) => n.id === boardId && n.type === 'board')
      if (!boardNode) return
      const sub = boardSubgraph(graph, boardId)
      // 声明「这是容器运行」：子图里没有画板自己，plan 无从推断（§6.8：容器运行各自建结果组）
      const plan = buildRunPlan('board', { subgraph: sub, containerKind: 'board' }, graph, 'rerunAll')
      if (plan.tasks.length === 0) return
      await launch(plan, boardId)
    },
    [store, launch],
  )

  /** 整条流程重新运行（P / 右键）：触发节点 + 全部下游覆盖式重跑 */
  const rerunFrom = useCallback(
    async (nodeId: string) => {
      const graph = store.getSnapshot()
      const plan = buildRunPlan('node', { originNodeId: nodeId }, graph, 'rerun')
      if (plan.tasks.length === 0) {
        store.notify('没有可执行的节点')
        return
      }
      await launch(plan, nodeId)
    },
    [store, launch],
  )

  /**
   * 仅刷新陈旧（§6.19.1）：`Shift+R` = 触发节点下游，顶栏 = 全图。
   *
   * 陈旧集合由**指纹现算**（与渲染标记同源），而不是读 `node.stale`——
   * 标记可能被用户手动清除过，但「这条链路值得重跑」的事实并没有被改写。
   */
  const refreshStale = useCallback(
    async (nodeId?: string) => {
      const graph = store.getSnapshot()
      const staleIds = new Set(staleNodeFingerprints(graph, liveFingerprintsRef.current).keys())
      if (staleIds.size === 0) {
        store.notify('没有陈旧的节点')
        return
      }
      const plan = buildRunPlan(
        nodeId ? 'node' : 'global',
        { originNodeId: nodeId ?? null },
        graph,
        'refreshStale',
        staleIds,
      )
      if (plan.tasks.length === 0) {
        store.notify('没有陈旧的节点')
        return
      }
      await launch(plan, nodeId)
    },
    [store, launch],
  )

  /** 全图重跑（`Ctrl+Enter` / 顶栏，已过二次确认）：从源头按拓扑序跑一次全图 */
  const rerunAll = useCallback(async () => {
    const graph = store.getSnapshot()
    const plan = buildRunPlan('global', { originNodeId: null }, graph, 'rerunAll')
    if (plan.tasks.length === 0) {
      store.notify('没有可执行的节点')
      return
    }
    await launch(plan, undefined)
  }, [store, launch])

  /** 全图重跑前的二次确认（§6.19.1）；确认前不进入执行引擎 */
  const requestRerunAll = useCallback(() => setConfirmRerunAll(true), [])

  const cancel = useCallback(() => {
    if (planIdRef.current) cancelRun(planIdRef.current)
  }, [cancelRun])

  const api: CanvasExecutionApi = useMemo(
    () => ({
      runNode,
      runBoard,
      rerunFrom,
      refreshStale,
      rerunAll,
      requestRerunAll,
      clearStale,
      cancel,
      nodeStateOf: (nodeId: string) => nodeStates.get(nodeId),
      isRunning,
      appendRecord: async (record: RunRecord) => {
        const map = versionMaxRef.current
        map.set(record.nodeId, Math.max(map.get(record.nodeId) ?? 0, record.version))
        // 版本恢复也是一次新的成功产出 → 刷新陈旧基线（回退后该节点不再显示为陈旧）
        noteRecord(record)
        store.dispatch({ kind: 'node.runRecord.append', nodeId: record.nodeId, record })
        // append 走 800ms 防抖落库；版本历史 / 时间轴面板实时读库，flush 完成后再返回
        await store.flush()
      },
      completeText: async ({ channelId, model, system, text, inputs, signal }) => {
        const ch = channels.getState().channels.find((c) => c.id === channelId)
        if (!ch) throw new Error(`[promptTools] 未找到渠道：${channelId}`)
        const apiKey = ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null
        const cfg: ResolvedChannelConfig = {
          id: ch.id,
          protocol: ch.protocol,
          baseUrl: ch.baseUrl,
          credentialRef: ch.credentialRef,
          modelCache: ch.modelCache,
          apiKey,
        }
        const adapter = createChannelAdapter(cfg, platform)
        const prompt = system ? `${system}\n\n${text}` : text
        const result = await adapter.completeText(
          { kind: 'text', channelId, model, prompt, inputs: inputs ?? [], params: {} },
          signal,
        )
        return result.text
      },
    }),
    [
      runNode,
      runBoard,
      rerunFrom,
      refreshStale,
      rerunAll,
      requestRerunAll,
      clearStale,
      cancel,
      nodeStates,
      isRunning,
      store,
      channels,
      repo,
      platform,
      noteRecord,
    ],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* 执行模式快捷键（R / Alt+R / P / Shift+R / Ctrl+Enter，§6.20） */}
      <RunHotkeys />
      {/* 全图重跑二次确认（§6.19.1）：顶栏按钮与 Ctrl+Enter 都汇到这一处 */}
      <ConfirmDialog
        open={confirmRerunAll}
        title="全图重跑"
        message="将按拓扑序从源头重跑全图，覆盖各节点的当前显示结果（版本历史保留）。"
        confirmLabel="全图重跑"
        onCancel={() => setConfirmRerunAll(false)}
        onConfirm={() => {
          setConfirmRerunAll(false)
          void rerunAll()
        }}
      />
    </Ctx.Provider>
  )
}

export function useCanvasExecution(): CanvasExecutionApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('CanvasExecutionProvider 未挂载')
  return v
}
