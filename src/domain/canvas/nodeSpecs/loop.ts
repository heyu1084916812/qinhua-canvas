import type { LoopData, NodeSnapshot } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { InputContext, NodeSpec } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { indexNodes } from '../model/graph'
import { directUpstream } from '../graph/upstreamOf'

/**
 * 循环节点规格（产品文档 §6.22，2026-09-22）。
 *
 * **它的定位是「分发器」，不是「生产者」**：
 * - 自己不调模型、不产图（`generate` 不提供）；
 * - `collectInputs` 把**上游素材**原样转发出去，于是下游照常取输入，
 *   只是拿到的图会随轮次变化——下游**零改造**地跑 N 次。
 *
 * 轮次的展开逻辑（切片 / 取模 / 变量替换）在 `domain/canvas/loop/loopPlan`
 * （纯函数，20 项单测），本文件只负责「接进节点体系」。
 */
export const loopSpec: NodeSpec<LoopData> = {
  type: 'loop',
  label: '循环节点',
  sizing: { min: NODE_MINIMUMS.loop },
  /**
   * 有进有出：上游进来素材/提示词，下游拿走本轮那份。
   *
   * `output: true` 是必须的——下游正是通过"连到循环节点"来拿到本轮输入的。
   */
  ports: { input: true, output: true },
  /**
   * 上游可以是任何能提供素材或提示词的类型。
   *
   * 刻意**包含 loop**：支持「循环套循环」（外层按批分、内层再逐个处理）。
   * 死循环风险由 `loopPlan` 的展开次数上限（count ≤ 100）与连接层的环检测兜住。
   */
  /** `fusion` 一并接受（§6.23）：融合产物和生成产物一样是「一张图」 */
  accepts: {
    upstream: ['prompt', 'generation', 'compare', 'group', 'batch', 'loop', 'fusion'],
  },
  createDefaultData(): LoopData {
    return {
      count: 3,
      loopStart: 1,
      batch: 1,
      mode: 'serial',
      useImageInput: true,
      usePrompt: true,
      prompts: [''],
    }
  },

  /**
   * 转交上游输入（素材 + 提示词）。
   *
   * ⚠️ 这里**只转发、不做轮次切片**：切片要靠轮次上下文（第几轮），
   * 而 `collectInputs` 是"当前这一轮"被调用的——轮次由执行层在每轮的任务里
   * 通过 `params` 带进来。把切片做在这里，等于把"循环"这件事泄漏进节点规格，
   * 下游就没法零改造复用了。
   */
  collectInputs({ node, graph }: InputContext<LoopData>): NodeInput[] {
    const data = node.data as LoopData
    const index = indexNodes(graph.nodes)
    const inputs: NodeInput[] = []

    for (const id of directUpstream(node.id, graph.edges)) {
      const up = index.get(id)
      if (!up) continue
      // 上游提示词文本：让下游"连上循环就有提示词"，不必再单独连一次提示词节点
      if (data.usePrompt && up.type === 'prompt') {
        const text = (up.data as { text?: string }).text ?? ''
        if (text.trim()) inputs.push({ kind: 'text', nodeId: up.id, text })
      }
    }
    return inputs
  },
}

/** 取循环节点的上游素材节点（供执行层收集"上游素材并集"用） */
export function loopUpstreamAssetNodes(
  node: NodeSnapshot<LoopData>,
  graph: { nodes: NodeSnapshot[]; edges: { id: string; source: string; target: string }[] },
): NodeSnapshot[] {
  const index = indexNodes(graph.nodes)
  return directUpstream(node.id, graph.edges)
    .map((id) => index.get(id))
    .filter((n): n is NodeSnapshot => Boolean(n))
}
