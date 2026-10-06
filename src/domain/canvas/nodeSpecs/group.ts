import { GROUP_BG_TONES, GROUP_BG_DEFAULT } from '../model/node'
import type { GroupBgTone, GroupData, NodeSnapshot } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import type { NodeSpec } from './types'
import { NODE_MINIMUMS } from '../layout/constants'
import { isDescendantOf } from '../model/graph'

/**
 * 分组节点规格（产品文档 §6.11）。
 *
 * ⚠️ **组不做生成**（用户 2026-10-06 第 13 批第 5 条：「就不是把他当成生成节点了」）：
 * 它只是一个**包住内容的容器**（常显背景 + 标题 + 四角缩放），
 * 所以这里**没有** `collectInputs` / `toRunRequest` —— 组自己跑不出任何东西，
 * 想跑就用功能栏的「整组执行」（把组内**能跑**的节点逐个跑起来）。
 *
 * 它保留的东西：容器侧声明（`accepts.children` / parent，让 `canReparent` 校验拖入拖出）
 * + **一只右端点**（拖出来 = 组内成员各连一条到目标，见 `useEdgeDrag.expandContainers`）。
 * 左侧**没有输入端点**：没有生成语义 ⇒ 也没有"喂给它"这件事；
 * 要让组内节点吃到上游，就直接连到那个成员上（规则 4 已按新口径放宽）。
 */
export const groupSpec: NodeSpec<GroupData> = {
  type: 'group',
  label: '分组',
  sizing: { min: NODE_MINIMUMS.group, lockAspect: true },
  ports: { input: false, output: true },
  accepts: {
    /**
     * **不接上游**：没有输入端点（同上），上游直接连组内成员。
     * 留着一个空数组而不是删掉字段：`accepts` 的形状是 specs 的统一契约，
     * 少一个字段会让"哪里声明了什么"变得难查。
     */
    upstream: [],
    children: ['prompt', 'generation'],
    // 不嵌套容器，保持单层收纳
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
   * 组自己**什么都不吃**（如实返回空数组）。
   *
   * `collectInputs` 在 spec 契约里是必填（"这个节点会吃到什么"），而"能不能跑"
   * 由 `toRunRequest` / `generate` 的**缺失**表达 —— 组这两个都没有，
   * 所以它在执行计划里会被自然跳过（想跑就用功能栏的「整组执行」）。
   * 组内成员要吃到上游，直接连到那个成员上（规则 4 已按新口径放宽）。
   */
  collectInputs(): NodeInput[] {
    return []
  },

}

/**
 * 组的**背景色档位**（渲染值）：缺字段 / 非法值（老工程、手改过的文件）一律回落到缺省档。
 *
 * 与 `containerMinSize` 同一条思路：视图层只调用、不自己判 —— 判定口径写一份，
 * 主题色值写在 `ui/tokens.css`，两者都不落在组件里。
 */
export function groupBgOf(node: { data: Partial<GroupData> }): GroupBgTone {
  const bg = node.data.bg
  return bg && (GROUP_BG_TONES as readonly string[]).includes(bg) ? bg : GROUP_BG_DEFAULT
}

/**
 * 容器（分组 / 批量）的排序键：只要 id 与 data.childIds。
 * 让 batch 能直接复用它，不必按类型重写一遍。
 */
export interface ContainerLike {
  id: string
  data: { childIds?: string[] }
}

/**
 * `childIdsOf` 的 `NodeSnapshot` 便捷入口。
 *
 * `NodeSnapshot['data']` 是个联合类型（提示词 / 生成 / 分组…各一套），直接传进
 * `ContainerLike` 过不了类型检查。与其在三个调用点各写一遍 cast，不如在这里抹一次 ——
 * 而且"谁能当容器"这件事只该由本文件回答（`CONTAINER_TYPES` 也在这条线上）。
 */
export function childIdsOfNode(node: NodeSnapshot, graph: { nodes: NodeSnapshot[] }): string[] {
  return childIdsOf({ id: node.id, data: node.data as { childIds?: string[] } }, graph)
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
