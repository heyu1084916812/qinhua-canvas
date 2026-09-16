import type { GraphSnapshot } from '../model/graph'
import { indexNodes } from '../model/graph'
import { directDownstream } from '../graph/upstreamOf'
import { directUpstream } from '../graph/upstreamOf'
import type { GenerationData, NodeSnapshot } from '../model/node'

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
 * 源节点「已经有内容」时不能作为空槽复用。
 *
 * 旧规则只要节点没有 assetHash 就当空槽，于是「用节点自身的素材再生成」——
 * 无论那张图是上游生成的还是自己一开始生成的——都会把产物写回源节点本身：
 * 用户看到的是占位被替换，而不是右侧新建一张结果。
 *
 * 判定只看**源节点自己**：
 * - 自身已有素材（`assetHash`）→ 它是「输入 / 参考」，结果另起下游承载；
 * - 自身是空的，但有「生成节点上游 + 该上游已产出图片」→ 同理（图生图）。
 *
 * 这两条都只作用于**触发节点本身**，不会误伤普通的「上游有内容 → 下游空槽」
 * BFS 复用场景；源节点为空且上游只有提示词时，仍按空槽位规则复用本体。
 */
function mustNotReuseSource(node: NodeSnapshot, graph: GraphSnapshot): boolean {
  if ((node.data as GenerationData).assetHash) return true
  const index = indexNodes(graph.nodes)
  return directUpstream(node.id, graph.edges).some((id) => {
    const upstream = index.get(id)
    if (!upstream || upstream.type !== 'generation') return false
    return !!(upstream.data as GenerationData).assetHash
  })
}

/**
 * 单点生成的空槽位 BFS 查找（产品文档 §6.19.3）。
 * 从触发节点开始向下游 BFS，触发节点本身参与；已找到的槽位下一轮视为已占用。
 * 槽位不够时在拓扑方向铺新节点，命名「原节点名的输出N」。
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

    const currentIndex = index.get(current)
    const blockedBySourceContent =
      current === start.id && !!currentIndex && mustNotReuseSource(currentIndex, graph)
    if (!used.has(current) && currentIndex && !blockedBySourceContent && isEmptySlot(current, graph)) {
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
