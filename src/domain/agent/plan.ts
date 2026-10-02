/**
 * Agent 的产出物：一份**图计划**（设计文档 §3）。
 *
 * 核心约定：agent 不逐步操作画布，而是给出这一份数据，由我们**一次性原子落地**。
 * 好处是可预览、可拒绝、一次撤销、可重放、可单测（都是纯数据）。
 *
 * 这个文件只放**形状与校验**，不放落地逻辑 —— 落地要碰节点规格与命令层，
 * 那是 `features` 的事；领域层保持纯函数，node 下就能测。
 */

/** agent 可以建的节点类型（与现有 7 种一致，不发明新类型） */
export const AGENT_NODE_TYPES = [
  'prompt',
  'generation',
  'fusion',
  'compare',
  'batch',
  'loop',
  'group',
] as const

export type AgentNodeType = (typeof AGENT_NODE_TYPES)[number]

export interface AgentPlanNode {
  /** 计划内部引用用的临时 id，落地时换成真实节点 id */
  localId: string
  type: AgentNodeType
  title?: string
  data: Record<string, unknown>
  /** 第几步（从 0 起）。**坐标不由 agent 给**，我们按它排布 */
  order: number
}

export interface AgentPlanEdge {
  source: string
  target: string
  /** 多口节点（如融合的左原图 / 右局部）用这两个指定端口；缺省即单一入口 */
  sourcePort?: string
  targetPort?: string
}

/** 把计划接到画布上**已有的**节点（例如用户先放了一张素材图），不重复建 */
export interface AgentPlanAttach {
  /** 计划里那个节点的占位 id（不建它，改建到 existingNodeId 上？不——见下） */
  localId: string
  existingNodeId: string
}

export interface AgentPlan {
  /** 一句话说明这份计划在做什么，给用户看的 */
  summary: string
  nodes: AgentPlanNode[]
  edges: AgentPlanEdge[]
  attach?: AgentPlanAttach[]
  /**
   * 每个参数取自哪一层（设计文档 §11）。**只用于预览展示，不进节点数据** ——
   * 计划落地后参数就是参数，不需要在画布里留一串「这个值当时从哪继承来的」。
   */
  paramSources?: Record<string, ParamSource>
}

/** 参数来源的三层，优先级由高到低（设计文档 §11） */
export const PARAM_SOURCES = ['conversation', 'sessionHistory', 'recipe'] as const
export type ParamSource = (typeof PARAM_SOURCES)[number]

export type AgentPlanValidation =
  | { ok: true; plan: AgentPlan; warnings: string[] }
  | { ok: false; errors: string[] }

/**
 * 节点数上限 —— **尚未定案**（设计文档 §13）。先取一个宽松值：
 * 宁可先拦住「几百个节点把画布压垮」，也不要等真出事。等 M1 跑起来拿到实际规模再调。
 */
export const AGENT_PLAN_MAX_NODES = 80

/**
 * 把模型给的计划**归一化**成我们的形状（用户 2026-10-02 报的那个 bug 的正解）。
 *
 * ## 为什么要有这一步
 *
 * 用户原话：「流程都是对的，但是卡在了重复让我确认新建工作流上，重复了三次，
 * 但是我的画布中没有」。链路是：模型给计划 → 界面出确认卡 → 用户点确认 →
 * **这时才校验** → 校验不过（比如某个节点的 `order` 是字符串）→ 整份拒绝 →
 * 错误回给模型 → 它再发一版差不多的 → 又一张确认卡……用户点了三次，画布上什么都没有。
 *
 * 两处都不对：
 * ① 让用户确认一份我们自己会拒绝的计划（这条在 `agentLoop` 的 `precheck` 里解决）；
 * ② 因为**形状细节**整份拒绝，而其中大部分细节我们完全能自己推出来。
 *
 * 这一版先把 ② 做掉：能从别处推出来的字段就补上，并且把「补了什么」记进 `notes`。
 * 真推不出来的（不认识 `type`、`localId` 缺失、连线指向不存在的节点）照旧交给
 * `validateAgentPlan` 拒绝 —— 归一化只补**语义上唯一确定**的那些。
 */
