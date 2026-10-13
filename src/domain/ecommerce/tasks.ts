import type { EcommerceRequest } from './types'

/** 一次电商出图的整体状态 */
export type EcommerceTaskStatus = 'running' | 'done' | 'partial' | 'failed' | 'canceled'

/** 逐格结果状态（与界面上的 EcommerceResultItem.status 一一对应，canceled 归到 failed 展示） */
export type EcommerceResultStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled'

/**
 * 电商任务（对账 #399 第二期）。
 *
 * 一行 = 用户点一次「开始生成」。它记住这一批的请求参数与内部执行节点 id：
 * 结果展示读 `ecommerceResults`，画布节点只负责跑引擎与承载产物。
 */
export interface EcommerceTaskRecord {
  id: string
  projectId: string
  /** 与节点 data.ecommerceBatch 同值；把"任务行"和"内部节点"对上 */
  batchId: string
  createdAt: number
  updatedAt: number
  status: EcommerceTaskStatus
  request: EcommerceRequest
  nodeIds: string[]
  errorText?: string
}

/** 逐格结果（一行 = 这一批里的一张图） */
export interface EcommerceResultRecord {
  id: string
  taskId: string
  projectId: string
  /** 内部执行节点；节点删了结果行仍保留，只是不允许重跑 */
  nodeId: string
  position: number
  createdAt: number
  updatedAt: number
  status: EcommerceResultStatus
  assetHash?: string
  width?: number
  height?: number
  prompt?: string
  model?: string
  errorText?: string
}

/**
 * 由逐格状态推整批状态。
 *
 * `running` 优先于"部分完成"：只要还有一格没结束，这一批就还在跑。
 * 全部 cancelled 也当 cancelled（用户主动停的，不该冒充失败）。
 */
export function taskStatusOf(results: readonly Pick<EcommerceResultRecord, 'status'>[]): EcommerceTaskStatus {
  if (results.length === 0) return 'failed'
  const done = results.filter((r) => r.status === 'done').length
  const active = results.filter((r) => r.status === 'pending' || r.status === 'running').length
  const canceled = results.filter((r) => r.status === 'canceled').length
  if (active > 0) return 'running'
  if (done === results.length) return 'done'
  if (done === 0 && canceled === results.length) return 'canceled'
  if (done === 0) return 'failed'
  return 'partial'
}

/** 读取时只认合法状态，脏行回落成 failed，不让界面出现空白状态。 */
export function statusOfTask(value: unknown): EcommerceTaskStatus {
  return value === 'running' ||
    value === 'done' ||
    value === 'partial' ||
    value === 'failed' ||
    value === 'canceled'
    ? value
    : 'failed'
}

export function statusOfResult(value: unknown): EcommerceResultStatus {
  return value === 'pending' ||
    value === 'running' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'canceled'
    ? value
    : 'failed'
}
