import type { ExecutionMode, RunRequest, RunScope } from './types'

/**
 * 执行计划的**中性外壳**（架构 §5.5，M6-5 路径 B）。
 *
 * 为什么 RunPlan 在共享层：`features/shared/execution/runEngine` 与 `useExecution`
 * 要按 plan 调度与重试，而这两个模块是**跨工作台共享**的。此前 `RunPlan`
 * 住在 `features/canvas/execution/buildRunPlan.ts`，导致共享引擎反向依赖画布私有层
 * （见调研稿 §5.3）。这里只保留两个工作台都认可的最小外壳。
 *
 * 泛型 `TTask` 的意义：画布的 task 多一个 `slot`（空槽位/新下游的落位计划），
 * comic 的 task 没有这个概念。把落位意图挡在任务子类型里、由**注入的落位适配器**
 * 解读（见 `features/shared/execution/placement.ts`），引擎本体就只认中性字段。
 */
export interface RunTask {
  id: string
  /** 执行主体 id：canvas = 画布节点、comic = 分镜格 */
  nodeId: string
  request: RunRequest
  dependsOn: string[]
  /** 执行前冻结的指纹（引擎无状态，靠它写 RunRecord） */
  fingerprint: string
  /** 执行前冻结的参数快照；引擎只原样存进 RunRecord，不解读其形状 */
  params: unknown
  /**
   * 本次调用对应集合内的哪一项（§6.12 集合卡展开）；
   * 非批量场景为 null，结果溯源与缩略图高亮据此定位。
   */
  collectionItemId?: string | null
  /**
   * 同一主体内的第几次调用（从 0 起）。> 0 表示这是批量展开出来的后续调用，
   * 引擎据此决定「复用原主体」还是「另起承载」。
   */
  seq?: number
}

export interface RunPlan<TTask extends RunTask = RunTask> {
  id: string
  tasks: TTask[]
  scope: RunScope
  mode: ExecutionMode
  /**
   * Alt+R：保留旧内容，结果铺到新下游节点而非复用空槽位。
   * 这是画布工作台的入口修饰语义（§5.5 修订）；其它工作台可不设（缺省视为 false）。
   */
  newDownstream?: boolean
}