export function normalizeAgentPlan(raw: unknown): { plan: unknown; notes: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { plan: raw, notes: [] }
  const notes: string[] = []
  const src = raw as Record<string, unknown>

  const nodesRaw = Array.isArray(src.nodes) ? src.nodes : []
  /** 缺 order 的节点：等连线读完再按拓扑深度补 */
  const needOrder: string[] = []

  const nodes = nodesRaw.map((n) => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return n
    const node = { ...(n as Record<string, unknown>) }
    /**
     * 别名：模型时不时把 `localId` 写成 `id` / `local_id` / `key`。
     * 这不是「猜」—— 计划里那个字段的唯一含义就是「本地的临时 id」。
     */
    if (typeof node.localId !== 'string' || !node.localId.trim()) {
      const alias = node.local_id ?? node.id ?? node.key
      if (typeof alias === 'string' && alias.trim()) {
        node.localId = alias.trim()
        notes.push(`节点 ${node.localId}：localId 是从别名补的`)
      }
    }
    /** data 缺了就给空对象：它的含义明确是「这个节点的参数」，空 = 用默认值 */
    if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) {
      if (node.data !== undefined) notes.push(`节点 ${String(node.localId)}：data 不是对象，已按空对象处理`)
      node.data = {}
    }
    /** order：数字直接用；数字字符串转成数字；其余留给拓扑推导 */
    const order = node.order
    if (typeof order === 'string' && /^\d+$/.test(order.trim())) {
      node.order = Number(order.trim())
      notes.push(`节点 ${String(node.localId)}：order 是字符串，已转成数字`)
    } else if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) {
      delete node.order
      if (typeof node.localId === 'string') needOrder.push(node.localId)
    }
    return node
  })

  const edgesRaw = Array.isArray(src.edges) ? src.edges : []
  /**
   * 连线的端点：模型写过 `"p1"`、也写过 `{ localId: "p1" }` / `{ id: "p1" }`。
   * 两种都认（只认「本地 id」这一个含义，不是猜）。
   */
  const endpointId = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v.trim() || undefined
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      const inner = o.localId ?? o.id ?? o.local_id ?? o.key
      if (typeof inner === 'string' && inner.trim()) return inner.trim()
    }
    return undefined
  }
  const edges = edgesRaw.map((e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return e
    const edge = { ...(e as Record<string, unknown>) }
    /**
     * 别名：`from` / `to` / `sourceId` / `sourceNode` / `start` … 都是同一件事。
     * 实测真模型（Agnes 2.5 Pro）会用 `sourceNode` / `targetNode` 这种写法，
     * 只认四个名字的话整份计划会以「起点不存在：undefined」被拒。
     */
    if (edge.source === undefined || endpointId(edge.source) === undefined) {
      const alias =
        edge.from ??
        edge.sourceId ??
        edge.sourceLocalId ??
        edge.sourceNode ??
        edge.fromNode ??
        edge.start
      if (alias !== undefined) {
        edge.source = alias
        notes.push('连线：source 是从别名补的')
      }
    }
    if (edge.target === undefined || endpointId(edge.target) === undefined) {
      const alias =
        edge.to ??
        edge.targetId ??
        edge.targetLocalId ??
        edge.targetNode ??
        edge.toNode ??
        edge.end
      if (alias !== undefined) {
        edge.target = alias
        notes.push('连线：target 是从别名补的')
      }
    }
    if (edge.sourcePort === undefined && edge.source_port !== undefined) {
      edge.sourcePort = edge.source_port
    }
    /**
     * 端点是对象时**取出里面的本地 id**（`{ localId }` / `{ id }` / `{ key }`）。
     * 这一步放在别名处理之后：两种写法都要落到同一个字符串上。
     */
    const srcId = endpointId(edge.source)
    if (srcId !== undefined) edge.source = srcId
    const tgtId = endpointId(edge.target)
    if (tgtId !== undefined) edge.target = tgtId
    if (edge.targetPort === undefined && edge.target_port !== undefined) {
      edge.targetPort = edge.target_port
    }
    return edge
  })

  /**
   * 缺 order 的按**拓扑深度**补：列 = 第几步，与 `layoutAgentPlan` 的口径一致。
   * 有环时那一支回落到 0 —— 布局挤一挤，也比整份拒绝强（反正连线还在，
   * 用户看得出来哪里不对）。
   */
  if (needOrder.length > 0) {
    const depth = topoDepth(nodes, edges)
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const at = node as Record<string, unknown>
      if (typeof at.order === 'number') continue
      const id = typeof at.localId === 'string' ? at.localId : ''
      at.order = depth.get(id) ?? 0
    }
    notes.push(`${needOrder.length} 个节点没有可用的 order，已按连线推导`)
  }

  /**
   * **节点名**：用户 2026-10-03 的要求 —— agent 建出来的节点要**照着提示词总结**出
   * 一个名字，不能是「图片节点1」这种跟内容无关的通用名。
   *
   * 系统提示词里已经要求模型给 `title`，但它经常不给（尤其小模型）。不给就退回
   * `spec.label`（「图片生成」「提示词」）—— 用户看到的正是这种没有信息量的名字。
   * 所以这里**确定性地补一道**：从节点自己的提示词正文取头一句的前 12 个字；
   * 自己没正文（比如下游的生成节点只靠上游的提示词）就顺着入边借上游那句。
   *
   * 只在前两步都拿不到时才轮到 `spec.label` —— 那是最差的一档，不是默认档。
   */
  const byLocalId = new Map<string, Record<string, unknown>>()
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const row = n as Record<string, unknown>
    if (typeof row.localId === 'string') byLocalId.set(row.localId, row)
  }
  const parentsOf = (id: string): string[] => {
    const out: string[] = []
    for (const e of edges) {
      if (!e || typeof e !== 'object') continue
      const row = e as Record<string, unknown>
      if (row.target === id && typeof row.source === 'string') out.push(row.source)
    }
    return out
  }
  let titled = 0
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const row = n as Record<string, unknown>
    if (typeof row.title === 'string' && row.title.trim()) continue
    const own = promptTextOf(row)
    const borrowed =
      own || parentsOf(String(row.localId ?? '')).map((p) => promptTextOf(byLocalId.get(p))).find(Boolean)
    const title = summarizeTitle(borrowed ?? '')
    if (title) {
      row.title = title
      titled += 1
    }
  }
  if (titled > 0) notes.push(`${titled} 个节点没有名字，已按提示词总结`)

  /** summary 缺了就补一句能读懂的话：它在确认卡上当标题，空着用户不知道在批什么 */
  if (typeof src.summary !== 'string' || !src.summary.trim()) {
    notes.push('缺 summary，已用兜底文案')
  }

  return {
    plan: {
      ...src,
      ...(typeof src.summary === 'string' && src.summary.trim()
        ? {}
        : { summary: '按你的要求建一份工作流' }),
      nodes,
      edges,
    },
    notes,
  }
}

