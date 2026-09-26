import type { NodeInput, RunStatus } from './types'

/**
 * RunRecord = 一次完整生成记录（产品文档 §6.21 / 架构 §4.1）。
 * 从不删除。执行主体的当前生效 LiveFingerprint = 该主体 version 最大且 succeeded 那条的 fingerprint。
 *
 * `TParams` 是**该工作台的参数快照类型**：canvas 传 `GenerationData | PromptData | ...`（即 `NodeData`）、
 * comic 传分镜格生成参数。引擎只把 `params` 原样存进记录，从不解读它，因此可以完全泛型化——
 * 这样共享 domain 不必知道任何工作台的参数形状（M6-5 路径 B）。
 */
export interface RunRecord<TParams = unknown> {
  id: string
  /** 执行主体 id：canvas = 画布节点、comic = 分镜格（中性称呼，见 types.ts 命名说明） */
  nodeId: string
  projectId: string
  version: number
  createdAt: number
  status: RunStatus
  inputs: NodeInput[]
  params: TParams
  outputHashes: string[]
  fingerprint: string
  taskId: string
  durationMs: number
  cost?: number
  /**
   * 本次**实际发往**的渠道 id（M7-3）。
   *
   * 为什么单独记：`params` 里的渠道/模型是**节点上的意图**（逻辑名），
   * 而选路后真正发请求的可能是另一条渠道、模型也换成了该站的上游 ID。
   * 只留意图会让日志永远显示逻辑名 —— 用户据此排查，会去查一个
   * 根本没被请求过的名字。
   */
  sentChannelId?: string
  /** 本次**实际发出**的模型 ID（该渠道映射后的上游 ID），与 `sentChannelId` 成对 */
  sentModel?: string
  /**
   * 本次向渠道**请求**的像素（§6.18 日志面板「请求1024x1024」）。
   * 由渠道层翻译比例后回填（`GeneratedAsset.requestedWidth/Height`）；
   * 渠道没报（比例不在协议表内 / 视频）则缺，**不猜、不拿实际像素顶替**。
   */
  requestedWidth?: number
  requestedHeight?: number
  /**
   * 渠道**实际返回**的产物像素（§6.18「实际1024x1024」），取自产物字节的文件头。
   * 与 `requested*` 刻意分成两组：合成一组时「请求 = 实际」恒成立，
   * 日志里两个数永远相等——那是把缺口「看起来填上了」，不是填上了。
   */
  outputWidth?: number
  outputHeight?: number
}

export function createRunRecord<TParams>(args: {
  id: string
  nodeId: string
  projectId: string
  version: number
  createdAt: number
  status: RunStatus
  inputs: NodeInput[]
  params: TParams
  outputHashes: string[]
  fingerprint: string
  taskId: string
  durationMs: number
  cost?: number
  sentChannelId?: string
  sentModel?: string
  requestedWidth?: number
  requestedHeight?: number
  outputWidth?: number
  outputHeight?: number
}): RunRecord<TParams> {
  return { ...args }
}

/**
 * 日志面板的「请求 / 实际」像素文案（§6.18）。
 *
 * 两者都齐全才各自成段；缺一侧就只出有的那一侧，全缺返回 `null`——
 * 「未知」必须呈现为「不显示」，不能显示成 `0x0` 或拿另一侧顶替。
 */
export function pixelSummaryOf(record: {
  requestedWidth?: number
  requestedHeight?: number
  outputWidth?: number
  outputHeight?: number
}): string | null {
  const requested =
    record.requestedWidth && record.requestedHeight
      ? `请求${record.requestedWidth}x${record.requestedHeight}`
      : null
  const actual =
    record.outputWidth && record.outputHeight ? `实际${record.outputWidth}x${record.outputHeight}` : null
  const parts = [requested, actual].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join('  ') : null
}

/** LiveFingerprint：version 最大且 succeeded 的那条（架构 §4.1） */
export function liveFingerprintOf<TParams>(records: readonly RunRecord<TParams>[]): string | null {
  let best: RunRecord<TParams> | null = null
  for (const r of records) {
    if (r.status !== 'succeeded') continue
    if (!best || r.version > best.version) best = r
  }
  return best ? best.fingerprint : null
}

export function nextVersion<TParams>(records: readonly RunRecord<TParams>[]): number {
  let max = 0
  for (const r of records) if (r.version > max) max = r.version
  return max + 1
}

/**
 * 输入源摘要（§6.21 版本历史每行「输入源」）：文本×n · 图×n · 集合×n(共k项)。
 * 集合卡（批量上游）只计卡数并附内部项总数；空输入返回「无输入」。
 */
export function inputsSummaryOf(inputs: readonly NodeInput[]): string {
  let text = 0
  let asset = 0
  let collection = 0
  let collectionItems = 0
  for (const input of inputs) {
    if (input.kind === 'text') text++
    else if (input.kind === 'asset') asset++
    else {
      collection++
      collectionItems += input.items.length
    }
  }
  const parts: string[] = []
  if (text > 0) parts.push(`文本×${text}`)
  if (asset > 0) parts.push(`图×${asset}`)
  if (collection > 0) parts.push(`集合×${collection}(共${collectionItems}项)`)
  return parts.length > 0 ? parts.join(' · ') : '无输入'
}

/**
 * 版本历史 / 时间轴共用的过滤（§6.21「按节点 / 时间 / 状态过滤」）。
 * nodeId / status 传 null 表示不过滤；结果按 createdAt 倒序（新在前）。
 */
export function filterRunRecords<TParams>(
  records: readonly RunRecord<TParams>[],
  filter: { nodeId?: string | null; status?: RunStatus | null },
): RunRecord<TParams>[] {
  return records
    .filter(
      (r) =>
        (filter.nodeId == null || r.nodeId === filter.nodeId) &&
        (filter.status == null || r.status === filter.status),
    )
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
}
