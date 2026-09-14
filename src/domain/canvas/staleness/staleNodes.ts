import type { GraphSnapshot } from '../model/graph'
import { getSpec } from '../nodeSpecs/registry'
import { fingerprintOf } from '../graph/fingerprint'

/**
 * 陈旧标记的计算（产品文档 §6.19.5 / 架构 §4.3）。
 *
 * 判定只有一条式子：**当前指纹 vs 最近一次成功生成的指纹**。
 * - 「当前指纹」= 节点此刻的参数 + 此刻上游产出的素材（`fingerprintOf`）；
 * - 「基线」= 该节点 version 最大且 `succeeded` 的 RunRecord 的 fingerprint
 *   （`liveFingerprintOf`），由调用方查表后传入。
 *
 * 这样一条式子同时覆盖两种失效来源，不需要分别追踪：
 * - **上游产出变了**：上游重跑成功 → 它的 assetHash 变了 → 下游指纹变 → 下游陈旧；
 * - **自己参数改了**：参数参与指纹 → 参数变 → 自己陈旧。
 *
 * 为什么「无基线」既不算陈旧也不算新鲜：从未成功生成过的节点没有可对比的基线。
 * 标成陈旧是假信号（空节点本来就要跑，不需要被提醒）；当成新鲜则会**抹掉**
 * 导入时因「模型缺失」标上的陈旧——那种陈旧不是本函数能判定的，故一律不表态。
 */
export interface StaleReport {
  /**
   * 陈旧：有基线且当前指纹 ≠ 基线。值 = 该节点**当前**指纹
   * （供「用户手动清除过陈旧」的豁免判定：指纹再变一次，豁免自然失效、标记重现）。
   */
  stale: Map<string, string>
  /**
   * 可证明已新鲜：有基线且当前指纹 = 基线。
   *
   * 单独给出来，是为了让「清除陈旧标记」有据可依——只清**能被证明已经一致**的节点。
   * 若改成「凡不在 stale 里就清」，没有基线的节点会被一并清掉，
   * 导入时模型缺失的标记就没了。
   */
  fresh: Set<string>
}

/**
 * 计算陈旧 / 新鲜两类节点。纯函数：不读时间、不碰 store、可脱离 React 单测（架构 §2.2）。
 */
export function staleReport(
  graph: GraphSnapshot,
  liveFingerprints: ReadonlyMap<string, string | null>,
): StaleReport {
  const stale = new Map<string, string>()
  const fresh = new Set<string>()
  for (const node of graph.nodes) {
    const live = liveFingerprints.get(node.id)
    if (!live) continue // 没有基线 → 不表态
    const spec = getSpec(node.type)
    if (!spec) continue
    const current = fingerprintOf(node, spec.collectInputs({ node, graph }))
    if (current === live) fresh.add(node.id)
    else stale.set(node.id, current)
  }
  return { stale, fresh }
}

/** 只要陈旧集合时的便捷包装（「仅刷新陈旧」用） */
export function staleNodeFingerprints(
  graph: GraphSnapshot,
  liveFingerprints: ReadonlyMap<string, string | null>,
): Map<string, string> {
  return staleReport(graph, liveFingerprints).stale
}