/** 节点里能当「提示词正文」用的字段（提示词节点是 `text`，生成节点是 `prompt`） */
function promptTextOf(node: Record<string, unknown> | undefined): string {
  if (!node) return ''
  const data = node.data
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  for (const key of ['text', 'prompt'] as const) {
    const v = d[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}

/**
 * 提示词 → 节点名：取**第一行**、把空白收成单个空格、截到 12 个字。
 *
 * 为什么截 12：节点标题栏就那么宽（再长会被省略号吃掉，等于没有）。
 * 为什么不加省略号：标题带省略号看起来像「还没起完名」，而它其实已经定稿了。
 */
export function summarizeTitle(text: string): string {
  const firstLine = String(text ?? '').split('\n')[0] ?? ''
  return firstLine.replace(/\s+/g, ' ').trim().slice(0, 12)
}

/**
 * 生成节点的 `mode` **以模型自己的类别为准**。
 *
 * 用户 2026-10-03 让我「用 agent 做一支视频」时实测到的：计划建出来了，但视频节点
 * 点了生成**一个请求都不发**。根因是真模型（Agnes 2.5 Pro）把视频节点写成了
 * `mode: "image"` —— 它把「生成节点」默认当图片档，只在 `model` 上写了
 * `Agnes Video 2.0`；而**执行层是按 `mode` 分链的**，于是视频模型被塞进生图链路，
 * 请求根本组不出来。
 *
 * 两种改法都对得上：模型是视频模型而 mode 不是 video → 改成 video；模型是图片模型
 * 而 mode 却是 video → 改回 image。认不出类别（渠道没配、名字对不上）就**不动** —— 不猜。
 */
export function alignGenerationMode(
  plan: AgentPlan,
  categoryOf: (model: string) => 'image' | 'video' | 'chat' | undefined,
): { plan: AgentPlan; notes: string[] } {
  const notes: string[] = []
  const nodes = plan.nodes.map((n) => {
    if (n.type !== 'generation') return n
    const data = (n.data ?? {}) as Record<string, unknown>
    const model = typeof data.model === 'string' ? data.model.trim() : ''
    if (!model) return n
    const category = categoryOf(model)
    if (category !== 'video' && category !== 'image') return n
    const want = category === 'video' ? 'video' : 'image'
    if (data.mode === want) return n
    notes.push(
      `节点「${n.title || n.localId}」：mode 由 ${String(data.mode ?? '(空)')} 改成 ${want}（跟着模型 ${model} 走）`,
    )
    return { ...n, data: { ...data, mode: want } }
  })
  return notes.length > 0 ? { plan: { ...plan, nodes }, notes } : { plan, notes }
}

/** 节点 → 它所在的「第几步」：没有入边 = 0，否则 = max(前驱)+1 */
function topoDepth(nodes: readonly unknown[], edges: readonly unknown[]): Map<string, number> {
  const idOf = (n: unknown): string => {
    if (!n || typeof n !== 'object') return ''
    const v = (n as Record<string, unknown>).localId
    return typeof v === 'string' ? v : ''
  }
  const preds = new Map<string, string[]>()
  for (const n of nodes) {
    const id = idOf(n)
    if (id) preds.set(id, [])
  }
  for (const e of edges) {
    if (!e || typeof e !== 'object') continue
    const raw = e as Record<string, unknown>
    const s = typeof raw.source === 'string' ? raw.source : ''
    const t = typeof raw.target === 'string' ? raw.target : ''
    if (preds.has(s) && preds.has(t)) preds.get(t)!.push(s)
  }
  const depth = new Map<string, number>()
  const onStack = new Set<string>()
  const walk = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (onStack.has(id)) return 0 // 环：就地兜底
    onStack.add(id)
    const parents = preds.get(id) ?? []
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((p) => walk(p) + 1))
    onStack.delete(id)
    depth.set(id, value)
    return value
  }
  for (const id of preds.keys()) walk(id)
  return depth
}

