import { useRef } from 'react'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { NodeSnapshot, PromptData } from '../../domain/canvas/model/node'
import { indexNodes } from '../../domain/canvas/model/graph'
import { indexEdgesByTarget, upstreamsFrom } from '../../domain/canvas/graph/upstreamOf'
import { upstreamImagesOf } from '../../domain/canvas/graph/resultImages'
import { resultImagesOf } from '../../domain/canvas/graph/resultImages'
import { targetPortOf } from '../../domain/canvas/model/edge'
import { promptSpec } from '../../domain/canvas/nodeSpecs/prompt'
import { portDeclsOf } from '../../domain/canvas/nodeSpecs/ports'
import { getSpec } from '../../domain/canvas/nodeSpecs/registry'
import { resolveCropContext } from '../../domain/canvas/fusion/cropContext'
import { hasRunnableDownstream } from '../../features/canvas/execution/loopRun'
import { imageAssetInputsOf } from '../../domain/shared/execution/inputs'
import type { NodeInput } from '../../domain/shared/execution/types'
import type { InputPortAsset } from './nodes/registry'

/**
 * 节点视图需要的**图级派生数据**（整图算一次、按内容 memo）。
 *
 * 这段逻辑原先长在图层里（老画布的 `画布表面`，P5 收口时随之删除；见方案 §8.11）。
 * 抽出来的原因：换引擎期间**两个表面都要喂同一批派生值**，各算一遍迟早漂移 ——
 * 现在只剩画布表面（`FlowSurface`）一个消费者，但这层"整图算一次、按内容 memo"的边界照旧成立：
 * 它让节点视图**不读图**（架构 §4.7），也让拖动帧不必重算。
 *
 * 五个派生值分别是：上游素材（对比节点要展开口径）、上游提示词数、循环/批量的可运行判定、
 * 提示词节点的图像输入、按输入口分组的素材（多端口）。
 */

/** 「内容」是否等价：端点 / id / 类型 / 父级 / `data` 一致，**刻意不含坐标**（拖动每帧都换 graph 引用） */
export function sameGraphContent(a: GraphSnapshot, b: GraphSnapshot): boolean {
  if (a === b) return true
  if (a.edges !== b.edges) return false
  if (a.nodes.length !== b.nodes.length) return false
  for (let i = 0; i < a.nodes.length; i += 1) {
    const x = a.nodes[i]
    const y = b.nodes[i]
    if (x === y) continue
    if (x.id !== y.id || x.type !== y.type || x.parentId !== y.parentId || x.data !== y.data) {
      return false
    }
  }
  return true
}

/** 按**内容**而非引用缓存派生值（理由见 `sameGraphContent`；用 ref 是为了不受 exhaustive-deps 约束） */
export function useStableGraphMemo<T>(graph: GraphSnapshot, compute: (g: GraphSnapshot) => T): T {
  const cache = useRef<{ g: GraphSnapshot; v: T } | null>(null)
  const c = cache.current
  if (!c || !sameGraphContent(c.g, graph)) {
    const v = compute(graph)
    cache.current = { g: graph, v }
    return v
  }
  return c.v
}

export interface NodeDerivedMaps {
  upstreamHashes: Map<string, string[]>
  upstreamPromptCounts: Map<string, number>
  runnableDownstream: Map<string, boolean>
  upstreamImageInputs: Map<string, NodeInput[]>
  inputPortAssets: Map<string, Record<string, InputPortAsset[]>>
}

export function useNodeDerivedMaps(graph: GraphSnapshot): NodeDerivedMaps {
  const upstreamHashes = useStableGraphMemo(graph, (g) => {
    const idx = indexNodes(g.nodes)
    const byTarget = indexEdgesByTarget(g.edges)
    const out = new Map<string, string[]>()
    for (const n of g.nodes) {
      const upstreamIds = upstreamsFrom(byTarget, n.id)
      if (upstreamIds.length === 0) continue
      const hashes = upstreamImagesOf(upstreamIds, g, n.type === 'compare', idx).map((i) => i.assetHash)
      if (hashes.length > 0) out.set(n.id, hashes)
    }
    return out
  })

  const upstreamPromptCounts = useStableGraphMemo(graph, (g) => {
    const idx = indexNodes(g.nodes)
    const byTarget = indexEdgesByTarget(g.edges)
    const out = new Map<string, number>()
    for (const n of g.nodes) {
      let c = 0
      for (const id of upstreamsFrom(byTarget, n.id)) {
        if (idx.get(id)?.type === 'prompt') c += 1
      }
      if (c > 0) out.set(n.id, c)
    }
    return out
  })

  const runnableDownstream = useStableGraphMemo(graph, (g) => {
    const out = new Map<string, boolean>()
    for (const n of g.nodes) {
      if (n.type !== 'loop' && n.type !== 'batch') continue
      out.set(n.id, hasRunnableDownstream(n, g))
    }
    return out
  })

  const upstreamImageInputs = useStableGraphMemo(graph, (g) => {
    if (!g.nodes.some((n) => n.type === 'prompt')) return new Map<string, NodeInput[]>()
    const out = new Map<string, NodeInput[]>()
    for (const n of g.nodes) {
      if (n.type !== 'prompt') continue
      const images = imageAssetInputsOf(
        promptSpec.collectInputs({ node: n as NodeSnapshot<PromptData>, graph: g }),
      )
      if (images.length > 0) out.set(n.id, images)
    }
    return out
  })

  const inputPortAssets = useStableGraphMemo(graph, (g) => {
    const out = new Map<string, Record<string, InputPortAsset[]>>()
    const idx = indexNodes(g.nodes)
    const hasContext = new Map<string, boolean>()
    const contextOf = (id: string): boolean => {
      const cached = hasContext.get(id)
      if (cached !== undefined) return cached
      const value = resolveCropContext(id, g, idx).kind === 'local'
      hasContext.set(id, value)
      return value
    }
    for (const n of g.nodes) {
      const spec = getSpec(n.type)
      if (!spec) continue
      // 共用口（both）也算输入口：融合节点右侧那只口就是 both
      const inputs = portDeclsOf(spec.ports).filter((p) => p.kind === 'input' || p.kind === 'both')
      // 单口节点：upstreamHashes 已经表达了同一件事
      if (inputs.length < 2) continue
      const byPort: Record<string, InputPortAsset[]> = {}
      for (const p of inputs) byPort[p.id] = []
      for (const e of g.edges) {
        if (e.target !== n.id) continue
        const bucket = byPort[targetPortOf(e)]
        if (!bucket) continue
        const hash = resultImagesOf(idx.get(e.source))[0]
        if (hash) bucket.push({ hash, hasContext: contextOf(e.source) })
      }
      out.set(n.id, byPort)
    }
    return out
  })

  return { upstreamHashes, upstreamPromptCounts, runnableDownstream, upstreamImageInputs, inputPortAssets }
}
