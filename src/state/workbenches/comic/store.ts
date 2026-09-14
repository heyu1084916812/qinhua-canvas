import { createStore as createVanilla } from 'zustand/vanilla'
import type { AppStore, CommandResult, TransactionBoundary } from '../../shared/types'
import type { PlatformKit } from '../../../platform/ports'
import type { ComicProject } from '../../../domain/comic/model/comicProject'
import { emptyComicProject } from '../../../domain/comic/model/comicProject'
import { reduceComic, type ComicCommand } from './reducer'

/** 命令联合定义在 reducer（纯函数与命令集一体），此处转出保持原引用路径可用 */
export type { ComicCommand }

/**
 * zustand 5 的 createStore 类型与本项目装好的 TypeScript 泛型推断冲突
 * （与 state/workbenches/canvas/store.ts 同源的 workaround）。
 */
type MiniStore<T> = {
  getState: () => T
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}
type StoreFactory = <T>(init: () => T) => MiniStore<T>
const createVanillaStore = createVanilla as unknown as StoreFactory

export interface ComicStoreOptions {
  platform: PlatformKit
  projectId: string
  initial?: ComicProject
  title?: string
  /** 持久化防抖窗口（默认 800ms，与画布同节奏） */
  debounceMs?: number
}

interface ComicState {
  project: ComicProject
}

export interface ComicStore extends AppStore<ComicProject, ComicCommand> {
  getProject(): ComicProject
  /** 从持久化读回后整体替换（非用户操作：不进撤销栈、**不回写**） */
  hydrate(project: ComicProject): void
  /** 立即冲刷防抖中的持久化（页面卸载 / 离开前台时调用） */
  flush(): Promise<void>
  dispose(): void
}

/**
 * comic 私有持久化器（M6-0）。
 *
 * comic 的数据是**单个聚合对象**（ComicProject），没有 patches 模型，
 * 因此不复用画布基于 `PersistPlan` 的机制——那是为图的多表 patch 流设计的。
 * 这里做的是「防抖 + 整体覆盖写一行」：连续操作（如连点新建多话）合并为一次写库。
 *
 * 落库到 `comics` 表，主键 = projectId（一行一个项目）。
 */
function createProjectPersister(platform: PlatformKit, debounceMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: ComicProject | null = null

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const project = pending
    pending = null
    if (!project) return
    await platform.storage.transaction(['comics'], async () => {
      await platform.storage.put('comics', project as never)
    })
  }

  const schedule = (project: ComicProject): void => {
    pending = project
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), debounceMs)
  }

  return { schedule, flush }
}

/**
 * comic 工作台工厂（架构 §5.10 store 工厂化）。
 * 共享切片（渠道 / 日志 / 任务）由 Provider 注入，本工厂只建私有切片。
 */
export function createComicStore(opts: ComicStoreOptions): ComicStore {
  const initial: ComicProject = opts.initial ?? emptyComicProject(opts.projectId, opts.title)
  const persister = createProjectPersister(opts.platform, opts.debounceMs ?? 800)

  const store = createVanillaStore<ComicState>(() => ({ project: initial }))

  function dispatch(cmd: ComicCommand, _txOverride?: TransactionBoundary): CommandResult {
    // 规则全在纯 reducer 里（可脱离 store 单测）；store 只负责「替换快照 + 排持久化」
    const prev = store.getState().project
    const next = reduceComic(cmd, prev)
    if (next !== prev) {
      store.setState({ project: next })
      // 防抖落库（zustand setState 是同步的，这里能立刻读到新 project）
      persister.schedule(next)
    }
    // 撤销栈留待 comic 命令集稳定后再落地；persist 走私有持久化器而非补丁计划
    return {
      patches: [],
      inverse: [],
      transaction: { mode: 'standalone', label: cmd.kind },
      persist: { tables: [], upserts: [], deletes: [] },
    }
  }

  return {
    workbench: 'comic',
    getSnapshot: () => store.getState().project,
    dispatch,
    undo: () => {},
    redo: () => {},
    canUndo: () => false,
    canRedo: () => false,
    subscribe: (listener) => store.subscribe(listener),
    getProject: () => store.getState().project,
    // 读回是 hydrate，不是用户操作：直接替换，且**不进持久化队列**（否则读回即回写）
    hydrate: (project) => store.setState({ project }),
    flush: () => persister.flush(),
    dispose: () => void persister.flush(),
  }
}
