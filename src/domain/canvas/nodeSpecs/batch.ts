import type { BatchData, GenerationData, NodeSnapshot, PromptData } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { InputContext, NodeSpec, RunContext, RunRequest } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { directUpstream } from '../graph/upstreamOf'
import { childIdsOf } from './group'
import { generationParams } from './params'
import { presetPromptSuffix } from '../layout/presets'

/**
 * 批量节点规格（产品文档 §6.12）。
 *
 * 批量节点是一个「可迭代的素材集合」：把多个同类素材收进去，逐个处理，
 * 为每个素材生成一份结果内容。与分组的差别在语义而非形态：
 * - 分组：把内部素材**打包成一次请求的输入**（一张出图用全部素材）
 * - 批量：把内部**每一个素材各当成一次请求**（N 个素材 → N 份结果）
 *
 * 二选一（media | prompt）是硬约束：已放入一种类型时另一种类型拖入被拒绝，
 * 由领域函数 `canAcceptIntoBatch` 判定，命令层通过 accepts.children 之外的规则校验。
 */
export const batchSpec: NodeSpec<BatchData> = {
  type: 'batch',
  label: '批量',
  sizing: { min: NODE_MINIMUMS.batch, lockAspect: true },
  ports: { input: true, output: true },
  accepts: {
    // 与分组同源：外部上游只作补充（§6.12 场景 2 / 4 的「+ 外部 1 张图」）
    /** `loop` 一并接受（§6.22）：批量也能吃循环分发的输入 */
    /** `fusion` 一并接受（§6.23）：融合产物和生成产物一样是「一张图」 */
    upstream: ['prompt', 'generation', 'loop', 'fusion'],
    // 两种都允许「形式上」收纳；真正的 media/prompt 互斥由 canAcceptIntoBatch 二次校验
    children: ['prompt', 'generation'],
  },
  createDefaultData(): BatchData {
    return {
      mode: 'image',
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: '',
      model: '',
      thumbOrder: [],
      upstreamHidden: [],
      // 空集合的 contentTypes 未定，读取时按 'media' 兜底（见 contentTypeOf）
      contentType: 'media',
      childIds: [],
      hiddenIds: [],
    }
  },

  /**
   * 集合内容（§6.12「第二部分的两种用法」）。
   *
   * 关键：集合本体必须包成**一个 `collection` 项**，而不是把元素平铺出来。
   * 平铺会退化成「一张出图用全部素材」（那是分组的语义），
   * 只有包成集合，`buildRunPlan` 才会展开成「每个素材各发一次请求」——
   * 这正是批量与分组的唯一分界：批量节点自己点生成也要出 N 份结果。
   *
   * 外部直接上游（连线来的）不包进集合：它是每次迭代都附带的「共同输入」，
   * 由 collectionExpand 在展开时原样复制到每一次调用。
   */
  collectInputs({ node, graph }: InputContext<BatchData>): NodeInput[] {
    /**
     * 集合成员 = **内部素材 + 外部连线的素材**。
     *
     * 此前只有内部素材进集合，外部连线的素材被当成「共同输入」原样复制进每一次调用
     * ——于是「批量节点是空的、两张素材从外面连进来」时会退化成**一次调用、两张图一起
     * 丢给模型**（出一张「两个人一起吃饭」），而用户要的是「两张素材各出一张」。
     *
     * 批量的定义是「素材集合，逐个处理」，那么**素材从哪儿进来不该影响语义**：
     * 放进内部、还是从外面连进来，都是这个集合的一项，都该逐张展开。
     * 外部连线的**提示词**仍是共同输入（它不是素材，不该被拆开迭代）。
     */
    const items = batchItemsOf(node, graph)
    const external = externalInputsOf(node, graph)
    const externalAssets = external.filter((i) => i.kind === 'asset')
    const common = external.filter((i) => i.kind !== 'asset')
    const all = [...items, ...externalAssets]
    if (all.length === 0) return common
    const collection: NodeInput = { kind: 'collection', nodeId: node.id, items: all }
    return [collection, ...common]
  },

  /**
   * 批量节点自身的生成入口（§6.12「生成入口：创作参数面板的生成按钮；右键批量节点 → 生成」）。
   *
   * 语义与生成节点一致的一次请求——「逐个遍历」由上游侧（集合卡展开）承担：
   * 批量节点作为下游时，它自己只发一次请求，输入是整个集合。
   * 需要「N 个素材各出一份结果」时，批量节点作为**上游**接到生成节点上，
   * 由下游生成节点的 collectInputs 把它包装成 collection 并逐项展开（M3-3d）。
   */
  toRunRequest({ node, inputs }: RunContext<BatchData>): RunRequest | null {
    const data = node.data
    if (!data.channelId || !data.model) return null

    /**
     * 提示词 = 素材自带的（本次那一项）+ 外部共同提示词 + 批量节点自己的（**尾部**）。
     *
     * 顺序是用户定的：批量节点面板写的那句是「对这批所有素材统一生效的指令」，
     * 放最后才符合「先描述素材、再给统一要求」的读法；
     * 放最前会被素材描述冲淡（尤其是素材自带描述较长时）。
     *
     * 「素材自带」只取**本次这一项**的（`collectionItemId` 标出来的那个），
     * 不把所有素材的描述全拼上——那会让第 1 次调用也带上第 2 张素材的描述，
     * 两张图互相污染，批量就退化成分组了。
     */
    const own = data.prompt.trim()
    const commonText = inputs
      .filter((i): i is Extract<NodeInput, { kind: 'text' }> => i.kind === 'text')
      .map((i) => i.text.trim())
      .filter(Boolean)
    /** 本次调用对应的那一项素材（展开时打了 collectionItemId） */
    const picked = inputs.find(
      (i): i is Extract<NodeInput, { kind: 'asset' }> =>
        i.kind === 'asset' && !!i.collectionItemId,
    )
    const itemPrompt = picked?.prompt?.trim() ?? ''
    /** 末尾补「预设 / 情绪」（用户 2026-10-05 第 14 条）：它也是「对这批的统一要求」 */
    const parts = [itemPrompt, ...commonText, own, presetPromptSuffix(data)].filter(Boolean)
    const prompt = parts.join('\n')
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

/** 互斥判定所需的最小输入：id + data（不要求整个 NodeSnapshot，方便命令层传 NodeLike） */
export interface BatchLike {
  id: string
  data: Partial<BatchData>
}

/**
 * 批量集合的「元素清单」（§6.12 集合卡的内容）：
 * 按 childIds 顺序逐个取内部子节点，隐藏项跳过——隐藏的素材不计入（文档明确）。
 * 这是集合卡数量、下游逐项展开、批量自身请求三处共用的唯一来源，
 * 避免各写一遍导致「卡上写 3、实际跑 2」。
 */
export function batchItemsOf(
  batch: BatchLike,
  graph: { nodes: NodeSnapshot[] },
): NodeInput[] {
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const hidden = new Set(batch.data.hiddenIds ?? [])
  const items: NodeInput[] = []
  for (const childId of childIdsOf(batch, graph)) {
    if (hidden.has(childId)) continue
    const child = index.get(childId)
    if (!child) continue
    if (child.type === 'prompt') {
      items.push({ kind: 'text', nodeId: child.id, text: (child.data as PromptData).text })
      continue
    }
    const data = child.data as GenerationData
    if (data.assetHash) {
      items.push({
        kind: 'asset',
        nodeId: child.id,
        assetHash: data.assetHash,
        mime: 'image/png',
        // 素材自带的描述与原始比例：批量拼提示词 / 「跟随素材」比例都要用它
        ...(data.prompt ? { prompt: data.prompt } : {}),
        ...(data.naturalSize ? { naturalSize: data.naturalSize } : {}),
      })
    }
  }
  return items
}

/** 批量节点自己的外部上游（连线来的），作为每次迭代都附带的「共同输入」 */
export function externalInputsOf(
  node: NodeSnapshot<BatchData>,
  graph: { nodes: NodeSnapshot[]; edges: { id: string; source: string; target: string }[] },
): NodeInput[] {
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const hidden = new Set(node.data.hiddenIds ?? [])
  const out: NodeInput[] = []
  for (const id of directUpstream(node.id, graph.edges)) {
    const up = index.get(id)
    if (!up) continue
    if (hidden.has(up.id)) continue
    if (up.type === 'prompt') {
      out.push({ kind: 'text', nodeId: up.id, text: (up.data as PromptData).text })
      continue
    }
    const data = up.data as GenerationData
    if (data.assetHash) {
      out.push({
        kind: 'asset',
        nodeId: up.id,
        assetHash: data.assetHash,
        mime: 'image/png',
        ...(data.prompt ? { prompt: data.prompt } : {}),
        ...(data.naturalSize ? { naturalSize: data.naturalSize } : {}),
      })
    }
  }
  return out
}

/** 批量集合当前内容类型；空集合按 'media' 兜底（也是首次拖入的默认形态） */
export function contentTypeOf(batch: BatchLike, graph: { nodes: NodeSnapshot[] }): 'media' | 'prompt' {
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  for (const id of childIdsOf(batch, graph)) {
    const child = index.get(id)
    if (!child) continue
    return child.type === 'prompt' ? 'prompt' : 'media'
  }
  // 集合为空时用声明的 contentType（面板可能已切换过）
  return batch.data.contentType ?? 'media'
}

/** 批量集合内某类内容的数量（隐藏项不计入，§6.12「隐藏的素材不计入」） */
export function batchItemCount(batch: BatchLike, graph: { nodes: NodeSnapshot[] }): number {
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const hidden = new Set(batch.data.hiddenIds ?? [])
  let count = 0
  for (const id of childIdsOf(batch, graph)) {
    if (hidden.has(id)) continue
    if (index.has(id)) count += 1
  }
  return count
}

/**
 * 批量集合的「二选一」互斥校验（§6.12 表「二选一」）：
 * 已放入一种类型时，另一种类型拖入被拒绝。
 * 返回 null 表示可以收纳；返回字符串表示拒绝原因（供 UI 弱提示）。
 *
 * 注意：这是在 `accepts.children` 之上的**追加**规则，命令层与拖拽层共用同一函数，
 * 避免「拖拽时允许、落库时拒绝」的割裂。
 */
export function canAcceptIntoBatch(
  batch: BatchLike,
  childType: 'prompt' | 'generation',
  graph: { nodes: NodeSnapshot[] },
): string | null {
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const incoming: 'media' | 'prompt' = childType === 'prompt' ? 'prompt' : 'media'

  for (const id of childIdsOf(batch, graph)) {
    const child = index.get(id)
    if (!child) continue
    const existing: 'media' | 'prompt' = child.type === 'prompt' ? 'prompt' : 'media'
    if (existing !== incoming) {
      return incoming === 'prompt'
        ? '批量节点内已有素材，只能收纳同类内容'
        : '批量节点内已有提示词，只能收纳同类内容'
    }
  }
  return null
}
