import type { GraphSnapshot } from '../model/graph'
import type { GenerationData, NodeSnapshot } from '../model/node'
import { indexNodes } from '../model/graph'

/**
 * 一个节点「对外可见的结果图」hash 列表。
 *
 * 结果组下线后，产物**一定在节点自己身上**（每次调用落一个承载节点），
 * 于是这个函数退化成「读 `data.assetHash`」——但它仍保留为一个命名函数：
 * 「什么算一个节点的结果图」是一个规则，不该散落成一处处 `data.assetHash` 直读。
 */
export function resultImagesOf(node: NodeSnapshot | undefined): string[] {
  if (!node) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (hash: string | undefined | null): void => {
    if (!hash || seen.has(hash)) return
    seen.add(hash)
    out.push(hash)
  }
  push((node.data as Partial<GenerationData>).assetHash)
  return out
}

/** 一张上游图片 + 它来自哪个上游节点（溯源用，不能一律记成下游自己） */
export interface UpstreamImage {
  nodeId: string
  assetHash: string
}

/**
 * 下游视角的「上游图片清单」。
 *
 * `expandResults` 是**历史遗留参数**：结果组在世时，它决定要不要把「一组 N 张」
 * 摊开喂给下游（对比节点要全部，生成节点只吃 1 张）。组删掉后两种取值的结果
 * 已经相同——都退化为「每个上游节点 1 张」。
 * 参数暂时保留（调用方与单测都在传），等确认没有别的容器语义要展开时再移除；
 * 在此之前它至少不该被读成「还能展开组」。
 *
 * 返回对儿而不是裸 hash：输入项要带来源 nodeId，写成下游自己会让溯源失效。
 */
export function upstreamImagesOf(
  upstreamIds: readonly string[],
  graph: GraphSnapshot,
  _expandResults: boolean,
  index = indexNodes(graph.nodes),
): UpstreamImage[] {
  const out: UpstreamImage[] = []
  const seen = new Set<string>()
  for (const id of upstreamIds) {
    const up = index.get(id)
    if (!up) continue
    const hashes = resultImagesOf(up)
    for (const h of hashes) {
      if (!h || seen.has(h)) continue
      seen.add(h)
      out.push({ nodeId: up.id, assetHash: h })
    }
  }
  return out
}
