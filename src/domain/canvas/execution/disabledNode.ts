/**
 * **禁用节点在「输入」这一侧的口径**（对账 #515 修订，用户 2026-10-15）：
 *
 * > 「禁用就是禁用内容，包括生成的图片，相当于禁用了那个素材。」
 *
 * 所以禁用是**内容级**的，不只是"不跑"：
 * - 它自己不进执行计划（`buildRunPlan` 过滤）；
 * - **它已产出的素材也不再作为上游输入** —— 下游不再拿到那张图；
 * - 它作为批量集合成员 / 外部共同输入时，同样整项不参与。
 *
 * 为什么抽成一个函数：收集输入的地方有四处（生成 / 提示词反推 / 融合 / 批量），
 * 各自写一句 `if (up.disabled) continue` 迟早会漏掉一处，而漏掉的表现是
 * "禁用了却还在用它的图"——正是这次要修的那件事。
 */
import type { NodeSnapshot } from '../model/node'

/** 这个节点的内容能不能被别人当输入用（禁用 = 不能） */
export function nodeContentUsable(node: NodeSnapshot | undefined): boolean {
  return !!node && node.disabled !== true
}
