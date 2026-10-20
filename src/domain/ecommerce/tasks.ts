import { platformLabel } from './platforms'
import { usageLabel, type EcommerceRequest } from './types'

/** 一次电商出图的整体状态 */
export type EcommerceTaskStatus = 'running' | 'done' | 'partial' | 'failed' | 'canceled'

/** 逐格结果状态（与界面上的 EcommerceResultItem.status 一一对应，canceled 归到 failed 展示） */
export type EcommerceResultStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled'

/** 电商结果卡真正展示的三种状态（取消归到失败；不存在等待态）。 */
export type EcommerceDisplayResultStatus = 'running' | 'done' | 'failed'

/** 执行宿主暴露的实时状态；这里只取 kind，避免领域层反向依赖执行层类型。 */
export type EcommerceResultLiveState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'

/**
 * 计算结果卡的状态。
 *
 * 实时状态优先于结果行和旧产物：重跑一张已有结果时，旧 hash 仍在，
 * 但界面必须先显示「生成中」，失败也要立刻盖住旧图。
 */
export function resultDisplayStatus(args: {
  stored: EcommerceResultStatus
  live?: EcommerceResultLiveState
  hasAsset: boolean
}): EcommerceDisplayResultStatus {
  const { stored, live, hasAsset } = args
  if (live === 'failed' || live === 'canceled') return 'failed'
  if (live === 'queued' || live === 'running') return 'running'
  if (stored === 'failed' || stored === 'canceled') return 'failed'
  if (stored === 'running') return 'running'
  if (live === 'succeeded' || stored === 'done' || hasAsset) return 'done'
  return 'running'
}

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
  /** AI 编辑任务来自哪一批 / 哪一张；普通生成任务为空 */
  sourceTaskId?: string
  sourceResultId?: string
  /** 原图素材 hash：结果卡「对比原图」直接用它，不回查旧任务 */
  sourceAssetHash?: string
  errorText?: string
}

/** 逐格结果（一行 = 这一批里的一张图） */
export interface EcommerceResultRecord {
  id: string
  taskId: string
  projectId: string
  /** 内部执行节点；节点删了结果行仍保留，只是不允许重跑 */
  nodeId: string
  /**
   * 用户在画布里编辑时显式生成的副本节点。
   *
   * 内部执行节点只负责跑引擎；画布里的编辑对象必须是这一份独立副本。
   * 节点被用户删掉后字段会悬空，下次点击重新复制。
   */
  canvasCopyNodeId?: string
  position: number
  createdAt: number
  updatedAt: number
  status: EcommerceResultStatus
  assetHash?: string
  /** 产物 MIME；视频任务由此决定结果区用 video 播放而不是 img。 */
  mime?: string
  /** 用户从电商工作台删除该图片时写入；结果行仍保留用于日志与历史。 */
  hiddenAt?: number
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

export function taskStatusLabel(status: EcommerceTaskStatus): string {
  return status === 'running'
    ? '生成中'
    : status === 'done'
      ? '已完成'
      : status === 'partial'
        ? '部分完成'
        : status === 'canceled'
          ? '已取消'
          : '失败'
}

/**
 * 历史批次的一行摘要（对账 #399 第二期 / #479 的任务列表 UI）。
 *
 * 只用**确定性事实**：时间 / 用途 / 平台 / 张数 / 状态，不写模型名或提示词
 * —— 那些在结果区里逐张看得到，历史行只需要让人找到“是哪一批”。
 */
export function taskSummaryOf(
  task: Pick<EcommerceTaskRecord, 'createdAt' | 'status' | 'request'>,
): string {
  const d = new Date(task.createdAt)
  const p = (n: number) => String(n).padStart(2, '0')
  const time = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  const platform = task.request.platformId ? platformLabel(task.request.platformId) : '通用'
  const label = task.request.modeLabel || usageLabel(task.request.usage)
  const unit = task.request.mediaKind === 'video' ? '条' : '张'
  return `${time} · ${label} · ${platform} · ${task.request.count} ${unit} · ${taskStatusLabel(task.status)}`
}
