import type { Patch, PersistPlan } from '../../domain/patch/types'
import type { WorkbenchId } from '../../domain/shared/workbench'

export type { Patch, PersistPlan }

/** 事务边界（架构 §4.3） */
export type TransactionBoundary =
  | { mode: 'standalone'; label: string } // 立即成事务
  | { mode: 'coalesce'; groupId: string; label: string } // 与同 groupId 合并（拖动 / 缩放）
  | { mode: 'silent' } // 瞬态，不进撤销栈（拖线预览、陈旧标记等）
  | { mode: 'multi-step'; planId: string; label: string } // 多步事务：拓扑生成期间合并为 1 个撤销单元

export interface CommandResult {
  patches: Patch[] // 正向补丁，用于渲染
  inverse: Patch[] // 逆向补丁，用于撤销
  transaction: TransactionBoundary
  persist: PersistPlan // { tables, upserts, deletes }
}

/** 通用切片形态（zustand slice 的 state 部分） */
export interface Slice {
  [key: string]: unknown
}

/**
 * 工作台 store 契约（架构 §4.3 / §5.10）。
 *
 * 快照与命令类型是**各工作台私有**的：跨工作台不共用命令联合，
 * 每个工作台的命令类型只存在于它自己的页面注册 / 分派点，不是全局联合。
 * 因此这里用两个泛型参数，且**不给默认值**——共享层不得引用任何工作台的
 * 快照 / 命令类型（M6-1 收口：原默认值取自 canvas 的 GraphSnapshot / Command，
 * 那使共享层反向依赖了画布私有层）。各工作台在自己的 store 里显式传入。
 */
export interface AppStore<TSnapshot, TCommand> {
  readonly workbench: WorkbenchId
  /** 只读快照：来自本工作台私有切片 */
  getSnapshot(): TSnapshot
  /** 变更入口；txOverride 用于执行引擎指定多步事务边界 */
  dispatch(cmd: TCommand, txOverride?: TransactionBoundary): CommandResult
  /** 每工作台独立栈 */
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  /** 视图快照订阅（用于响应式渲染） */
  subscribe(listener: () => void): () => void
}