/**
 * 校验一份计划能不能落地。
 *
 * 原则：**整份拒绝，不做部分落地**。部分落地会让用户面对一个「建了一半」的画布，
 * 还得自己判断哪半是对的 —— 比直接报错难收拾得多。
 *
 * `existingNodeIds` 传入画布上已有的节点 id：`attach` 要指到真节点上，
 * 指不到就是模型编的，必须拦（否则会出现「计划说复用了某节点，实际那节点不存在」）。
 */
export function validateAgentPlan(
  raw: unknown,
  existingNodeIds: readonly string[] = [],
): AgentPlanValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['计划不是对象'] }
  }
  const plan = raw as Partial<AgentPlan>

  if (typeof plan.summary !== 'string' || !plan.summary.trim()) {
    errors.push('缺少 summary（一句话说明这份计划在做什么）')
  }
  if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    errors.push('计划里一个节点都没有')
    return { ok: false, errors }
  }
  if (plan.nodes.length > AGENT_PLAN_MAX_NODES) {
    return {
      ok: false,
      errors: [`计划太大：${plan.nodes.length} 个节点，上限 ${AGENT_PLAN_MAX_NODES}`],
    }
  }
  if (!Array.isArray(plan.edges)) errors.push('edges 必须是数组（没有连线就给空数组）')

  const ids = new Set<string>()
  for (const [i, node] of plan.nodes.entries()) {
    const where = `第 ${i + 1} 个节点`
    if (!node || typeof node !== 'object') {
      errors.push(`${where} 不是对象`)
      continue
    }
    if (typeof node.localId !== 'string' || !node.localId.trim()) {
      errors.push(`${where} 缺少 localId`)
    } else if (ids.has(node.localId)) {
      errors.push(`localId 重复：${node.localId}`)
    } else {
      ids.add(node.localId)
    }
    if (!AGENT_NODE_TYPES.includes(node.type)) {
      errors.push(`${where} 的类型不认识：${String(node.type)}（只能是 ${AGENT_NODE_TYPES.join(' / ')}）`)
    }
    if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) {
      errors.push(`${where} 的 data 必须是对象`)
    }
    if (!Number.isInteger(node.order) || node.order < 0) {
      errors.push(`${where} 的 order 必须是从 0 起的整数`)
    }
  }

  const edges = Array.isArray(plan.edges) ? plan.edges : []
  const seenEdges = new Set<string>()
  for (const [i, edge] of edges.entries()) {
    const where = `第 ${i + 1} 条连线`
    if (!edge || typeof edge !== 'object') {
      errors.push(`${where} 不是对象`)
      continue
    }
    if (!ids.has(edge.source)) errors.push(`${where} 的起点不存在：${String(edge.source)}`)
    if (!ids.has(edge.target)) errors.push(`${where} 的终点不存在：${String(edge.target)}`)
    if (edge.source === edge.target) errors.push(`${where} 自己连自己`)
    const key = `${edge.source}->${edge.target}:${edge.sourcePort ?? ''}:${edge.targetPort ?? ''}`
    if (seenEdges.has(key)) errors.push(`${where} 与之前的连线重复`)
    seenEdges.add(key)
  }

  for (const [i, at] of (plan.attach ?? []).entries()) {
    const where = `第 ${i + 1} 条 attach`
    if (!at || typeof at !== 'object') {
      errors.push(`${where} 不是对象`)
      continue
    }
    if (!ids.has(at.localId)) errors.push(`${where} 的 localId 不在计划里：${String(at.localId)}`)
    if (existingNodeIds.length > 0 && !existingNodeIds.includes(at.existingNodeId)) {
      errors.push(`${where} 指向的节点不在画布上：${String(at.existingNodeId)}`)
    }
  }

  // paramSources 只影响预览展示，写错不致命 —— 但也别让非法值悄悄流到界面上
  if (plan.paramSources !== undefined) {
    if (typeof plan.paramSources !== 'object' || plan.paramSources === null) {
      errors.push('paramSources 必须是对象')
    } else {
      for (const [field, source] of Object.entries(plan.paramSources)) {
        if (!PARAM_SOURCES.includes(source as ParamSource)) {
          errors.push(`paramSources.${field} 的来源不认识：${String(source)}`)
        }
      }
    }
  }

  // 孤立节点只是可疑，不是错误：单节点流程（只建一个提示词）完全合法
  const connected = new Set<string>()
  for (const e of edges) {
    connected.add(e.source)
    connected.add(e.target)
  }
  const lonely = plan.nodes.filter((n) => n && !connected.has(n.localId)).map((n) => n.localId)
  if (lonely.length > 1) {
    warnings.push(`有 ${lonely.length} 个节点没连任何线：${lonely.join('、')}`)
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: plan as AgentPlan, warnings }
}
