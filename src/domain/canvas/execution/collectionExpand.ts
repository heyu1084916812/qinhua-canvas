import type { NodeInput } from '../model/runRecord'

/**
 * 集合展开（产品文档 §6.12「四种典型场景」/「作为上游：集合卡」）。
 *
 * 批量节点作为上游时，下游生成节点要**遍历集合内的每个素材，各生成一次**。
 * 这条规则放在 domain：执行计划（buildRunPlan）在 node 环境单测，不需要跑 React。
 *
 * 语义要点：
 * - 集合卡在「收集输入」阶段是一个 `collection` 项；到执行阶段才展开成 N 次调用
 * - 展开时**只替换该项**，同一输入里的其他项（外部上游图 / 提示词 / 分组素材）原样复制，
 *   这正是场景 2 / 4 的「批量 2 张 + 外部 1 张，共同作为上游 → 出 2 个结果」
 * - 多个集合同时存在时取最大长度，短的按最后一项补齐（不制造空洞调用）
 * - 没有任何集合时返回单个变体，调用方走原有单次路径
 */
export interface Expansion {
  /** 第 i 次调用使用的输入集 */
  inputs: NodeInput[]
  /** 该次调用对应的集合项来源（用于溯源与缩略图高亮），无集合时为 null */
  itemNodeId: string | null
}

/** 输入里所有集合项的展开尺寸（>=1）；无集合返回 1 */
export function expansionCount(inputs: readonly NodeInput[]): number {
  let count = 1
  for (const input of inputs) {
    if (input.kind === 'collection') count = Math.max(count, input.items.length)
  }
  return count
}

/** 输入里是否含集合（决定是否需要走多次调用路径） */
export function hasCollection(inputs: readonly NodeInput[]): boolean {
  return inputs.some((i) => i.kind === 'collection')
}

/**
 * 把输入展开成 N 份。
 * 第 i 份 = 每个集合项取自己的第 i 个元素（越界时取最后一个），非集合项原样保留。
 * 集合项自己的元素如果是文本 / 素材，直接展开为该元素；元素本身是集合时递归展开。
 *
 * 元素带 `collectionItemId`（= 原本所属集合项的 nodeId），下游据此做溯源与去重：
 * 只按 `nodeId` 区分的话，同一张图被拖进集合 2 次就会被当成同一次调用（素材 hash 相同）。
 */
export function expandInputs(inputs: readonly NodeInput[], count?: number): Expansion[] {
  const n = Math.max(1, count ?? expansionCount(inputs))
  if (n === 1 && !hasCollection(inputs)) {
    return [{ inputs: [...inputs], itemNodeId: null }]
  }

  const out: Expansion[] = []
  for (let i = 0; i < n; i += 1) {
    const expanded: NodeInput[] = []
    let itemNodeId: string | null = null
    for (const input of inputs) {
      if (input.kind !== 'collection') {
        expanded.push(input)
        continue
      }
      if (input.items.length === 0) continue
      const picked = input.items[Math.min(i, input.items.length - 1)]!
      itemNodeId = picked.nodeId
      // 元素本身可能是嵌套集合（批量接批量），递归摊平
      const parts = picked.kind === 'collection' ? picked.items : [picked]
      for (const part of parts) {
        // 只给「集合来源」的元素打标：外部上游项保持原样，双方语义清晰
        expanded.push({ ...part, collectionItemId: picked.nodeId } as NodeInput)
      }
    }
    out.push({ inputs: expanded, itemNodeId })
  }
  return out
}
