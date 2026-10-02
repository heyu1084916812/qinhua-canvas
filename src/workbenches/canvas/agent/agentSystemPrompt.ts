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
  /**
   * 节点名是用户 2026-10-03 单独提的要求：「节点上的名称要根据我的提示词来总结成一个
   * 节点的名称，不能要是图片节点1这种」。写在这里只是**第一道**——模型不听话时
   * `normalizeAgentPlan` 还会从提示词正文里确定性地兜一道。
   */
  '- 每个节点必须给一个 title：**从用户的提示词里总结出来的短名**（3～8 个字，',
  '  像「小猫钓鱼」「四格故事板」这种，用户一眼认得出这个节点是干嘛的）。',
  '  不许用「图片节点1」「生成节点」「未命名」这种跟内容无关的通用名，也不要用英文占位。',
  '- 每个节点给一个 order（从 0 起）表示「第几步」；坐标不用你算，系统会排。',
  '- 想复用画布上已有的节点（比如用户先放好的素材图），用 attach 指过去，不要重复建。',
  '',
  '## 硬规则',
  '- 只能用下面列出来的节点类型与端口。不要发明类型，也不要把线接到不存在的口上。',
  '- 不要直接调渠道接口 —— 所有生成都走画布的执行引擎（否则没有撤销、日志与留痕）。',
  /**
   * 「建图立刻生效、只有花钱才拦」是用户 2026-10-02 拍的口径（对着参考产品截图）：
   * 「他直接给我新建进去，但是生成与否需要让我确认，取消后也不会撤回已经新建到
   * 画布中的工作流」。写进提示词是必须的 —— 模型不知道这件事的话，它会以为
   * 整件事都要等确认，于是反复重发计划。
   */
  '- 建图（applyPlan）**立刻生效**：用户一眼就能在画布上看到你建的节点与连线，不用等他点。',
  '- 只有**会花钱**的动作（生成图片 / 视频）不会立刻执行：系统会先让用户确认，',
  '  你把它当作「已提交、等用户点头」即可，不要在对话里催。',
  /**
   * 用户 2026-10-03 实测（让我用 agent 做视频）：真模型落地之后只写了
   * 「确认后就可以开始跑了」，**没有调 runNode** —— 系统那条确认卡永远不出现，
   * 用户就卡在「计划建好了，但什么都没跑」。这一句必须写死。
   */
  '- 建完图之后**必须调用 runNode** 提交执行（要出图的节点、要出片的节点都算）。',
  '  「等用户确认」由**系统的确认卡**负责，不是让你在文字里问一句就停下。',
  '- 用户**拒绝**执行时，节点仍然留在画布上（那是他要的结果，只是先不跑）——',
  '  不要把它当成失败去重建一遍。',
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

export interface AgentPromptExtras {
  /**
   * 随这次对话给的素材节点 id（§8）。
   *
   * 只报**节点 id**：素材已经落在画布上了，模型该做的是在 `attach` 里指过去。
   * 不带这句它多半会再建一个，画布上就出现两张一样的素材图。
   */
  assetIds?: readonly string[]
  /** 本会话启用的技能（§14 M4）。正文按 id 现取 —— 技能改了，这次规划跟着变 */
  skill?: { name: string; content: string }
  /**
   * 用户在这句话里 **@ 引用**到的画布节点 / 模型（用户 2026-10-02）。
   *
   * 与「素材」那段的区别：素材是随对话**给进去**的输入，引用是用户在句子里
   * **指到**了某个已有东西 —— 可能是提醒你「就用这张图」，也可能只是
   * 「那个节点改一下」。所以这一段只说清「他指的是谁（含 id）」，不替用户
   * 决定要拿它做什么。
   */
  mentions?: readonly { kind: 'node' | 'model'; id: string; label: string }[]
  /**
   * 用户在对话窗上点选的**图片 / 视频模型**（用户 2026-10-03：「模型有三个选项」）。
   *
   * 系统已经把它们当作建生成节点时的**默认配方**（`recipeForGenerated`），
   * 所以这一段的作用是「让模型知道」而不是「让模型替我们记」：
   * 它写计划时不必再猜用哪个模型，也不会自作主张换成别的。
   */
  mediaModels?: { image?: string; video?: string }
}

/**
 * 完整系统提示词 = 通用三段 + 可选两段（素材 / 技能）。
 *
 * 为什么单独抽成纯函数：这两段**只能靠「发出去的消息」证明它真的生效了**，
 * 界面上看不见。留在组件里就只能靠人工点一遍；抽出来就能用断言钉住
 * 「选了技能 → 正文真的在系统提示词里」。
 */
export function buildAgentSystemPromptWithContext(
  summary: GraphSummary,
  inherited?: { ratio?: string; count?: number; model?: string },
  extras: AgentPromptExtras = {},
): string {
  const parts = [buildAgentSystemPrompt(summary, inherited)]

  const assets = extras.assetIds ?? []
  if (assets.length > 0) {
    parts.push(
      [
        '## 用户随这次对话给的素材（已经在画布上了）',
        ...assets.map((id) => `- 素材节点 ${id}`),
        '要用它们当参考图 / 首帧时，在计划的 attach 里指到这些节点，不要重复建。',
      ].join('\n'),
    )
  }

  if (extras.skill) {
    parts.push(
      [
        '## 本会话启用的技能',
        `技能名：${extras.skill.name}`,
        '按这份技能的要求来规划；它里面的阶段就是你要建到画布上的步骤。',
        '',
        extras.skill.content,
      ].join('\n'),
    )
  }

  const mentions = extras.mentions ?? []
  if (mentions.length > 0) {
    const nodes = mentions.filter((m) => m.kind === 'node')
    const models = mentions.filter((m) => m.kind === 'model')
    const lines = ['## 用户在这句话里 @ 引用到的（他指的是这些东西）']
    if (nodes.length > 0) {
      lines.push('节点：')
      for (const n of nodes) lines.push(`- ${n.id}（${n.label}）`)
    }
    if (models.length > 0) {
      lines.push('模型：')
      for (const m of models) lines.push(`- ${m.label}`)
    }
    lines.push(
      '要复用它就在 attach 里指到那个节点 id，不要重复建同名的节点。',
      '被引用的模型 = 这次就用它（与你按默认值挑的那个冲突时，以他引用的为准）。',
    )
    parts.push(lines.join('\n'))
  }

  const media = Object.entries(extras.mediaModels ?? {}).filter(([, v]) => Boolean(v))
  if (media.length > 0) {
    parts.push(
      [
        '## 这次建出来的生成节点用哪个模型',
        ...media.map(([k, v]) => `- ${k === 'image' ? '图片' : '视频'}：${String(v)}`),
        '系统会按这个配好新节点的默认模型，**你不必在计划里再写一遍**；',
        '也不要用别的模型替掉它（除非用户在这条对话里明确点了另一个）。',
      ].join('\n'),
    )
  }

  return parts.join('\n\n')
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
