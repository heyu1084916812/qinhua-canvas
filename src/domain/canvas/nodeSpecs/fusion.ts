import type { FusionData, NodeSnapshot } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { InputContext, NodeSpec } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { indexNodes } from '../model/graph'
import type { GraphSnapshot } from '../model/graph'
import { resultImagesOf } from '../graph/resultImages'
import { targetPortOf, DEFAULT_TARGET_PORT } from '../model/edge'
import { FUSION_PADDING_RATIO, FUSION_MAX_PATCHES } from '../fusion/fusionPlan'

/**
 * 融合节点右侧**共用口**的 id（产品文档 §6.23）。
 *
 * 它同时是「局部修改图入口」与「融合结果出口」—— 大雄无限画布 `local-patch`
 * 插件的那个点就是这个形状（同时带 `in` / `out` 两个类）。
 * 用户口径：「右边只需要一个端点，可以连接多个局部图」。
 */
export const FUSION_PATCH_PORT = 'patch'

/**
 * 图像融合节点规格（产品文档 §6.23，2026-09-29）。
 *
 * **它不产出模型调用**：`generate` / `toRunRequest` 一律缺席，故不进 `isGeneratableType`，
 * 也不参与选路、重试、配额。它的产物来自本地像素合成（`features/canvas/execution/fuseNode`）。
 *
 * 端口两只（这是本项目第一个「不止一对口」的节点）：
 * - 左侧 `input`：一张完整原图；
 * - 右侧 `patch`（中点、**共用口**）：入边接 1–16 张局部修改图（**允许同一个上游连多条**），
 *   出边把融合结果交给下游。两只方向共用同一个锚点，与参考实现一致。
 */
export const fusionSpec: NodeSpec<FusionData> = {
  type: 'fusion',
  label: '融合节点',
  sizing: { min: NODE_MINIMUMS.fusion },
  ports: {
    input: true,
    /**
     * 刻意**关掉默认的 `output`**：右侧那只共用口在 `extras` 里声明。
     * 留着默认 output 就又变成「右侧两个点」，正是要改掉的东西。
     */
    output: false,
    extras: [
      {
        id: FUSION_PATCH_PORT,
        kind: 'both',
        side: 'right',
        // 中点：与参考实现一致（那只点在节点右边缘的中线上）
        y: 0.5,
        label: '局部修改输入 / 融合结果输出',
        /**
         * 允许多条同源入边：同一个上游连两次 = 两张局部修改图。
         * `multi` 只对**入方向**生效（见 canConnect）——出方向本来就可以连下游多个。
         */
        multi: true,
      },
    ],
  },
  /**
   * 上游可以是任何会产出图片的节点。**含 fusion 自己**（融合结果可以再作为
   * 另一张原图 / 局部图参与二次融合），环路由连接层的环检测兜住。
   */
  accepts: { upstream: ['generation', 'group', 'batch', 'loop', 'fusion'] },
  createDefaultData(): FusionData {
    // 只剩一份设置：颜色匹配默认开（与参考实现的复选框一致）
    return { colorMatch: true }
  },

  /**
   * 收集输入：**原图在前，局部修改图按连线顺序在后**。
   *
   * 顺序即语义（`planFusion` 用位置映射把第 i 张补丁对上第 i 条选区），
   * 所以这里不能排序、也不能去重 —— 去重会改变下标，把补丁配错选区。
   * 消费方若想按口分开读，用 `fusionInputsOf`。
   */
  collectInputs({ node, graph }: InputContext<FusionData>): NodeInput[] {
    const { original, patches } = fusionInputsOf(node, graph)
    return [original, ...patches].filter((x): x is FusionAssetInput => x !== null)
  },
}

/**
 * 融合节点的输入**只有素材**（图片），故这里把联合类型收窄到 `asset` 分支。
 *
 * 不收窄的话，下游每个消费点都要先判别 `kind === 'asset'` 才能读 `assetHash`
 * ——而这层已经保证过只产生素材项，重复判别只是噪音。
 */
export type FusionAssetInput = Extract<NodeInput, { kind: 'asset' }>

export interface FusionInputs {
  original: FusionAssetInput | null
  patches: FusionAssetInput[]
}

/**
 * 按**端口**拆开上游：`patch` 口的速度决定补丁顺序，`input` 口取第一张当原图。
 *
 * 必须按端口而不是「所有上游」：原图与补丁都从上游来，只按 nodes 顺序读会把
 * 原图当成第 1 张补丁，整条链路从第一张就开始错位。
 */
export function fusionInputsOf(
  node: NodeSnapshot<FusionData>,
  graph: GraphSnapshot,
): FusionInputs {
  const index = indexNodes(graph.nodes)
  let original: FusionAssetInput | null = null
  const patches: FusionAssetInput[] = []

  for (const edge of graph.edges) {
    if (edge.target !== node.id) continue
    const up = index.get(edge.source)
    if (!up) continue
    const hash = resultImagesOf(up)[0]
    if (!hash) continue
    const input: FusionAssetInput = {
      kind: 'asset',
      nodeId: up.id,
      assetHash: hash,
      mime: 'image/png',
      ...(up.data as { naturalSize?: { width: number; height: number } }).naturalSize
        ? { naturalSize: (up.data as { naturalSize?: { width: number; height: number } }).naturalSize }
        : {},
    }
    if (targetPortOf(edge) === FUSION_PATCH_PORT) {
      if (patches.length < FUSION_MAX_PATCHES) patches.push(input)
    } else if (targetPortOf(edge) === DEFAULT_TARGET_PORT && !original) {
      original = input
    }
  }

  return { original, patches }
}

/** 供 UI / 执行层共用的外扩比例（避免两处各写一个 0.08） */
export { FUSION_PADDING_RATIO }
