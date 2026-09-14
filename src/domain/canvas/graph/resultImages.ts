import type { GraphSnapshot } from '../model/graph'
import type { GenerationData, NodeSnapshot } from '../model/node'
import { indexNodes } from '../model/graph'

/**
 * 一个节点「对外可见的结果图」hash 列表（按产出顺序，去重）。
 *
 * 为什么必须有它：一次「跑 4 张」的产物**不在生成节点自己身上**——
 * `CanvasPlacement.finalize` 把 N 张结果建成结果组内的 N 个标准图片节点
 * （`parentId` 指向结果组），生成节点自身只回写第 1 张。
 * 于是「只按 `node.data.assetHash` 读上游」的下游，永远只看得到 1 张图，
 * 「批量出图（×4）→ 对比节点」这条文档主流程就会**连上了却只有 A 没有 B**。
 *
 * 规则：
 * - 有结果组时以组内容为准（组内已含第 1 张，故不再另拼自身 hash）
 * - 同一来源跑过多次留下多个组时取**最新**的一组（`createdAt` 最大）
 * - 没有结果组（未跑过，或单点直接写回）时退化为自身 `assetHash`
 * - 顺序以 `childIds` 为准（派生索引，与产出顺序一致）
 */
export function resultImagesOf(node: NodeSnapshot | undefined, graph: GraphSnapshot): string[] {
  if (!node) return []
  const index = indexNodes(graph.nodes)
  const group = latestResultGroupOf(node.id, graph)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (hash: string | undefined | null): void => {
    if (!hash || seen.has(hash)) return
    seen.add(hash)
    out.push(hash)
  }

  if (group) {
    for (const childId of group.childIds) {
      const child = index.get(childId)
      if (!child) continue
      push((child.data as Partial<GenerationData>).assetHash)
    }
  }
  push((node.data as Partial<GenerationData>).assetHash)
  return out
}

/** 某来源节点最新的一批结果组（无则 null） */
export function latestResultGroupOf(nodeId: string, graph: GraphSnapshot) {
  let best = null as (typeof graph.resultGroups)[number] | null
  for (const rg of graph.resultGroups) {
    if (rg.sourceNodeId !== nodeId) continue
    if (!best || rg.createdAt >= best.createdAt) best = rg
  }
  return best
}

/** 一张上游图片 + 它来自哪个上游节点（溯源用，不能一律记成下游自己） */
export interface UpstreamImage {
  nodeId: string
  assetHash: string
}

/**
 * 下游视角的「上游图片清单」。
 *
 * 与 `resultImagesOf` 的差别只在**展开开关**：只有声明要吃全部产物的节点类型
 * （当前仅对比节点，§6.10「取前 2 张」）才展开结果组；生成节点仍按「每个上游
 * 节点 1 张」收集，否则会出现「面板显示 4 张、实际只发 1 张」的口径割裂。
 *
 * 返回对儿而不是裸 hash：输入项要带来源 nodeId，写成下游自己会让溯源失效。
 */
export function upstreamImagesOf(
  upstreamIds: readonly string[],
  graph: GraphSnapshot,
  expandResults: boolean,
): UpstreamImage[] {
  const index = indexNodes(graph.nodes)
  const out: UpstreamImage[] = []
  const seen = new Set<string>()
  for (const id of upstreamIds) {
    const up = index.get(id)
    if (!up) continue
    const hashes = expandResults ? resultImagesOf(up, graph) : [(up.data as Partial<GenerationData>).assetHash]
    for (const h of hashes) {
      if (!h || seen.has(h)) continue
      seen.add(h)
      out.push({ nodeId: up.id, assetHash: h })
    }
  }
  return out
}
