import type { BatchData, GenerationData, PromptData, NodeSnapshot } from '../model/node'
import { GENERATION_ASSET_MIME } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { InputContext, NodeSpec, RunContext, RunRequest } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { directUpstream } from '../graph/upstreamOf'
import { indexNodes } from '../model/graph'
import { batchItemsOf } from './batch'
import { generationParams } from './params'

/**
 * 生成节点规格。
 *
 * M0-11 补齐 `collectInputs` 与 `toRunRequest`：把「上游提示词 → 本节点请求」这段
 * 链路放进规格，执行引擎因此不需要认识任何具体节点类型（架构 §4.5 / §5.5）。
 */
export const generationSpec: NodeSpec<GenerationData> = {
  type: 'generation',
  label: '生成',
  sizing: { min: NODE_MINIMUMS.generation },
  ports: { input: true, output: true },
  // M1 模板「图生视频」需要 图片生成 → 视频生成 的连线；故 generation 也接受 generation 上游。
  // 仅扩展 accepts，不引入新节点类型；执行期多模态输入（图→视频）的收集属 M2 范围。
  // M3-3：接受 batch 上游（§6.12「作为上游：集合卡」）——下游遍历集合内每项各生成一次。
  accepts: { upstream: ['prompt', 'generation', 'batch'] },
  createDefaultData(): GenerationData {
    return {
      mode: 'image',
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: '',
      model: '',
      thumbOrder: [],
      upstreamHidden: [],
    }
  },

  /** 上游提示词节点的文本；被「隐藏上游」勾选的不参与 */
  collectInputs({ node, graph }: InputContext<GenerationData>): NodeInput[] {
    const index = indexNodes(graph.nodes)
    const hidden = new Set(node.data.upstreamHidden ?? [])
    const inputs: NodeInput[] = []
    for (const id of directUpstream(node.id, graph.edges)) {
      if (hidden.has(id)) continue
      const upstream = index.get(id)
      if (!upstream) continue
      // 批量节点作为上游 → 集合卡（§6.12）：下游遍历集合内每项各生成一次，
      // 因此这里包成一个 collection 项，展开发生在执行计划阶段（domain/execution）。
      if (upstream.type === 'batch') {
        const items = batchItemsOf(upstream as NodeSnapshot<BatchData>, graph)
        if (items.length > 0) inputs.push({ kind: 'collection', nodeId: upstream.id, items })
        continue
      }
      if (upstream.type === 'prompt') {
        inputs.push({ kind: 'text', nodeId: upstream.id, text: (upstream.data as PromptData).text })
        continue
      }
      // 生成节点作为上游 → 它的产物就是本次的**图像输入**（M6-12：图生图 / 图生视频）。
      // `accepts.upstream` 早就含 'generation'，但此前只连了线、没收进 inputs，
      // 于是渠道拿到的永远只有提示词——图生图在数据模型里「接好了」却从未生效。
      // 这里补上后，上游重生成会改变 assetHash → 下游指纹随之变化 → 自动判定陈旧。
      const hash = (upstream.data as GenerationData).assetHash
      if (hash) {
        inputs.push({ kind: 'asset', nodeId: upstream.id, assetHash: hash, mime: GENERATION_ASSET_MIME })
      }
    }
    return inputs
  },

  /** 渠道或模型未配置时返回 null——由 buildRunPlan 过滤掉，不进执行计划 */
  toRunRequest({ node, inputs }: RunContext<GenerationData>): RunRequest | null {
    const data = node.data
    if (!data.channelId || !data.model) return null

    const upstreamText = inputs
      .filter((i): i is Extract<NodeInput, { kind: 'text' }> => i.kind === 'text')
      .map((i) => i.text)
      .join('\n')
    const prompt = data.prompt.trim() || upstreamText.trim()
    if (!prompt) return null

    return {
      kind: data.mode,
      channelId: data.channelId,
      model: data.model,
      prompt,
      inputs,
      params: generationParams(data),
    }
  },
}
