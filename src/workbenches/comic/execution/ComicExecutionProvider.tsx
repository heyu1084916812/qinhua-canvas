import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChannelAdapter, GeneratedAsset } from '../../../platform/channels/types'
import { createChannelAdapter, type ResolvedChannelConfig } from '../../../platform/channels/registry'
import { createChannelRepository } from '../../../state/project/channelRepository'
import type { Channel } from '../../../domain/project/channel'
import type { RunRequest } from '../../../domain/shared/execution/types'
import type { RunTask } from '../../../domain/shared/execution/plan'
import { buildPanelRunPlan } from '../../../domain/comic/panel/panelRun'
import { createComicPlacement } from '../../../features/comic/execution/comicPlacement'
import { useExecution } from '../../../features/shared/execution/useExecution'
import type { ComicCommand } from '../../../state/workbenches/comic/reducer'
import type { TransactionBoundary } from '../../../state/shared/types'
import { describeError } from '../../../shared/result'
import { useComicStore } from '../storeContext'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'

/**
 * comic 执行宿主（M6-5d）。**第二个消费者**——它兑现了调研稿 §5.5 路径 B 的全部意图：
 *
 * 画布与 comic 复用**同一个** `runEngine` / `useExecution`（`features/shared/execution`），
 * 差异只有一处——注入的 `ExecutionPlacement`。本文件与 `CanvasExecutionProvider`
 * 的对照即是「引擎真解耦」的证明：
 *
 * | | 画布宿主 | comic 宿主（本文件） |
 * | --- | --- | --- |
 * | 计划来源 | `buildRunPlan`（图 / 槽位 / 集合展开） | `buildPanelRunPlan`（一格 = 一 task） |
 * | 落位适配器 | `createCanvasPlacement`（结果组 + 子节点） | `createComicPlacement`（落回本格） |
 * | 进度粒度 | nodeId → `RunTaskState` | panelId → `PanelRunState` |
 * | 素材落库 | 走 `asset.put` 命令 + store 防抖冲刷 | 直写 `assets` 表（与项目文档分离） |
 * | 版本历史 | `node.runRecord.append`（另落 runRecords 表） | `panel.runRecord.append`（M6-15，留在格内 `runs`） |
 *
 * 命令类型是 comic 的 `ComicCommand`，引擎对此一无所知。
 */
export type PanelRunState = { kind: 'running' } | { kind: 'error'; message: string }

export interface ComicExecutionApi {
  /** 生成某一格（画面 → 图）；配置不全（缺平台 / 模型 / 画面描述）时静默返回 */
  runPanel(panelId: string): Promise<void>
  cancel(): void
  /** 该格的运行态（运行中 / 报错）；空闲为 undefined */
  panelStateOf(panelId: string): PanelRunState | undefined
  isRunning: boolean
}

const Ctx = createContext<ComicExecutionApi | null>(null)

export function ComicExecutionProvider({ children }: { children: ReactNode }) {
  const store = useComicStore()
  const channels = useChannels()
  const platform = usePlatform()
  const repo = useMemo(
    () => createChannelRepository(platform.storage, platform.credentials),
    [platform.storage, platform.credentials],
  )

  const adapterMapRef = useRef<Map<string, ChannelAdapter>>(new Map())
  const planIdRef = useRef<string | null>(null)
  /** 素材字节直写的未决 Promise：`onFinish` 前统一等待，避免断言时读不到图 */
  const pendingWritesRef = useRef<Promise<void>[]>([])
  const [panelStates, setPanelStates] = useState<Map<string, PanelRunState>>(() => new Map())

  const placement = useMemo(
    () =>
      createComicPlacement({
        putAsset: (a: GeneratedAsset) => {
          // 与画布同一张 assets 表、同一 §8 约定：id 即内容哈希
          const p = platform.storage.put('assets', { ...a, id: a.hash } as never)
          pendingWritesRef.current.push(p)
        },
      }),
    [platform],
  )

  const host = useMemo(
    () => ({
      writeBack: (commands: ComicCommand[], transaction?: TransactionBoundary) => {
        for (const c of commands) store.dispatch(c, transaction)
      },
      channelResolver: (request: RunRequest): ChannelAdapter => {
        const a = adapterMapRef.current.get(request.channelId)
        if (!a) throw new Error(`[execution] 未解析到渠道适配器：${request.channelId}`)
        return a
      },
      projectId: store.getProject().id,
      placement,
      onFinish: () => {
        // 素材直写与项目文档（防抖整体写一行）分开落库：先等素材，再冲文档
        void (async () => {
          const pending = pendingWritesRef.current
          pendingWritesRef.current = []
          await Promise.all(pending)
          await store.flush()
        })()
      },
    }),
    [store, placement],
  )

  const { startRun, cancelRun, isRunning } = useExecution<RunTask, ComicCommand>(host)

  const runPanel = useCallback(
    async (panelId: string) => {
      const plan = buildPanelRunPlan(store.getProject(), panelId)
      if (!plan || plan.tasks.length === 0) return

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
      planIdRef.current = plan.id

      setPanelStates((prev) => new Map(prev).set(panelId, { kind: 'running' }))
      try {
        const summary = await startRun(plan)
        const tr = summary.taskResults.find((r) => r.nodeId === panelId)
        // 先把 error 取成 const：闭包内 TS 不再保留 `tr.state` 的属性收窄
        const failure = tr?.state.kind === 'failed' ? tr.state.error : null
        if (failure) {
          setPanelStates((prev) =>
            new Map(prev).set(panelId, { kind: 'error', message: describeError(failure) }),
          )
          return
        }
        setPanelStates((prev) => {
          const n = new Map(prev)
          n.delete(panelId)
          return n
        })
      } catch (e) {
        setPanelStates((prev) =>
          new Map(prev).set(panelId, {
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
          }),
        )
      } finally {
        planIdRef.current = null
      }
    },
    [store, channels, repo, platform, startRun],
  )

  const cancel = useCallback(() => {
    if (planIdRef.current) cancelRun(planIdRef.current)
  }, [cancelRun])

  const api: ComicExecutionApi = useMemo(
    () => ({
      runPanel,
      cancel,
      panelStateOf: (panelId: string) => panelStates.get(panelId),
      isRunning,
    }),
    [runPanel, cancel, panelStates, isRunning],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useComicExecution(): ComicExecutionApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('ComicExecutionProvider 未挂载')
  return v
}
