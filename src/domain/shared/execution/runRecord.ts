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
}): RunRecord<TParams> {
  return { ...args }
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
