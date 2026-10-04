import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { GENERATION_PARAM_KEYS } from '../../../domain/canvas/nodeSpecs/newNodePreset'
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
  /**
   * 用户 2026-10-04 第 4 条：「单独生成图片应该是直接一个生成节点就可以了，
   * 然后把提示词输入进去再向我确认生成，当前是流程是新建了一个提示词节点和连接的生成节点」。
   *
   * 模型这么建不是没道理 —— 画布的**文生图模板**就是「提示词 + 生成」两个节点，
   * 它照着模板抄。但用户要的是「一句话出一张图」时最少的那张图。
   * 归一化（`normalizeAgentPlan`）里还有一道**确定性的合并**兜底，这里先把意图讲清楚。
   */
  '- **单步生成只建一个生成节点**：提示词直接写进它的 data.prompt。',
  '  不要再额外建一个提示词节点 —— 那个中间节点只在两种情况下才建：',
  '  ① 用户明确要一段可复用的提示词；② 同一段提示词要喂给多个下游节点。',
  /**
   * 用户 2026-10-04：「他给我的是一个提示词节点连接两个生图节点，整体的流程是对的，
   * 但是**没有提示词**」。真机数据实证：模型把正文写进了 `data.prompt`，而提示词
   * 节点读的是 `data.text` —— 结构全对、正文落空，画布上就是个空框。
   *
   * 词表里已经逐类型列出数据字段（见 `buildCanvasVocabulary`），这里再把最容易错的
   * 那一对写死一遍：字段名写错**不会报错**，只会静默出个空节点，模型根本意识不到。
   */
  '- 节点正文的**字段名不能写错**：提示词节点写 `data.text`，生成 / 批量 / 分组节点写',
  '  `data.prompt`。写错不会报错，但画布上那个框是空的、生成节点也跑不出图。',
  '- 生成参数也用**画布的键名**：比例是 `data.ratio`（**不是** `aspectRatio`）、清晰度',
  '  `data.resolution`、画质 `data.quality`、数量 `data.count` —— 自己起名等于没写，',
  '  参数会悄悄退回默认值（用户说了 1:1 却出 9:16，就是这么来的）。',
  '- 想复用画布上已有的节点（比如用户先放好的素材图），用 attach 指过去，不要重复建。',
  '',
  /**
   * 改图 / 再来一版的语义（用户 2026-10-05 第五批第 2 / 3 / 4 条）。
   *
   * 真机表现：用户先让 agent 出了一张「小猫钓鱼」，接着说「把小猫替换成小狗，其他保持不变」——
   * 模型走了 `updateNode` 把**那个已经出图的节点**的 `data.prompt` 整句覆盖掉，
   * 于是 ① 上一版的提示词（历史记录）没了；②「其他保持不变」这条要求只留在对话里，
   * 没有进提示词；③ 再往下「用这两张图再生成」时它又是改原节点重跑，
   * 而不是新建下游节点把那两张图当上游。
   *
   * 这一段就是那次事故的规矩。`executeConfirmedTool('updateNode')` 里还有一道
   * **确定性拦截**（出过图的节点不许改正文）—— 提示词是软的，那道是硬的。
   */
  '## 改图 / 再来一版：新建节点，别动旧节点',
  '- 用户说「再改一版 / 换掉某个东西 / 加一个东西 / 把某张图当参考再生成」时：',
  '  **新建一个生成节点**（或按需要新建提示词节点），把要参考的图用 attach 接成它的上游，',
  '  把这次的新提示词写在**新节点**上，然后 runNode 跑新节点。',
  '- **不要**用 updateNode 去改一个已经出过图的节点的正文 —— 那是把它上一版的提示词擦掉，',
  '  用户就没法回头看出「上次到底写了什么」。updateNode 只用来改**生成参数**',
  '  （比例 / 张数 / 模型 / 时长这种），而且只在用户点名要调参数时才用。',
  '- 用户的话里带「其他保持不变 / 其余不变 / 只改 X」时，**写进节点的提示词必须把这条约束说出来**：',
  '  把原来那句画面的描述整段保留，末尾追加一句「只把 X 改成 Y，其余（构图、背景、光线、风格、姿态）保持不变」。',
  '  只写「小狗钓鱼」这种重写句 = 把用户那句「保持不变」丢了。',
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
    /**
     * **数据字段也报出来**（用户 2026-10-04 的字段名事故）。
     *
     * 原词表只说「有哪些类型 / 能接谁 / 有哪些端口」，一个字没提 `data` 里该写什么键 ——
     * 模型只能猜，而它猜错了（正文写进 `data.prompt`，提示词节点读的却是 `data.text`），
     * 结果是「结构全对、正文落空」：不报错、也看不出来。
     *
     * 字段名从 `createDefaultData()` 现取，与节点定义同源 —— 加了字段词表跟着变。
     */
    const data = spec.createDefaultData() as Record<string, unknown>
    const keys = Object.keys(data)
    if (keys.length > 0) lines.push(`  data 字段：${keys.join(' · ')}`)
    const textKey = textFieldOf(data)
    if (textKey) lines.push(`  正文写在 data.${textKey}`)
    /**
     * **生成参数也住在 `data` 里**，但它们的键**不在 `createDefaultData()` 里**
     * （那些是「这一张怎么生成」的可选设置，由创作面板 / 配方补）——
     * 于是词表原先一个字都没提，模型只能按自己的习惯起名：真机上两次都把比例写成
     * `aspectRatio`（用户 2026-10-04：「比例不是按照我的要求」，出图 1152×2048）。
     *
     * 键名从 `GENERATION_PARAM_KEYS`（写进节点数据的**白名单**，与新建节点同源）现取，
     * 再加一句最容易被猜错的：比例是 `ratio`。
     */
    if (spec.type === 'generation' || spec.type === 'batch' || spec.type === 'group') {
      lines.push(`  生成参数（同样写在 data 里，键名照抄）：${GENERATION_PARAM_KEYS.join(' · ')}`)
      lines.push('  比例写 data.ratio —— 不要写成 aspectRatio / aspect_ratio，那个键我们不读，')
      lines.push('  比例会退回默认值（用户明明说了 1:1，出图却是 9:16，就是这么来的）。')
    }
  }
  return lines.join('\n')
}

