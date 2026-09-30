import type { GenerationData, PromptData } from '../model/node'
import { GENERATION_ASSET_MIME } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { InputContext, NodeSpec } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { indexNodes } from '../model/graph'
import { directUpstream } from '../graph/upstreamOf'

/**
 * 提示词节点规格（M0 只落结构与默认数据，不接生成）。
 * generate 留空：LLM 改写需要渠道与模型来源，属于 M2 生成链路的范围。
 */
export const promptSpec: NodeSpec<PromptData> = {
  type: 'prompt',
  label: '提示词',
  sizing: { min: NODE_MINIMUMS.prompt },
  ports: { input: true, output: true },
  /**
   * §6.7「上游可连接图片 / 视频节点与提示词节点」。
   *
   * 此前是 `upstream: []`——提示词节点**一条上游都连不进来**，与文档直接冲突。
   * 放开后上游图片 / 视频会进面板第一部分（缩略图）、上游提示词会出「已链接」胶囊。
   */
  /** `fusion` 一并接受（§6.23）：融合产物同样能作为「反推」的图片素材 */
  accepts: { upstream: ['prompt', 'generation', 'fusion'] },
  createDefaultData(): PromptData {
    return { text: '', upstreamPromptLinked: false, channelId: '', model: '' }
  },

  /**
   * 本节点文本 + **上游图片素材**（§6.7「反推提示词」）。
   *
   * 早先这里只产出本节点文本，于是上游那张图**仅作可见素材**：连线画出来了、
   * 面板缩略图也显示了，但请求里永远只有文字——用户会以为「连上线就生效了」。
   * 这与 M6-12 修掉的生成节点 `inputs` 是同一类「假接通」，只是换到了文本侧。
   *
   * 素材项只对 **generation 上游**产出：提示词上游没有图可喂。
   * 取到了图，渠道侧（openai-chat）才会把它编码成多模态消息真正发出去。
   */
  collectInputs({ node, graph }: InputContext<PromptData>): NodeInput[] {
    const index = indexNodes(graph.nodes)
    const inputs: NodeInput[] = [{ kind: 'text', nodeId: node.id, text: node.data.text }]
    for (const id of directUpstream(node.id, graph.edges)) {
      const upstream = index.get(id)
      if (!upstream || upstream.type !== 'generation') continue
      const hash = (upstream.data as GenerationData).assetHash
      if (hash) {
        inputs.push({ kind: 'asset', nodeId: upstream.id, assetHash: hash, mime: GENERATION_ASSET_MIME })
      }
    }
    return inputs
  },
}
