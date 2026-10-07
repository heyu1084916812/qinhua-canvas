import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Edge } from '../../../domain/canvas/model/edge'
import { indexNodes } from '../../../domain/canvas/model/graph'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { portDeclOf } from '../../../domain/canvas/nodeSpecs/ports'
import { portAnchorWorld } from '../../../features/canvas/useEdgeDrag'

export interface ChildEdgePath {
  id: string
  /** SVG path（**屏幕坐标**，与 `FlowDraftLayer` 同一套换算） */
  d: string
  /** 两端里有被选中的节点（与 RF 边的 `related` 高亮同一条判据） */
  related: boolean
}

/**
 * **牵涉容器子节点的边**——RF 画不了它们，得由覆盖层补画。
 *
 * 为什么 RF 画不了：React Flow 的边按 `source / target` 找**它自己的节点**，
 * 而容器子节点不是 RF 节点（由容器网格渲染，见 `FlowNode` 的长注释）⇒ 这类边在 RF 里
 * 找不到端点，会**静默消失**。
 *
 * 为什么现在才有这类边：打组改口径（用户 2026-10-06 第 13 批第 5 条）之前，
 * 规则 4 禁止"容器内节点与外部连线"；现在组的右端点拉出来就是
 * **组内成员各连一条到目标**，于是这类边必须画得出来。
 *
 * 端点取**各自端口的世界锚点**（`portAnchorWorld`）：子节点的坐标是相对父容器的，
 * 走 `toWorldRectInGraph` 换算（与跟随栏 / 落点判定同一条口径）。
 */
/**
 * 这条边是否牵涉**容器子节点**（任一端是容器子节点）。
 *
 * 是 ⇒ RF 画不了（见 `childEdgePaths` 的说明），必须从 RF 的边列表里**摘出去**、
 * 交给 `FlowChildEdgeLayer` 画；否则它在 RF 里会静默消失，而数据里其实有这条边
 * （"图里连上了、屏幕上什么都没有"）。
 */
export function isChildEdge(
  graph: GraphSnapshot,
  e: { source: string; target: string },
): boolean {
  const index = indexNodes(graph.nodes)
  const child = (id: string) => !!index.get(id)?.parentId
  return child(e.source) || child(e.target)
}

export function childEdgePaths(
  graph: GraphSnapshot,
  viewport: { x: number; y: number; zoom: number },
  selection: readonly string[],
): ChildEdgePath[] {
  const index = indexNodes(graph.nodes)
  const zoom = viewport.zoom || 1
  const out: ChildEdgePath[] = []

  for (const e of graph.edges as readonly Edge[]) {
    if (!isChildEdge(graph, e)) continue
    const src = index.get(e.source)
    const tgt = index.get(e.target)
    if (!src || !tgt) continue

    const srcDecl = portDeclOf(getSpec(src.type)?.ports ?? { input: false, output: false }, e.sourcePort ?? 'output')
    const tgtDecl = portDeclOf(getSpec(tgt.type)?.ports ?? { input: false, output: false }, e.targetPort ?? 'input')
    if (!srcDecl || !tgtDecl) continue

    /**
     * 锚点一律在**节点边缘**上（第 15 批澄清：线从节点边缘起步，端点只是动效点）——
     * 所以这里不再按"顶层 / 容器子节点"分流。
     */
    const from = portAnchorWorld(toWorldRectInGraph(src, graph), srcDecl)
    const to = portAnchorWorld(toWorldRectInGraph(tgt, graph), tgtDecl)
    const a = { x: (from.x - viewport.x) * zoom, y: (from.y - viewport.y) * zoom }
    const b = { x: (to.x - viewport.x) * zoom, y: (to.y - viewport.y) * zoom }
    /** 曲线形状与 `FlowDraftLayer.draftPath` / `FlowEdge` 同一套：两端横向延展 */
    const dx = Math.max(40 * zoom, Math.abs(b.x - a.x) / 2)
    out.push({
      id: e.id,
      d: `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`,
      related: selection.includes(e.source) || selection.includes(e.target),
    })
  }
  return out
}
