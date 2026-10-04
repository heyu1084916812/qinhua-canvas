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
   * 计划自身的**字段名**（用户 2026-10-06 真机事故：连试六轮都建不成）。
   *
   * 原来这里只有「用 attach 指过去」这种白话，`localId` / `existingNodeId` 这两个真正的
   * 键名**一次都没出现过**；工具 schema 那边也把 `nodes` / `edges` / `attach` 声明成了
   * 光秃秃的 `{ type: 'object' }`。模型无处可查，只能猜 —— 猜错就得到
   * 「第 1 条 attach 的 localId 不在计划里：undefined」，猜不出来就编一个 `cat_ref_1`，
   * 或者把画布节点 id 直接当连线起点。
   *
   * 这一段与 `tools.ts` 里 `applyPlan` 的 schema **是同一件事的两处出口，必须同时给**：
   * schema 是结构化契约（多数模型照着它填），这段给 schema 支持不好的渠道兜底。
   */
  '',
  '## applyPlan 的字段名（照抄，别自己起名）',
  '- 计划 = `{ summary, nodes[], edges[], attach[] }`。',
  '- `nodes[]`：`{ localId, type, data, order }`（title 也建议给）。`localId` 是你自己起的',
  '  **临时名**，计划内唯一；连线与 attach 都用它引用，落地时系统换成真实节点 id。',
  '- `edges[]`：`{ source, target }`，两端都填 **localId** —— **不要填画布上的真实节点 id**。',
  '- `attach[]`：`{ localId, existingNodeId }`。某个节点**不新建、直接使用画布上已有的那个**',
  '  （比如用户先放好的素材图，你要拿它当上游）时用它：`localId` 照旧是计划里的临时名，',
  '  `existingNodeId` 填画布上那个节点的真实 id（画布摘要里 `node_xxx` 那一串）。',
  '  注意：**那个节点仍然要出现在 `nodes[]` 里**（同一个 `localId`）—— `attach` 只是告诉系统',
  '  「它不新建」。',
  /**
   * 「attach ≠ 连线」这条必须写死（用户 2026-10-06 第七批 #185）。
   *
   * 真机（图三）：@ 了一张图 +「加一个小狗在旁边」，模型把图 attach 了、却**没有写那条边**
   * （还编了个不存在的 `cat_gpt` 当起点），结果新节点一个上游都没有 —— 那次生成退化成了
   * 「照提示词重画一张」，用户要的「其余参考参考图保持不变」根本没生效。
   * 用户原话：「**明确说明作为参考图之后才会有连线**」。
   *
   * 系统那侧有一道确定性兜底（`buildLandingCommand` 的 `withReferenceEdges`：attach 了有图的
   * 节点却没连，就替你连上），但**不能只靠兜底**：兜底的配对规则是猜的，模型自己写才对得上。
   */
  '- ⚠️ **`attach` 只是「复用哪个节点」，不等于连上了线。** 要把那张图当参考图，',
  '  **必须在 `edges` 里再写一条**从它的 `localId` 指向新节点的边 —— 只写 attach 不写边，',
  '  那次生成就吃不到参考图（等于照提示词重画一张）。',
  /**
   * 「几张图 = 几条独立流程」（用户 2026-10-06 第七批 #183）。
   *
   * 图一/图二里用户都说了「单独」/ 分别处理两张图，模型却把它们并成一条流程，
   * 于是两个需求被办成一个。用户原话：「明明是单独的两个需求他给我替换成了一个需求」。
   */
  '- **用户 @ 了几张图，就建几条独立的流程**（一张图配一个生成节点、各自连各自的边）。',
  '  他说「单独 / 分别 / 各」，或者同一句话里点了多张图，都要这样办 —— 别把它们并成一个节点。',
  '',
  '  例（把已有的两张图接成一个新生成节点的上游）：',
  '  `{"summary":"再出一版","nodes":[',
  '    {"localId":"src1","type":"generation","title":"小猫钓鱼","data":{},"order":0},',
  '    {"localId":"g1","type":"generation","title":"3D 毛绒版",',
  '     "data":{"mode":"image","prompt":"……"},"order":1}],',
  '   "edges":[{"source":"src1","target":"g1"}],',
  '   "attach":[{"localId":"src1","existingNodeId":"node_3efb3edc"}]}`',
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
  /**
   * 模型与参数的**继承**：用户 2026-10-06 定的口径。
   *
   * 「先读我提供的节点素材是什么生成模型就用什么生成模型，是什么参数就用什么参数；
   *  如果需要其他的模型生成的话，用户会在对话框中输入模型和参数；
   *  如果用户只提供了另外的模型的话，参数就按照之前的模型的参数来设置」。
   *
   * 这件事由**落地层**确定性地做（`buildLandingCommand` 的 `recipeFromAttached`：
   * 从被 attach 的节点读 `RECIPE_TRACKED_KEYS` 那一组字段），所以这里只要跟模型讲
   * 「不用你抄，也别乱填」—— 它抄漏一项就会把用户那张图的参数换成渠道默认值。
   */
  '- **模型与生成参数默认沿用你 @ 的那张图**：系统会自己从那个节点读出模型 / 比例 / 画质 /',
  '  张数等一整套参数填到新节点上，**不用你抄进计划**（抄漏一项反而会退回默认值）。',
  '  只有用户**点名要换**的东西才写进计划的 `data`：他说「用 X 模型」就只写 `model`',
  '  （其余参数照样沿用那张图的）；他还一起说了参数，就把参数也一并写上。',
  '- **不要**用 updateNode 去改一个已经出过图的节点的正文 —— 那是把它上一版的提示词擦掉，',
  '  用户就没法回头看出「上次到底写了什么」。updateNode 只用来改**生成参数**',
  '  （比例 / 张数 / 模型 / 时长这种），而且只在用户点名要调参数时才用。',
  /**
   * 「都改」= 一次确认（用户 2026-10-06 第七批 #187）。
   *
   * 用户原话：「我说八张都改模型的时候还需要我一个一个的确认，这不符合逻辑，
   * 这种改动应该一次性让我确认即可」。真机截图：「八张都改刚刚的那个模型」后面
   * 跟了 7 次「已改节点参数」——每一次都要点确认。
   */
  '- 用户说「**都改 / 全部 / 这几张都改**」时要改多个节点：**用 `nodeIds` 一次改完**，',
  '  不要一次一个节点地调 updateNode —— 那会让他确认八次。一次意图只确认一次。',
  '- 用户的话里带「其他保持不变 / 其余不变 / 只改 X」时，**提示词必须把这条约束说出来**，',
  '  但**写法分两种**（混用的代价很大，见下面那条真机事故）：',
  '  ① 要改的是**画面属性**（材质 / 风格 / 画质 / 光线 / 分辨率）**且这次接了参考图**：',
  '     **不要复述画面内容**，只写「把 X 改成 Y，其余严格按参考图保持不变',
  '     （构图、角色与数量、姿态、背景、光线都不变）」。',
  '     ── 参考图才是内容的准；用文字复述内容反而会跟图打架（复述漏了谁，谁就没了）。',
  '  ② 要改的是**内容本身**（换角色 / 加东西 / 改动作）：把改动写清楚，并把「其余照原样」一并写上。',
  '  只写「小狗钓鱼」这种重写句 = 把用户那句「保持不变」丢了。',
  /**
   * 换风格 vs 换内容（用户 2026-10-05 第六批：「我让他换成 3d 风格，但是他前面给我加了
   * 前置词小猫钓鱼，结果把内容也给我换成小猫去了，本来应该是只换成 3d 风格的」）。
   *
   * 真机根因：摘要里原先**只有节点名、没有正文**，模型手上唯一的文字就是 title
   * （「小猫钓鱼」），于是它把**节点名当成了画面内容** —— 换风格变成了重画一只猫。
   * 现在摘要与 @ 引用那段都会带上正文（`readGraphSummary` 的 `prompt`），这条规则才有落脚点。
   */
  '- 换风格（「换成 3D / 写实 / 卡通 / 水彩」）是**只改风格**：接了参考图时**不要复述画面内容**，',
  '  只写风格要求 + 「其余严格按参考图保持不变」。',
  '  **绝对不要把节点名当内容**：「小猫钓鱼」是给人看的短名，它既不是画面描述、也不该出现在新提示词里。',
  /**
   * 正文可能过时（用户 2026-10-06：截图里那轮又出现了「小猫钓鱼」这个前置词）。
   *
   * 真机取证：被 @ 的那个节点正文原文是
   * 「小猫钓鱼，3D渲染风格，可爱，河边，猫拿着鱼竿，水面倒映，阳光明媚，柔和光影，圆润造型」——
   * 开头那三个字**不在用户这次的指令里**，是上一轮 agent 自己写进节点正文的；而那张图
   * 明明是「小猫和小狗一起钓鱼」（出图模型当时自己加了狗，正文没跟着更新）。
   *
   * 于是「把原来的描述整段保留」这条规则在这类场景下**会帮倒忙**：把一段与画面不符的文字
   * 原样带进新提示词，等于用文字把图上多出来的角色抹掉。所以把「以图为准」写死在这里。
   */
  '- **节点正文可能已经过时**：它是上一轮写下的文字，图未必照着它长（真机事故：正文只写了',
  '  「小猫」，图上其实还有一只小狗）。**图文不一致时以图为准** —— 不要把它复述成新提示词的开头。',
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
        `- ${n.id}｜${n.type}${n.title ? `｜${n.title}` : ''}${n.hasOutput ? '｜已出图' : ''}${
          n.prompt ? `｜提示词：${n.prompt}` : ''
        }`,
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
   * 用户这句话是不是「只换风格」那一类（见 `looksLikeStyleOnlyRequest`）。
   *
   * 用户 2026-10-05 第六批：「换成 3d 风格…结果把内容也给我换成小猫去了」——
   * 与 `preserve` 同一类毛病（要求没进提示词），但**约束的内容不同**：
   * 这里要的不是「保持不变」，而是「**以原来的提示词为内容主体，只追加风格**」。
   */
  styleOnly?: boolean
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
  mentions?: readonly {
    kind: 'node' | 'model'
    id: string
    label: string
    /** 被引用节点上的正文（带上了模型才可能「保留内容、只改风格」，见 §3 / 第六批） */
    prompt?: string
  }[]
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
        '你写进节点 `data.prompt`（提示词节点是 `data.text`）的那句话必须把这条约束说出来，但**分两种写法**：',
        '① 改的是**画面属性**（材质 / 风格 / 画质 / 光线）且这次**有参考图**：**不要复述画面内容**，',
        '   只写「把 <要改的> 换成 <新的>，其余严格按参考图保持不变',
        '   （构图、角色与数量、姿态、背景、光线都不变）」。',
        '   ── 参考图才是内容的准。复述内容一旦漏了谁，谁就没了。',
        '② 改的是**内容本身**（换角色 / 加东西 / 改动作）：把改动写清楚，再补一句「其余照原样」。',
        '并且**新建节点**来放这次的新提示词（要参考的图用 attach 接成它的上游），不要改旧节点的正文。',
      ].join('\n'),
    )
  }

  if (extras.styleOnly) {
    parts.push(
      [
        '## 这一次的硬约束：只换风格，内容照原样',
        '用户要的是**换风格**，不是换内容。新节点的 `data.prompt` 必须这样写：',
        '① **不要复述画面内容** —— 接一张参考图就够了；节点正文可能已经过时，图文不一致时以图为准。',
        '   上面「现在这张画布上有什么」与「@ 引用到的」里的正文只用来**理解用户指的是哪张图**，',
        '   不是拿来抄进新提示词的。',
        '② 只写风格要求（例如「3D 渲染风格」）+ 「其余严格按参考图保持不变',
        '   （内容、构图、角色与数量、背景、光线都不变）」。',
        '③ **绝对不要拿节点名当内容**：节点名是给人看的短名（「小猫钓鱼」），不是画面描述。',
        '④ **新建节点**承载这次的新提示词（参考图用 attach 接成上游），旧节点的正文一个字都不改。',
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
      for (const n of nodes) {
        lines.push(`- ${n.id}（${n.label}）${n.prompt ? `｜它上面的提示词：${n.prompt}` : ''}`)
      }
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

/**
 * 用户这句话是不是「只换风格」那一类。
 *
 * 判据：**同时**出现「风格类词」与「改动类词」。
 * 只看其中一边都不够：「小猫钓鱼」这句画面描述里有「画」字但没有风格词；
 * 而「换个背景」有改动词却没有风格词 —— 那种属于 `preserve`（只改一处、其余不变）。
 *
 * 宁可多命中：多一段硬约束没有副作用；漏掉的话模型会拿节点名当内容重画一张。
 */
export function looksLikeStyleOnlyRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (!t) return false
  const styleWord = /风格|画风|质感|渲染|3d|三维|写实|卡通|动漫|水彩|油画|像素|赛博|国风|素描|手绘|黏土/i.test(
    t,
  )
  const changeWord = /换|改|变|转|做成|弄成|调成/.test(t)
  return styleWord && changeWord
}

/** 供测试与诊断：把节点快照转成摘要（与 tools.readGraphSummary 同源语义） */
export function summarizeForPrompt(nodes: NodeSnapshot[]): GraphSummary {
  return {
    nodes: nodes.map((n) => {
      const data = n.data as { assetHash?: unknown; prompt?: unknown; text?: unknown }
      const raw = typeof data.prompt === 'string' ? data.prompt : data.text
      const prompt = typeof raw === 'string' ? raw.trim().slice(0, 160) : ''
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        hasOutput: Boolean(data.assetHash),
        ...(prompt ? { prompt } : {}),
      }
    }),
    edges: [],
  }
}
