import { expandLoopRounds, normalizeLoopParams } from '../../../domain/canvas/loop/loopPlan'
import type { LoopData, NodeSnapshot } from '../../../domain/canvas/model/node'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { directDownstream, directUpstream } from '../../../domain/canvas/graph/upstreamOf'
import { indexNodes } from '../../../domain/canvas/model/graph'

/**
 * 「一键运行」循环节点的**展开规划**（用户 2026-09-23：「这个循环节点下方链接好
 * 生成节点的时候他就可以一键运行了，走的就是生成节点的参数」）。
 *
 * ## 语义
 *
 * 循环节点**自己不产图**，它是分发器：
 *  - 把上游素材按轮次**切片**（第 N 轮取第 N 段，取完就没有了）；
 *  - 把提示词按轮次**取模轮换**，并把 `[计数]` / `[总数]` / `[进度]` 替换成实际值；
 *  - 然后**让下游照常跑一趟**——下游完全不知道自己在循环里。
 *
 * 所以「跑一轮」= 用该轮的输入，把下游链路当成一次普通的单点生成来跑。
 *
 * ## 为什么抽成纯函数
 *
 * 这段逻辑全是「第几轮该用哪些图、哪条提示词」，是纯计算，
 * 不该和执行宿主、store、React 混在一起。抽出来才能在 node 下逐轮断言
 * —— 而轮次切片的边界（最后一轮不够取、起始越界）恰恰是最容易算错的地方。
 */

export interface LoopRoundInput {
  /** 轮次（1 基，从 `loopStart` 起算） */
  index: number
  /** 本轮实际能用的素材 hash（可能少于 batch —— 最后一轮常常不够） */
  assetHashes: string[]
  /** 本轮选中的提示词（已做变量替换）；没启用提示词时为空串 */
  prompt: string
}

/**
 * 展开循环节点的每一轮输入。
 *
 * `upstreamAssets` 由调用方收集好（本模块不读图结构里的具体来源，
 * 与 `loopPlan.expandLoopRounds` 的口径一致：它也只收「素材总数」）。
 */
export function planLoopRounds(
  node: NodeSnapshot<LoopData>,
  upstreamAssets: readonly string[],
  upstreamPrompts: readonly string[],
): LoopRoundInput[] {
  const data = node.data
  const params = normalizeLoopParams(data)
  const rounds = expandLoopRounds({
    params,
    upstreamImages: upstreamAssets.length,
    upstreamPrompts,
    usePrompt: data.usePrompt,
    useImageInput: data.useImageInput,
  })

  return rounds.map((r) => ({
    index: r.index,
    // 切片边界由 expandLoopRounds 算好；这里按它给的下标取实际 hash
    assetHashes: data.useImageInput ? upstreamAssets.slice(r.imageFrom, r.imageTo) : [],
    prompt: r.prompt,
  }))
}

/** 收集循环节点的**上游素材 hash**（上游节点自身的 `assetHash`，按节点顺序） */
export function loopUpstreamAssets(
  node: NodeSnapshot<LoopData>,
  graph: GraphSnapshot,
): string[] {
  const index = indexNodes(graph.nodes)
  const out: string[] = []
  for (const id of directUpstream(node.id, graph.edges)) {
    const up = index.get(id)
    if (!up) continue
    const hash = (up.data as { assetHash?: string }).assetHash
    if (hash) out.push(hash)
  }
  return out
}

/** 收集循环节点的**上游提示词文本**（按节点顺序） */
export function loopUpstreamPrompts(
  node: NodeSnapshot<LoopData>,
  graph: GraphSnapshot,
): string[] {
  const index = indexNodes(graph.nodes)
  const out: string[] = []
  for (const id of directUpstream(node.id, graph.edges)) {
    const up = index.get(id)
    if (!up || up.type !== 'prompt') continue
    const text = ((up.data as { text?: string }).text ?? '').trim()
    if (text) out.push(text)
  }
  return out
}

/** 下游有可执行的生成节点吗（没有就不该让「一键运行」点得动） */
export function hasRunnableDownstream(node: NodeSnapshot<LoopData>, graph: GraphSnapshot): boolean {
  const index = indexNodes(graph.nodes)
  return directDownstream(node.id, graph.edges).some((id) => {
    const n = index.get(id)
    if (!n) return false
    /**
     * ⚠️ 判据必须比 `canBuildRequest` **更严**（用户 2026-09-23 实测踩到）。
     *
     * `canBuildRequest` 只看「节点类型可生成 + spec 有 toRunRequest」——
     * 它回答的是「这个节点**有没有可能是**运行主体」，与渠道 / 模型配没配无关。
     * 拿它当「能不能跑」的判据，会出现按钮亮着、点下去什么都没发生
     * （实测：下游生成节点还是「上传素材」空态，按钮却显示可用）。
     *
     * 真正的可跑条件 = 渠道与模型都已选好。与 `emptyPlanReason` 同一口径。
     */
    if (n.type !== 'generation' && n.type !== 'batch') return false
    const d = n.data as { channelId?: string; model?: string }
    return !!d.channelId && !!d.model
  })
}
