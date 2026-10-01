import type { ChatMessage } from '../../../../domain/shared/execution/types'

/**
 * 对话流（设计文档 §8「输出：计划预览 + 普通对话」）。
 *
 * 为什么要有这一层：面板原来把 `tool` 消息**原样**当聊天内容打印出来 ——
 * 用户看到的是一屏 JSON（`{"outputFacts":…,"edges":[…]}`）。参考产品（liblib.tv）
 * 的做法是把它折成**一行步骤卡**：「图片节点已创建 ⌄」，要细节才展开。
 *
 * 这是**纯函数**：给一串消息，产出「气泡 / 正文 / 步骤」三种条目。
 * 放纯函数里而不是塞进组件，是因为这套映射（哪个工具叫什么名、结果里哪几个数要报出来）
 * 是产品口径，得能用断言钉住。
 */

export interface ConversationStep {
  kind: 'step'
  /** 工具调用 id —— 结果消息靠它找回自己那一步 */
  id: string
  tool: string
  label: string
  /** 展开后才看的明细（一行一条） */
  lines: string[]
  /** 这一步牵扯到的节点 id：面板据此把它们产出的图**内嵌**显示 */
  nodeIds: string[]
  failed: boolean
}

export type ConversationItem =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | ConversationStep

/** 工具 → 用户看得懂的一行标题。没登记的走兜底，不假装认识 */
const TOOL_LABEL: Record<string, string> = {
  readGraph: '已看画布',
  readAsset: '已读素材',
  readResult: '已读结果',
  applyPlan: '工作流已创建',
  updateNode: '已改节点参数',
  runNode: '已运行生成',
}

export function toolLabel(tool: string): string {
  return TOOL_LABEL[tool] ?? `已调用 ${tool}`
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * 工具结果 → 人能读的几行 + 涉及的节点 id。
 *
 * **解析不出来不吞**：把原文原样给出来（截断到一行），因为「看不懂的结果」
 * 也比「看起来什么都没发生」强 —— 后者是这类面板最容易变成的死状态。
 */
export function describeToolResult(
  tool: string,
  raw: string,
): { lines: string[]; nodeIds: string[]; failed: boolean } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    const text = raw.trim().split('\n')[0] ?? ''
    return { lines: text ? [text] : [], nodeIds: [], failed: false }
  }
  const r = asRecord(parsed)
  const problems = asArray(r.problems).map((p) => `· ${String(p)}`)
  const failed = r.ok === false || problems.length > 0

  switch (tool) {
    case 'readGraph': {
      const nodes = asArray(r.nodes)
      const edges = asArray(r.edges)
      return {
        lines: [`画布上 ${nodes.length} 个节点、${edges.length} 条连线`],
        nodeIds: [],
        failed: false,
      }
    }
    case 'readAsset': {
      const assets = asArray(r.assets)
      return { lines: [`读了 ${assets.length} 个素材`], nodeIds: [], failed: false }
    }
    case 'readResult': {
      const results = asArray(r.results).map(asRecord)
      return {
        lines: results.map((x) => `${String(x.nodeId ?? '?')}：${String(x.status ?? '?')}`),
        nodeIds: results.filter((x) => x.status === 'ok').map((x) => String(x.nodeId)),
        failed: false,
      }
    }
    case 'applyPlan': {
      const ids = asArray(r.createdNodeIds).map(String)
      return {
        lines: [
          ids.length > 0 ? `新建 ${ids.length} 个节点` : '没有新建节点',
          ...(failed ? problems : ['自检通过，图与计划一致']),
        ],
        // 新建的节点此刻还没有产物，缩略图自然不显示；产出一出来就补上
        nodeIds: ids,
        failed,
      }
    }
    case 'runNode': {
      const outcomes = asArray(r.outcomes).map(asRecord)
      return {
        lines: outcomes.length
          ? outcomes.map((o) =>
              o.ok === false
                ? `运行失败：${String(o.error ?? '未知原因')}`
                : `节点 ${String(o.nodeId ?? '?')} 运行完成`,
            )
          : problems,
        nodeIds: outcomes.map((o) => String(o.nodeId)),
        failed,
      }
    }
    case 'updateNode': {
      return { lines: failed ? problems : ['参数已更新'], nodeIds: [], failed }
    }
    default: {
      return { lines: failed ? problems : [], nodeIds: [], failed }
    }
  }
}

/**
 * 消息序列 → 对话条目。
 *
 * 配对规则：`role:'assistant'` 里的每次 `toolCalls` 生成一张步骤卡，
 * 后面 `role:'tool'` 且 `toolCallId` 对得上的那条把结果填进那张卡。
 * **对不上的 tool 消息直接丢**（例如上下文窗口截断留下的半截），
 * 不能凭空冒出一张没有请求的卡。
 */
export function toConversation(messages: readonly ChatMessage[]): ConversationItem[] {
  const out: ConversationItem[] = []
  const stepAt = new Map<string, number>()

  for (const m of messages) {
    if (m.role === 'system') continue

    if (m.role === 'user') {
      if (m.content.trim()) out.push({ kind: 'user', text: m.content })
      continue
    }

    if (m.role === 'assistant') {
      if (m.content.trim()) out.push({ kind: 'text', text: m.content })
      for (const call of m.toolCalls ?? []) {
        stepAt.set(call.id, out.length)
        out.push({
          kind: 'step',
          id: call.id,
          tool: call.name,
          label: toolLabel(call.name),
          lines: [],
          nodeIds: [],
          failed: false,
        })
      }
      continue
    }

    // role === 'tool'：把结果填回它那张卡
    const at = m.toolCallId ? stepAt.get(m.toolCallId) : undefined
    if (at === undefined) continue
    const item = out[at]
    if (!item || item.kind !== 'step') continue
    const described = describeToolResult(item.tool, m.content)
    out[at] = { ...item, ...described }
  }

  return out
}
