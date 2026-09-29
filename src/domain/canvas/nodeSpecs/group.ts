import type { GenerationData, GroupData, NodeSnapshot, PromptData } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { InputContext, NodeSpec, RunContext, RunRequest } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { indexNodes, isDescendantOf } from '../model/graph'
import { directUpstream } from '../graph/upstreamOf'
import { generationParams } from './params'

/**
 * 分组节点规格（产品文档 §6.11）。
 *
 * 分组「相当于一个生成节点」：把内部收纳的素材与提示词打包，作为一次请求的输入。
 * 因此它既实现生成侧（collectInputs / toRunRequest），又声明容器侧
 * （accepts.children / parent），让 canReparent 能校验拖入拖出。
 */
export const groupSpec: NodeSpec<GroupData> = {
  type: 'group',
  label: '分组',
  sizing: { min: NODE_MINIMUMS.group, lockAspect: true },
  ports: { input: true, output: true },
  accepts: {
    // 上游与内部收纳物一致：图片 / 视频生成结果 + 提示词（§6.11 表）
    /** `loop` 一并接受（§6.22）：分组也能吃循环分发的输入 */
    /** `fusion` 一并接受（§6.23）：融合产物和生成产物一样是「一张图」 */
    upstream: ['prompt', 'generation', 'loop', 'fusion'],
    children: ['prompt', 'generation'],
    // 容器可拖入画板（§6.12「可拖入画板：是」）；不嵌套容器，保持单层收纳
    parent: ['board'],
  },
  createDefaultData(): GroupData {
    return {
      mode: 'image',
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: '',
      model: '',
      thumbOrder: [],
      upstreamHidden: [],
      childIds: [],
      hiddenIds: [],
      hiddenPromptIds: [],
    }
  },

  /**
   * 组内素材 + 组内提示词 + 外部上游（§6.11「创作参数面板与生成节点完全一致」）。
   * 顺序即「缩略图顺序」：先组内（childIds 顺序，拖动排序靠它生效）后外部上游。
   * 隐藏项（hiddenIds / hiddenPromptIds）不参与本次生成。
   */
  collectInputs({ node, graph }: InputContext<GroupData>): NodeInput[] {
    const index = indexNodes(graph.nodes)
    const data = node.data
    const hidden = new Set(data.hiddenIds ?? [])
    const hiddenPrompts = new Set(data.hiddenPromptIds ?? [])

    const inputs: NodeInput[] = []
    // ① 组内收纳物：素材（图片 / 视频）+ 提示词文本
    for (const childId of childIdsOf(node, graph)) {
      if (hidden.has(childId)) continue
      const child = index.get(childId)
      if (!child) continue
      if (child.type === 'prompt') {
        if (hiddenPrompts.has(childId)) continue
        inputs.push({ kind: 'text', nodeId: child.id, text: (child.data as PromptData).text })
        continue
      }
      const hash = (child.data as GenerationData).assetHash
      if (hash) inputs.push({ kind: 'asset', nodeId: child.id, assetHash: hash, mime: 'image/png' })
    }
    // ② 外部上游：连到分组端点上的节点
    for (const id of directUpstream(node.id, graph.edges)) {
      const up = index.get(id)
      if (!up) continue
      if (up.type === 'prompt') {
        inputs.push({ kind: 'text', nodeId: up.id, text: (up.data as PromptData).text })
        continue
      }
      const hash = (up.data as GenerationData).assetHash
      if (hash) inputs.push({ kind: 'asset', nodeId: up.id, assetHash: hash, mime: 'image/png' })
    }
    return inputs
  },

  /** 与生成节点同一套构造逻辑：渠道 / 模型缺失返回 null（不进计划） */
  toRunRequest({ node, inputs }: RunContext<GroupData>): RunRequest | null {
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

/**
 * 容器（分组 / 批量）的排序键：只要 id 与 data.childIds（画板没有 childIds，不适用）。
 * 让 batch 能直接复用它，不必按类型重写一遍。
 */
export interface ContainerLike {
  id: string
  data: { childIds?: string[] }
}

/**
 * 组的子节点 id。
 * 以图为准（parentId），`data.childIds` 只作为排序依据——
 * 这样拖入拖出后即使 childIds 还没来得及同步，也不会漏掉刚进组的节点。
 */
export function childIdsOf(group: ContainerLike, graph: { nodes: NodeSnapshot[] }): string[] {
  const own = graph.nodes.filter((n) => n.parentId === group.id)
  const byId = new Map(own.map((n) => [n.id, n] as const))
  const ordered: string[] = []
  for (const id of group.data.childIds ?? []) {
    if (byId.has(id)) {
      ordered.push(id)
      byId.delete(id)
    }
  }
  // 未进 childIds 的（刚拖入）按图中顺序补在尾部
  for (const n of own) if (byId.has(n.id)) ordered.push(n.id)
  return ordered
}

/** 分组自身不能作为自己的子级（拖入校验复用） */
export function isSelfOrDescendant(groupId: string, candidateId: string, graph: { nodes: NodeSnapshot[] }): boolean {
  return candidateId === groupId || isDescendantOf(graph.nodes, candidateId, groupId)
}
