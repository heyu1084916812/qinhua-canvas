import type { CompareData } from '../model/node'
import type { InputContext, NodeSpec } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import type { NodeInput } from '../model/runRecord'
import { directUpstream } from '../graph/upstreamOf'
import { upstreamImagesOf } from '../graph/resultImages'

/**
 * 对比节点规格（产品文档 §6.10）。
 * 输入上游图片，取前 2 张做 A/B 对比；不发起模型调用（不可生成），
 * 因此只实现 collectInputs，generate / toRunRequest 留空。
 */
export const compareSpec: NodeSpec<CompareData> = {
  type: 'compare',
  label: '对比',
  sizing: { min: NODE_MINIMUMS.compare, lockAspect: true },
  ports: { input: true, output: true },
  // 接受来自生成节点 / 其他对比节点的图片（分组、批量在 M3 后续补 accepts）
  /** `fusion` 一并接受（§6.23）：融合前后的图正好适合 A/B 对比 */
  accepts: { upstream: ['generation', 'compare', 'fusion'] },
  createDefaultData(): CompareData {
    return { splitRatio: 0.5 }
  },

  /**
   * 收集上游前 2 张图片素材用于对比（§6.10「取前 2 张，超过则弱提示」）。
   *
   * 关键：`expandResults = true` —— 上游「跑 4 张」的产物在结果组里，
   * 只按 `node.data.assetHash` 读会永远只有第 1 张（批量出图 → 对比
   * 就成了「只有 A 没有 B」的假链路）。展开结果组后取前 2 张，
   * 与「多个上游各 1 张」的旧行为并存，不会互相顶掉。
   */
  collectInputs({ node, graph }: InputContext<CompareData>): NodeInput[] {
    const images = upstreamImagesOf(directUpstream(node.id, graph.edges), graph, true)
    return images.slice(0, 2).map((img) => ({
      kind: 'asset',
      nodeId: img.nodeId,
      assetHash: img.assetHash,
      mime: 'image/png',
    }))
  },
}
