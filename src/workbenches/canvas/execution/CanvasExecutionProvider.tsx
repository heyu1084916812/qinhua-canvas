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
import type { RunRecord } from '../../../domain/canvas/model/runRecord'
import { useCanvasStore } from '../storeContext'
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
  const channels = useChannels()
  const platform = usePlatform()
  const repo = useMemo(
    () => createChannelRepository(platform.storage, platform.credentials),
    [platform.storage, platform.credentials],
  )

  /**
   * 并发运行各自的适配器表：planId → (channelId → adapter)。
   *
   * 不能只存一份全局 map —— 第二条链路启动时会覆盖第一条的解析结果，
   * 第一条的 `channelResolver` 就会拿到错渠道或直接抛「未解析到渠道适配器」。
   */
  const adapterMapsRef = useRef<Map<string, Map<string, ChannelAdapter>>>(new Map())
  /** 并发运行各自的 task → node 反查表；按 planId 分开，避免后发计划覆盖先发计划 */
  const taskToNodeMapsRef = useRef<Map<string, Map<string, string>>>(new Map())
  const planIdRef = useRef<string | null>(null)
  const [nodeStates, setNodeStates] = useState<Map<string, RunTaskState>>(() => new Map())

  // 版本计数（§6.21「每次执行的版本号」）：nodeId → 已知最大 version。
  // 挂载时从 runRecords 表初始化；runEngine 经 nextVersion 递增；
  // 引擎之外的写入方（版本恢复）经 appendRecord 递增，保证计数与库一致。
  const versionMaxRef = useRef<Map<string, number>>(new Map())

  // 挂载时读回历史：初始化版本计数（RunRecord 是日志面板的数据源）
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
      for (const [nodeId, recs] of byNode) {
        let max = 0
        for (const r of recs) if (r.version > max) max = r.version
        versions.set(nodeId, Math.max(versions.get(nodeId) ?? 0, max))
      }
    })()
    return () => {
      alive = false
    }
  }, [platform, store])

  const host = useMemo(
    () => ({
      writeBack: (commands: Command[], transaction?: TransactionBoundary) => {
        for (const c of commands) {
          store.dispatch(c, transaction)
        }
      },
      channelResolver: (request: RunRequest, runPlanId: string): ChannelAdapter => {
        const a = adapterMapsRef.current.get(runPlanId)?.get(request.channelId)
        if (!a) throw new Error(`[execution] 未解析到渠道适配器：${request.channelId}`)
        return a
      },
      projectId: store.getSnapshot().projectId,
      // 画布落位适配器：槽位/结果组等画布专有落位逻辑都在这里（架构 §5.5 路径 B）
      placement: createCanvasPlacement(() => store.getSnapshot().projectId),
      onTaskUpdate: (planId: string, taskId: string, state: RunTaskState) => {
        /**
         * 按 **planId 精确定位**本计划那份映射表。
         *
         * 此前不带 planId、遍历全部计划去找 taskId —— 并发或上一轮残留计划未清时，
         * 会命中**别的**计划的那一份（拿到错的 nodeId，或拿到已被删掉的旧表），
         * 于是 queued/running/succeeded 的后续更新全部写丢，
         * 表现为「图出来了但一直转圈」（2026-09-16 截图反馈）。
         */
        const m = taskToNodeMapsRef.current.get(planId)
        const nodeId = m?.get(taskId)
        if (nodeId) setNodeStates((prev) => new Map(prev).set(nodeId, state))
      },
      /**
       * 落点确定后立刻改绑：taskId 原本映射到**触发节点**，但画布可能为这次产出
       * **另建承载节点**。此后该 task 的状态一律画在承载节点上，
       * 触发节点不再显示「生成中」（用户 2026-09-16 报的那条）。
       */
      onTaskTarget: (planId: string, taskId: string, targetId: string) => {
        /**
         * 按 **planId 精确定位**本计划那份映射表。
         *
         * 此前不带 planId，只能遍历全部计划的 Map 去找这条 task —— 并发时
         * （或上一轮残留计划还没清掉时）会改到**别的**计划的那一份，
         * 本计划的没改到 → 清理时对不上 → queued/running 残留（转圈不停）。
         */
        const m = taskToNodeMapsRef.current.get(planId)
        if (m && m.has(taskId)) {
          const from = m.get(taskId)!
          m.set(taskId, targetId)
          /**
           * 状态一律**只挂在真正收产物的节点**上。
           *
           * 两种情形都要处理：
           *  - 源节点上已有状态（启动时预置的 queued）→ 搬过去并删掉旧的。
           *    只改映射表是不够的：源节点那条不删，用户看到的就是「转圈一直在
           *    原始节点上」（2026-09-16 报）——状态停在源节点，而结果跑到新节点。
           *  - 源节点上没有状态（启动时按 slot 判定没给它预置，见 launch）→ 
           *    必须在这里给承载节点补一条 queued，否则它在调用渠道前是「无状态」的，
           *    等 `onTaskUpdate` 送来 running 才突然开始转圈，开头那段是空的。
           */
          if (from !== targetId) {
            setNodeStates((prev) => {
              const next = new Map(prev)
              const st = next.get(from)
              next.set(targetId, st ?? { kind: 'queued' })
              next.delete(from)
              return next
            })
          }
        }
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
    [store],
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
      adapterMapsRef.current.set(plan.id, map)
      taskToNodeMapsRef.current.set(plan.id, new Map(plan.tasks.map((t) => [t.id, t.nodeId])))
      planIdRef.current = plan.id

      /**
       * 启动时的 `queued`：只给**落点可能仍是自己**的任务。
       *
       * 此前无条件按 `plan.tasks` 的 nodeId（全是**源节点**）置 queued：
       * 源节点已有素材时会另建承载节点，而「另建」这个决定要等引擎真正跑起来
       * （`placement.begin`）才知道——中间隔着渠道解析、令牌读取这些 await。
       * 于是源节点（已经有图、这次只是被当参考图用）会先转一圈，
       * 随后状态才被搬到新节点上，用户看到「我没让它生成，它在生成」（2026-09-17 实测，
       * MutationObserver 抓到源节点约 14ms 的 `running`，慢渠道下这个窗口会更长）。
       *
       * 计划期就能判定落点的两种情形，先画在这两个节点上：
       *  - `slot.kind === 'reuse'` 且不是批量展开的后续调用 → 落点就是它自己；
       *  - 其余（要另建承载的）由 `onTaskTarget` 在落点确定后补上（见下）。
       * 这样源节点再也不会平白进入生成态。
       */
      setNodeStates((prev) => {
        const n = new Map(prev)
        for (const t of plan.tasks) {
          if (t.slot.kind === 'reuse' && (t.seq ?? 0) === 0) n.set(t.nodeId, { kind: 'queued' })
        }
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
        /**
         * 清理本计划挂在节点上的状态。
         *
         * 必须按「实际落点」清理：落位若另建了承载节点，`onTaskTarget` 已把状态
         * 从源节点搬到新节点 —— 这里若仍按 `plan.tasks` 的 nodeId（全是源节点）
         * 清理，新节点上的 queued/running 会永远留在那里，
         * 表现为「图已经出来了、转圈还在转」（2026-09-16 截图反馈）。
         *
         * 故按本计划**触达过的全部节点**（源节点 + 承载节点）清理；
         * 并发跑同一节点时，别的 plan 仍占用的节点不能抹。
         */
        const touched = [...(taskToNodeMapsRef.current.get(plan.id)?.values() ?? [])]
        const stillRunning = new Set(
          [...taskToNodeMapsRef.current.entries()]
            .filter(([id]) => id !== plan.id)
            .flatMap(([, m]) => [...m.values()]),
        )
        for (const nid of touched) if (!stillRunning.has(nid)) n.delete(nid)
        return n
      })
      adapterMapsRef.current.delete(plan.id)
      taskToNodeMapsRef.current.delete(plan.id)
      if (planIdRef.current === plan.id) planIdRef.current = null
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

  const cancel = useCallback(() => {
    if (planIdRef.current) cancelRun(planIdRef.current)
  }, [cancelRun])

  const api: CanvasExecutionApi = useMemo(
    () => ({
      runNode,
      runBoard,
      cancel,
      nodeStateOf: (nodeId: string) => nodeStates.get(nodeId),
      isRunning,
      appendRecord: async (record: RunRecord) => {
        const map = versionMaxRef.current
        map.set(record.nodeId, Math.max(map.get(record.nodeId) ?? 0, record.version))
        store.dispatch({ kind: 'node.runRecord.append', nodeId: record.nodeId, record })
        // append 走 800ms 防抖落库；日志面板实时读库，flush 完成后再返回
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
      cancel,
      nodeStates,
      isRunning,
      store,
      channels,
      repo,
      platform,
    ],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* 执行模式快捷键（R / Alt+R / P / Shift+R / Ctrl+Enter，§6.20） */}
      <RunHotkeys />
    </Ctx.Provider>
  )
}

export function useCanvasExecution(): CanvasExecutionApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('CanvasExecutionProvider 未挂载')
  return v
}
