import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { channelIsRoutable, type Channel } from '../../../domain/project/channel'
import type { ProtocolCatalog } from '../../../domain/project/protocol'
import { emptyPlanReason } from '../../../features/canvas/execution/emptyPlanReason'
import { buildRunPlan } from '../../../features/canvas/execution/buildRunPlan'

/**
 * Agent 点击确认前的运行检查。
 *
 * 执行宿主在空计划时只会 notify 一句后 return；Agent 若只看运行记录，就会把
 * “没有留下记录”误说成渠道延迟。这里把同一份 `emptyPlanReason()` 提前返回，
 * 让模型看到明确、可转述的阻塞原因。
 */
export function runPreflightProblems(
  nodeIds: readonly string[],
  graph: GraphSnapshot,
  channels: readonly Channel[],
  catalog?: ProtocolCatalog,
): string[] {
  const out: string[] = []
  for (const id of nodeIds) {
    const node = graph.nodes.find((item) => item.id === id)
    if (!node) {
      out.push(`节点不存在：${id}`)
      continue
    }
    if (node.type !== 'generation') continue
    const reason = emptyPlanReason(node, channels, graph)
    /**
     * `emptyPlanReason()` 的兜底句表示“前置字段看着齐，但计划仍为空”。
     * 这时必须用 buildRunPlan 验证；其余具体原因本身已经足够确定。
     */
    if (reason && reason !== '这次生成没有可执行的任务') {
      out.push(`「${node.title || id}」无法运行：${reason}`)
      continue
    }
    const data = node.data as { channelId?: unknown }
    const selected =
      typeof data.channelId === 'string'
        ? channels.find((channel) => channel.id === data.channelId)
        : undefined
    if (selected?.enabled && !channelIsRoutable(selected, catalog)) {
      out.push(`「${node.title || id}」无法运行：所选渠道缺少有效令牌、地址或可用协议`)
      continue
    }
    const plan = buildRunPlan('node', { originNodeId: id }, graph, 'single')
    if (plan.tasks.length > 0) continue
    if (reason) out.push(`「${node.title || id}」无法运行：${reason}`)
  }
  return out
}
