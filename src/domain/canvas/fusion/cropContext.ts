import type { CropContext, FusionContext, FusionRect, NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
import { indexEdgesByTarget } from '../graph/upstreamOf'

/**
 * 沿上游解析「这张图属于哪个局部选区」（产品文档 §6.23）。
 *
 * 这是参考实现的骨架：**上下文跟着图片走**（`local-patch` 的 `cropContext`），
 * 而不是把选区存在融合节点里。好处是中间再套几层改图也不会丢 ——
 * 「提取选区 → 生成节点改图 → 再改一轮 → 融合」这条链路里，最后那张图自己
 * 没有上下文，但它的祖先里有。
 *
 * 三条规则（都来自参考实现）：
 * 1. 碰到 **`full`（完整图边界）就停下**，那条分支不再往上走 —— 融合产物是一张
 *    新的完整图，不能继续继承上一轮的局部上下文，否则第二轮会挂到错的选区上。
 * 2. 碰到 `local` 也**不再往上走**：局部图的源就是那张原图，再往上没有更局部的东西。
 * 3. 收集到的 `local` 上下文若有**多种**（不同原图或不同矩形）⇒ `conflict`：
 *    「多个不同选区混进了同一张图」，此时**不许猜**，如实拒绝融合。
 */
export type CropResolution =
  | { kind: 'none' }
  | { kind: 'local'; context: Omit<FusionContext, 'id'> }
  | { kind: 'conflict' }

/**
 * **写**这一侧：一块刚裁出来的图该带什么上下文（用户 2026-10-17 / 对账 #553）。
 *
 * 与 `resolveCropContext`（读那一侧）成对，两边必须按同一套约定：
 *
 * - `extract` = **提取选区**：带上真正的选区（去掉 `id` —— 这是"这张图自己的属性"，
 *   不是某个融合节点里的一条记录），于是它能**融回原图**；
 * - `crop` = **裁剪**：写 **`{ full: true }`（完整图边界）**，而**不是"不写字段"**。
 *
 * ⚠️ 最后这半句是要害：字段缺席时上面那个 BFS 会**继续往上游穿**，于是
 * 「从一张局部图上再裁剪」会莫名继承上一层的选区 —— 那张裁剪图就被当成
 * "属于原图某一块"的局部图，融合时挂到不相干的位置上（还看不出来）。
 * 边界标记才会让它**当场停住**。
 *
 * 单独抽成纯函数是为了让"写什么"也能被单测钉住：`resolveCropContext` 的用例只能证明
 * "给定 full 标记时会停"，证明不了我们**真的写了**它 —— 而这两件事都会各自单独写错。
 */
export function cropContextFor(
  kind: 'extract' | 'crop',
  selection: FusionContext,
): CropContext {
  if (kind === 'crop') return { full: true }
  const { id: _drop, ...rest } = selection
  return rest
}

/** 两个上下文是不是「同一个选区」（原图 + 矩形一致） */
function sameRegion(a: Omit<FusionContext, 'id'>, b: Omit<FusionContext, 'id'>): boolean {
  const r = (x: FusionRect) => `${x.x},${x.y},${x.w},${x.h}`
  return a.source.assetHash === b.source.assetHash && r(a.rect) === r(b.rect)
}

function localOf(node: NodeSnapshot): Omit<FusionContext, 'id'> | null {
  const ctx = (node.data as { cropContext?: CropContext }).cropContext
  if (!ctx || 'full' in ctx) return null
  return ctx
}

/**
 * 从 `nodeId` 起沿上游 BFS，解析出唯一的局部上下文。
 *
 * 返回 `{ kind: 'none' }` = 这条链上没有局部上下文（普通图片 / 完整图边界之上）；
 * 调用方据此决定是报错还是退回「融合节点自己的选区」。
 */
export function resolveCropContext(
  nodeId: string,
  graph: GraphSnapshot,
  index = new Map(graph.nodes.map((n) => [n.id, n] as const)),
): CropResolution {
  const byTarget = indexEdgesByTarget(graph.edges)
  const seen = new Set<string>([nodeId])
  let frontier = [nodeId]
  let found: Omit<FusionContext, 'id'> | null = null
  let conflict = false

  while (frontier.length > 0 && !conflict) {
    const next: string[] = []
    for (const id of frontier) {
      const node = index.get(id)
      if (!node) continue
      const local = localOf(node)
      if (local) {
        // 规则 1 / 2 的落点：**这条分支到此为止**（不管它是不是第一个被找到的）
        if (!found) found = local
        else if (!sameRegion(found, local)) conflict = true
        continue
      }
      const ctx = (node.data as { cropContext?: CropContext }).cropContext
      // 完整图边界：不再往上走
      if (ctx && 'full' in ctx) continue
      for (const up of byTarget.get(id) ?? []) {
        if (seen.has(up)) continue
        seen.add(up)
        next.push(up)
      }
    }
    frontier = next
  }

  if (conflict) return { kind: 'conflict' }
  return found ? { kind: 'local', context: found } : { kind: 'none' }
}
