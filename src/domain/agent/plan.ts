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