/**
 * 这份 `data` 里哪个字段是**正文**（提示词节点是 `text`，生成 / 批量 / 分组是 `prompt`）。
 *
 * 从 `createDefaultData()` 的键里挑，不另写一份名单 —— 与词表同源，加了新节点也不会漏。
 * 挑不出来（融合 / 对比 / 循环）就返回 undefined：那些节点的 data 里没有「一句话」。
 */
function textFieldOf(data: Record<string, unknown>): string | undefined {
  for (const key of ['text', 'prompt'] as const) {
    if (typeof data[key] === 'string') return key
  }
  return undefined
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
   * 用户这句话是不是「只改一处、其余保持」那一类（见 `looksLikePreserveRequest`）。
   *
   * 用户 2026-10-05 第五批第 2 条：「我生成一个小猫钓鱼后，说明是把小猫替换成小狗，
   * 其他保持不变，但是出的提示词并没有这方面的约束」—— 这条约束只在对话里出现过，
   * 没有被带进提示词。由调用方判定后，这里再加一段**这次专属的硬约束**。
   */
  preserve?: boolean
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

  if (extras.preserve) {
    parts.push(
      [
        '## 这一次的硬约束：用户说了「其他保持不变」',
        '你写进节点 `data.prompt`（提示词节点是 `data.text`）的那句话必须**同时**包含两件事：',
        '① **原来画面里该保留的全部描述** —— 把已有节点上那句提示词整段带上，不要另起一句重写；',
        '② 一句显式的约束：「只把 <要改的> 换成 <新的>，其余（构图、背景、光线、风格、姿态）保持不变」。',
        '并且**新建节点**来放这次的新提示词（要参考的图用 attach 接成它的上游），不要改旧节点的正文。',
      ].join('\n'),
    )
  }

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
      '被引用的模型 = 这次就用它（与工具条上挑的那个冲突时，以他引用的为准）。',
      /**
       * 用户 2026-10-04 第 3 条：「是把模型放在对话框中，意思是用这些模型进行生成，
       * 能组成多个模型参与的流程」—— 一次 @ 多个模型是**正常用法**，不是冲突，
       * 要让模型按用户给的顺序把它们分配到对应的节点上。
       */
      '用户可以一次 @ 好几个模型：那就按他给的顺序**分别用在对应的生成节点上**，',
      '组成一条多模型参与的流程（例如先用 A 出图、再用 B 改图），不要只挑一个。',
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

/**
 * 用户这句话是不是「只改一处、其余保持」那一类。
 *
 * 判据取用户**自己的原话**（调用方已经把 @ 引用标记还原成普通文字）。宁可多命中一点：
 * 多给模型一句「别的都不许变」没有副作用；漏掉的话，那句要求就只留在对话里、
 * 进不了提示词 —— 正是用户 2026-10-05 第五批第 2 条报的现象。
 */
export function looksLikePreserveRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (!t) return false
  return /保持不变|其余不变|其他(都)?不变|其他(都)?(别|不要)(动|改)|其余(都)?(照旧|保持)|只(改|换|替换|把)|其余的?不动/.test(
    t,
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
