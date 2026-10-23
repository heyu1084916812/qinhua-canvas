import type { Channel } from '../../../domain/project/channel'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { presetPromptSuffix } from '../../../domain/canvas/layout/presets'

/**
 * 「这个节点为什么进不了执行计划」（用户 2026-09-23 报「点生成没有反应」）。
 *
 * 背景：生成节点的规格在缺 `channelId` / `model` 时让 `toRunRequest` 返回 null，
 * 该节点于是**不进计划**；执行宿主看到 `plan.tasks.length === 0` 只能直接返回。
 * 早先这里什么都不说，于是从用户视角看就是「按钮坏了」——与项目历史上
 * 「点了没反应」那一类幽灵缺陷同源（见对账清单「用户实测报」各条）。
 *
 * 抽成纯函数的两个理由：
 * 1. 它只依赖图快照 + 渠道表，没有任何 React / 存储副作用，可以在 node 下单测；
 * 2. 文案分叉是**产品判断**，值得用断言钉住，而不是散在组件里随手写字符串。
 *
 * 返回 `null` 表示「计划为空这件事不该由这条兜底解释」——例如节点已经不存在。
 */
export function emptyPlanReason(
  node: NodeSnapshot | undefined,
  channels: readonly Channel[],
  graph: GraphSnapshot,
): string | null {
  if (!node) return null
  /* 对账 #515：禁用节点不参与执行，它的内容也不再作为上游输入 */
  if (node.disabled) return '节点已禁用 —— 先启用再生成；它的内容（含已生成的图）不会作为上游输入'

  const data = node.data as {
    channelId?: string
    model?: string
    prompt?: string
    preset?: string
    presetOptions?: Record<string, string>
    emotion?: string
    faceBox?: { x: number; y: number; w: number; h: number }
  }
  const enabled = channels.filter((c) => c.enabled)

  if (enabled.length === 0) {
    return channels.length > 0 ? '已配置的渠道都未启用' : '还没有配置任何渠道'
  }
  if (!data.channelId) return '还没有选择渠道'

  const active = enabled.find((c) => c.id === data.channelId)
  if (!active) return '所选渠道已停用'
  if (!data.model) return '该渠道还没勾选模型'

  // 生成节点允许「自己没写提示词、只连了上游提示词节点」——那条路是通的，
  // 所以只有在上游也拿不到文本时，才判定为「没内容可发」。
  const hasUpstreamPrompt = graph.edges
    .filter((e) => e.target === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .some(
      (n) =>
        n?.type === 'prompt' &&
        (((n.data as { text?: string }).text ?? '').trim().length > 0),
    )

  /**
   * 预设 / 情绪本身会拼进提示词，所以它们也是内容来源。
   * 判据与 `generationSpec.toRunRequest` 共用 `presetPromptSuffix()`，
   * 不能只看正文 —— 否则「只选了预设」会被误报成没写提示词。
   */
  const hasPresetPrompt = presetPromptSuffix(data).trim().length > 0
  if (!(data.prompt ?? '').trim() && !hasUpstreamPrompt && !hasPresetPrompt) {
    return '还没有写提示词'
  }
  return '这次生成没有可执行的任务'
}
