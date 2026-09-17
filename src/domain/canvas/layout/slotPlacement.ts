import type { GraphSnapshot } from '../model/graph'
import { indexNodes } from '../model/graph'
import { directDownstream } from '../graph/upstreamOf'

export type SlotPlan =
  /** 复用已有的空生成节点 */
  | { kind: 'reuse'; nodeId: string }
  /** 需要新建：连在 connectFrom 的下游，命名「原节点名的输出N」 */
  | { kind: 'new'; title: string; connectFrom: string }

export interface SlotSearchOptions {
  startNodeId: string
  graph: GraphSnapshot
  count: number
  /** Alt+R：不复用空槽位，改为在拓扑方向铺新下游节点 */
  newDownstream?: boolean
}

/** 空 = 显示快照为空（产品文档 §6.19.3） */
function isEmptySlot(nodeId: string, graph: GraphSnapshot): boolean {
  const node = indexNodes(graph.nodes).get(nodeId)
  if (!node || node.type !== 'generation') return false
  const data = node.data as { assetHash?: string }
  return !data.assetHash
}

/**
 * 单点生成的空槽位 BFS 查找（产品文档 §6.19.3）。
 * 从触发节点开始向下游 BFS，触发节点本身参与；已找到的槽位下一轮视为已占用。
 * 槽位不够时在拓扑方向铺新节点，命名「原节点名的输出N」。
 *
 * 空槽的判据只有一条：该生成节点**还没有产物**（`assetHash` 为空）。
 * 触发节点自己也是候选之一，但它**一旦有素材就不再是槽位**——那正是
 * 「图生图时结果被写回输入节点」这个 bug 的根：源节点有图 = 它是输入，
 * 结果应当复用下游空槽、或另起承载节点，而不是覆盖它。
 */
export function planSlots(opts: SlotSearchOptions): SlotPlan[] {
  const { graph, startNodeId } = opts
  const count = Math.max(1, Math.floor(opts.count))
  const index = indexNodes(graph.nodes)
  const start = index.get(startNodeId)
  if (!start) return []

  const plans: SlotPlan[] = []
  const used = new Set<string>()

  if (opts.newDownstream) {
    for (let i = 0; i < count; i += 1) {
      plans.push({ kind: 'new', title: `${start.title}的输出${i + 1}`, connectFrom: start.id })
    }
    return plans
  }

  // BFS：触发节点 → 下游，逐层找空槽
  const queue: string[] = [start.id]
  const visited = new Set<string>()
  while (queue.length > 0 && plans.length < count) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)

    if (!used.has(current) && isEmptySlot(current, graph)) {
      used.add(current)
      plans.push({ kind: 'reuse', nodeId: current })
    }
    for (const next of directDownstream(current, graph.edges)) {
      if (!visited.has(next)) queue.push(next)
    }
  }

  // 不够则铺新节点，挂在最后一个被占用节点的下游（无占用则挂在触发节点下游）
  const anchor = plans.length > 0 ? start.id : start.id
  let remaining = count - plans.length
  let seq = 1
  while (remaining > 0) {
    plans.push({ kind: 'new', title: `${start.title}的输出${seq}`, connectFrom: anchor })
    seq += 1
    remaining -= 1
  }

  return plans
}
