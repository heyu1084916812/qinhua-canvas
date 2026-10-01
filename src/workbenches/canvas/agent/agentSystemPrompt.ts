import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { allSpecs } from '../../../domain/canvas/nodeSpecs/registry'
import type { GraphSummary } from './tools'

/**
 * Agent 的系统提示词（设计文档 §4.1 的四段）。
 *
 * ## 词表必须从代码生成 —— 这是这一节最要紧的约束
 *
 * 模型不可能天生知道轻画有哪几种节点、融合有三个口、生成节点有哪些参数。
 * 手写一份词表**一定会漂移**：节点加了参数而词表没加，agent 就会持续建出
 * 缺参数的图，而报错信息还指不到原因。
 *
 * 所以 ①③ 两段整个从 `nodeSpecs` 读出来。改了节点，词表跟着改。
 */

/** ① 身份 + ② 硬规则：固定不变 */
const IDENTITY_AND_RULES = [
  '你是「轻画」这张无限画布上的助理。用户要什么，你就把它做成画布上的工作流。',
  '',
  '## 你的工作方式',
  '- 要动手时，用 applyPlan 工具**一次性**给出整张图（节点 + 连线），不要零散地建很多次。',
  '- 每个节点给一个 order（从 0 起）表示「第几步」；坐标不用你算，系统会排。',
  '- 想复用画布上已有的节点（比如用户先放好的素材图），用 attach 指过去，不要重复建。',
  '',
  '## 硬规则',
  '- 只能用下面列出来的节点类型与端口。不要发明类型，也不要把线接到不存在的口上。',
  '- 不要直接调渠道接口 —— 所有生成都走画布的执行引擎（否则没有撤销、日志与留痕）。',
  '- 会花钱的动作（生成图片 / 视频）**不会立刻执行**：系统会先让用户确认，',
  '  你把它当作「已提交、等用户点头」即可，不要在对话里催。',
  '- 建完之后系统会**回读画布自检**并把结果给你。若自检报出问题，按它说的补或改。',
  '- 用户没要求的不要顺手建。宁可少建，也不要塞一堆他用不上的节点。',
].join('\n')

/**
 * ③ 画布词表：从 `nodeSpecs` 生成。
 *
 * 报「有什么类型、能接谁、有哪些端口」——这三样正是建图时必须知道的。
 */
export function buildCanvasVocabulary(): string {
  const lines: string[] = ['## 画布上有哪些节点（唯一合法的类型清单）']
  for (const spec of allSpecs()) {
    const accepts = spec.accepts?.upstream ?? []
    const ports = spec.ports
    lines.push(`- ${spec.type}（${spec.label}）`)
    lines.push(`  能接的上游：${accepts.length ? accepts.join(' / ') : '无（源头节点）'}`)
    if (ports) {
      /** 默认口（input / output）与附加口（目前只有融合的 `patch`）一起报出来 */
      const list: string[] = []
      if (ports.input) list.push('input（入口，左侧）')
      if (ports.output) list.push('output（出口，右侧）')
      for (const p of ports.extras ?? []) {
        const dir = p.kind === 'input' ? '入口' : p.kind === 'output' ? '出口' : '出入口'
        list.push(`${p.id}（${dir}，${p.side === 'left' ? '左' : '右'}侧）`)
      }
      if (list.length > 0) lines.push(`  端口：${list.join('、')}`)
    }
  }
  return lines.join('\n')
}

/**
 * ④ 本次现状：画布摘要 + 继承来的参数（设计文档 §11）。
 *
 * 摘要每轮重算。**不把整张图塞进来** —— 画布可能很大，
 * 细节让模型按需调 readGraph（§4.3）。
 */
export function buildCurrentState(
  summary: GraphSummary,
  inherited: { ratio?: string; count?: number; model?: string } = {},
): string {
  const lines: string[] = ['## 现在这张画布上有什么']
  if (summary.nodes.length === 0) {
    lines.push('（空画布）')
  } else {
    lines.push(`共 ${summary.nodes.length} 个节点、${summary.edges.length} 条连线：`)
    for (const n of summary.nodes.slice(0, 40)) {
      lines.push(
        `- ${n.id}｜${n.type}${n.title ? `｜${n.title}` : ''}${n.hasOutput ? '｜已出图' : ''}`,
      )
    }
    if (summary.nodes.length > 40) {
      lines.push(`…还有 ${summary.nodes.length - 40} 个节点（用 readGraph 看全部）`)
    }
  }

  const pairs = Object.entries(inherited).filter(([, v]) => v !== undefined && v !== '')
  if (pairs.length > 0) {
    lines.push('', '## 用户之前用过的参数（可继承；他这次说了就以他说的为准）')
    for (const [k, v] of pairs) lines.push(`- ${k}: ${String(v)}`)
  }
  return lines.join('\n')
}

/** 组装系统提示词。④ 段每次请求重算，①②③ 固定 */
export function buildAgentSystemPrompt(
  summary: GraphSummary,
  inherited?: { ratio?: string; count?: number; model?: string },
): string {
  return [IDENTITY_AND_RULES, buildCanvasVocabulary(), buildCurrentState(summary, inherited)].join(
    '\n\n',
  )
}

/** 供测试与诊断：把节点快照转成摘要（与 tools.readGraphSummary 同源语义） */
export function summarizeForPrompt(nodes: NodeSnapshot[]): GraphSummary {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      hasOutput: Boolean((n.data as { assetHash?: unknown }).assetHash),
    })),
    edges: [],
  }
}
