import type { AgentPlan } from './plan'

/**
 * 计划 → 画布：**布局**与**落地自检**（设计文档 §4 / §4.1）。
 *
 * 两个纯函数，都不碰 store：布局给坐标，自检比图。这样「图有没有长对」可以
 * 在 node 下单测，不必起浏览器 —— 而它恰恰是最该被钉死的一环（用户 2026-10-01：
 * 「每次落地完，我需要你验证」）。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface GraphNodeView {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
}

export interface GraphEdgeView {
  source: string
  target: string
  sourcePort?: string
  targetPort?: string
}

export interface AgentGraphView {
  nodes: GraphNodeView[]
  edges: GraphEdgeView[]
}

const DEFAULT_SOURCE_PORT = 'output'
const DEFAULT_TARGET_PORT = 'input'

/** 落地时新节点之间 / 与已有节点的间距 */
export const AGENT_LAYOUT_GAP = 48

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * 按 `order` 从左到右排开：**列 = 第几步**，同一步的上下并列。
 *
 * 为什么用「列」而不是「让模型给坐标」：模型对空间一无所知，给的坐标必然互相压。
 * 它只提供「第几步」这种它真懂的信息，映射到坐标是我们的事。
 *
 * 另外**避开已有节点**：新节点整列往下让，而不是盖在你现有节点上。
 * 让位是整列一起让 —— 只挪冲突那一个会把同一步的并列关系打乱。
 */
export function layoutAgentPlan(
  plan: AgentPlan,
  existing: readonly GraphNodeView[],
  sizeOf: (type: AgentPlan['nodes'][number]['type']) => { w: number; h: number },
  origin: { x: number; y: number },
): Record<string, Rect> {
  const created = plan.nodes.filter((n) => !isAttached(plan, n.localId))
  const byOrder = new Map<number, typeof created>()
  for (const node of created) {
    const list = byOrder.get(node.order) ?? []
    list.push(node)
    byOrder.set(node.order, list)
  }

  const out: Record<string, Rect> = {}
  let cursorX = origin.x
  for (const order of [...byOrder.keys()].sort((a, b) => a - b)) {
    const column = byOrder.get(order)!
    const columnW = Math.max(...column.map((n) => sizeOf(n.type).w))
    let y = origin.y
    for (const node of column) {
      const size = sizeOf(node.type)
      let rect: Rect = { x: cursorX, y, w: size.w, h: size.h }
      // 与任何已有节点相撞就整列往下让（含同一列前面放下的）
      while (existing.some((e) => overlaps(rect, e))) {
        y = Math.max(...existing.filter((e) => overlaps(rect, e)).map((e) => e.y + e.h)) + AGENT_LAYOUT_GAP
        rect = { ...rect, y }
      }
      out[node.localId] = rect
      y = rect.y + rect.h + AGENT_LAYOUT_GAP
    }
    cursorX += columnW + AGENT_LAYOUT_GAP
  }
  return out
}

/** `attach` 里的 localId 表示「复用已有节点」，不新建 */
export function isAttached(plan: AgentPlan, localId: string): boolean {
  return (plan.attach ?? []).some((a) => a.localId === localId)
}

export interface LandingCheckInput {
  plan: AgentPlan
  /** localId → 落地后的真实节点 id（attach 的那条指向既有节点 id） */
  idOf: Record<string, string>
  before: AgentGraphView
  after: AgentGraphView
}

export interface LandingCheckResult {
  ok: boolean
  /** 逐条问题，能指到具体哪一个节点 / 哪一条连线 */
  problems: string[]
}

/**
 * 落地自检：拿**实际画布**与计划逐条对账（设计文档 §4.1）。
 *
 * 报的是「哪一条没落上」，不是笼统的「落地失败」—— 用户要据此判断能不能接着用。
 * 已建出来的节点是可见的，所以这里**不回滚也不假装成功**，只如实报。
 */
export function verifyAgentPlanLanding(input: LandingCheckInput): LandingCheckResult {
  const { plan, idOf, before, after } = input
  const problems: string[] = []
  const beforeIds = new Set(before.nodes.map((n) => n.id))
  const afterById = new Map(after.nodes.map((n) => [n.id, n]))

  // ① 每个计划节点都真的存在，且类型一致
  for (const node of plan.nodes) {
    const realId = idOf[node.localId]
    if (!realId) {
      problems.push(`节点 ${node.localId} 没有落成（没有对应的真实 id）`)
      continue
    }
    const landed = afterById.get(realId)
    if (!landed) {
      problems.push(`节点 ${node.localId} 计划落成 ${realId}，但画布上没有这个节点`)
      continue
    }
    if (landed.type !== node.type) {
      problems.push(`节点 ${node.localId} 类型不对：计划 ${node.type}，实际 ${landed.type}`)
    }
    // ② 复用的必须真是**原来就有的那个**，不许偷偷新建一个
    if (isAttached(plan, node.localId)) {
      const declared = plan.attach!.find((a) => a.localId === node.localId)!.existingNodeId
      if (realId !== declared) {
        problems.push(`复用节点 ${node.localId} 指向的是 ${realId}，计划里写的是 ${declared}`)
      }
      if (!beforeIds.has(realId)) {
        problems.push(`复用节点 ${node.localId} 号称复用 ${declared}，但落地前画布上并没有它`)
      }
    } else if (beforeIds.has(realId)) {
      problems.push(`节点 ${node.localId} 本该是新建的，却复用了已有节点 ${realId}`)
    }
  }

  // ③ 新增数量要对（复用的不算新增）
  const expectedNew = plan.nodes.filter((n) => !isAttached(plan, n.localId)).length
  const actualNew = after.nodes.filter((n) => !beforeIds.has(n.id)).length
  if (actualNew !== expectedNew) {
    problems.push(`新增节点数不对：计划新建 ${expectedNew} 个，画布上新增了 ${actualNew} 个`)
  }

  // ④ 每条连线都在，**端口也要对**
  for (const [i, edge] of plan.edges.entries()) {
    const from = idOf[edge.source]
    const to = idOf[edge.target]
    if (!from || !to) {
      problems.push(`第 ${i + 1} 条连线 ${edge.source}→${edge.target} 的端点没有落成`)
      continue
    }
    const hit = after.edges.some(
      (e) =>
        e.source === from &&
        e.target === to &&
        (e.sourcePort ?? DEFAULT_SOURCE_PORT) === (edge.sourcePort ?? DEFAULT_SOURCE_PORT) &&
        (e.targetPort ?? DEFAULT_TARGET_PORT) === (edge.targetPort ?? DEFAULT_TARGET_PORT),
    )
    if (!hit) {
      const port = edge.targetPort ? `（端口 ${edge.targetPort}）` : ''
      problems.push(`第 ${i + 1} 条连线缺失：${edge.source}→${edge.target}${port}`)
    }
  }

  // ⑤ 新节点不许压在落地前就存在的节点上
  for (const node of plan.nodes) {
    if (isAttached(plan, node.localId)) continue
    const landed = afterById.get(idOf[node.localId] ?? '')
    if (!landed) continue
    const clash = before.nodes.find((n) => overlaps(landed, n))
    if (clash) problems.push(`新节点 ${node.localId} 压在已有节点 ${clash.id} 上`)
  }

  return { ok: problems.length === 0, problems }
}
