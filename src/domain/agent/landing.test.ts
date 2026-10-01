import { describe, expect, it } from 'vitest'
import type { AgentPlan } from './plan'
import {
  AGENT_LAYOUT_GAP,
  layoutAgentPlan,
  verifyAgentPlanLanding,
  type AgentGraphView,
  type GraphNodeView,
} from './landing'

/**
 * 布局与落地自检（设计文档 §4 / §4.1）。
 *
 * 用户 2026-10-01：「每次落地完，我需要你验证」。这一组就是那条要求的实现测试：
 * 重点不是「命令没报错」，而是**拿实际画布跟计划逐条对账**，并且能指出是哪一条不对。
 */

const SIZE = { w: 200, h: 120 }
const sizeOf = () => SIZE

const plan: AgentPlan = {
  summary: '提示词 → 生成',
  nodes: [
    { localId: 'p1', type: 'prompt', data: {}, order: 0 },
    { localId: 'g1', type: 'generation', data: {}, order: 1 },
  ],
  edges: [{ source: 'p1', target: 'g1' }],
}

const node = (id: string, type: string, x: number, y: number): GraphNodeView => ({
  id,
  type,
  x,
  y,
  w: SIZE.w,
  h: SIZE.h,
})

describe('layoutAgentPlan · 按步排布', () => {
  it('★ 不同 order 横向排开，同一 order 纵向并列', () => {
    const p: AgentPlan = {
      summary: 'x',
      nodes: [
        { localId: 'a', type: 'prompt', data: {}, order: 0 },
        { localId: 'b', type: 'prompt', data: {}, order: 0 },
        { localId: 'c', type: 'generation', data: {}, order: 1 },
      ],
      edges: [],
    }
    const r = layoutAgentPlan(p, [], sizeOf, { x: 0, y: 0 })
    expect(r.a!.x).toBe(r.b!.x) // 同一步同列
    expect(r.b!.y).toBe(r.a!.y + SIZE.h + AGENT_LAYOUT_GAP)
    expect(r.c!.x).toBe(SIZE.w + AGENT_LAYOUT_GAP) // 下一步右移一列
  })

  it('★★ 避开已有节点：整列往下让，不盖上去', () => {
    const existing = [node('old', 'prompt', 0, 0)]
    const r = layoutAgentPlan(plan, existing, sizeOf, { x: 0, y: 0 })
    const first = r.p1!
    // 不许与已有节点相交
    const clash = first.x < 0 + SIZE.w && 0 < first.x + first.w && first.y < 0 + SIZE.h && 0 < first.y + first.h
    expect(clash).toBe(false)
    expect(first.y).toBeGreaterThanOrEqual(SIZE.h + AGENT_LAYOUT_GAP)
  })

  it('复用的节点不给坐标（它不新建）', () => {
    const p: AgentPlan = {
      ...plan,
      attach: [{ localId: 'p1', existingNodeId: 'old-p' }],
    }
    const r = layoutAgentPlan(p, [node('old-p', 'prompt', 500, 500)], sizeOf, { x: 0, y: 0 })
    expect(r.p1).toBeUndefined()
    expect(r.g1).toBeDefined()
  })
})

describe('verifyAgentPlanLanding · 逐条对账', () => {
  const before: AgentGraphView = { nodes: [], edges: [] }
  const good: AgentGraphView = {
    nodes: [node('n-p', 'prompt', 0, 0), node('n-g', 'generation', 248, 0)],
    edges: [{ source: 'n-p', target: 'n-g' }],
  }
  const idOf = { p1: 'n-p', g1: 'n-g' }

  it('★ 长对了 → ok，没有废话', () => {
    const r = verifyAgentPlanLanding({ plan, idOf, before, after: good })
    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('★★ 连线缺失 → 指出是第几条、连的谁', () => {
    const r = verifyAgentPlanLanding({
      plan,
      idOf,
      before,
      after: { ...good, edges: [] },
    })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toContain('第 1 条连线缺失')
    expect(r.problems[0]).toContain('p1→g1')
  })

  it('★★ 端口接反 → 也算不对（融合的左原图 / 右局部不能反）', () => {
    const p: AgentPlan = {
      ...plan,
      edges: [{ source: 'p1', target: 'g1', targetPort: 'patch' }],
    }
    const r = verifyAgentPlanLanding({
      plan: p,
      idOf,
      before,
      after: { ...good, edges: [{ source: 'n-p', target: 'n-g', targetPort: 'input' }] },
    })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toContain('端口 patch')
  })

  it('★ 节点类型不对 → 指出来', () => {
    const r = verifyAgentPlanLanding({
      plan,
      idOf,
      before,
      after: { nodes: [node('n-p', 'prompt', 0, 0), node('n-g', 'compare', 248, 0)], edges: [] },
    })
    expect(r.problems.join()).toContain('类型不对')
  })

  it('★ 新增数量不对 → 报差值（多建 / 少建都要能看出来）', () => {
    const r = verifyAgentPlanLanding({
      plan,
      idOf,
      before,
      after: { ...good, nodes: [...good.nodes, node('extra', 'prompt', 0, 900)] },
    })
    expect(r.problems.join()).toContain('新增节点数不对')
  })

  it('★ 新节点压在已有节点上 → 报出来', () => {
    const occupied = node('old', 'prompt', 0, 0)
    const r = verifyAgentPlanLanding({
      plan,
      idOf,
      before: { nodes: [occupied], edges: [] },
      after: good,
    })
    expect(r.problems.join()).toContain('压在已有节点')
  })

  it('★★ attach 说复用、实际却新建了一个 → 报出来', () => {
    const p: AgentPlan = { ...plan, attach: [{ localId: 'p1', existingNodeId: 'old-p' }] }
    const r = verifyAgentPlanLanding({
      plan: p,
      idOf: { p1: 'n-p', g1: 'n-g' }, // 用了新建的 n-p，而不是 old-p
      before: { nodes: [node('old-p', 'prompt', 900, 900)], edges: [] },
      after: good,
    })
    expect(r.ok).toBe(false)
    expect(r.problems.join()).toContain('复用')
  })
})
