import { describe, expect, it } from 'vitest'
import { AGENT_PLAN_MAX_NODES, validateAgentPlan, type AgentPlan } from './plan'

/**
 * Agent 计划校验（设计文档 §3 / §9）。
 *
 * 这一层的职责是**模型胡说八道时别把画布搞脏**：整份拒绝、说清哪一条非法。
 * 它不负责落地，所以每条断言都只关心「这份数据合不合法」。
 */

const good: AgentPlan = {
  summary: '建一个「提示词 → 生成」的最小流程',
  nodes: [
    { localId: 'p1', type: 'prompt', data: { text: '一只橘猫' }, order: 0 },
    { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
  ],
  edges: [{ source: 'p1', target: 'g1' }],
}

describe('validateAgentPlan · 合法计划', () => {
  it('★ 最小流程通过，且没有警告', () => {
    const r = validateAgentPlan(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })

  it('★ 单个孤立节点也合法（只建一个提示词不算错）', () => {
    const r = validateAgentPlan({
      summary: '就建一个提示词',
      nodes: [{ localId: 'p1', type: 'prompt', data: {}, order: 0 }],
      edges: [],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })

  it('多个孤立节点 → 通过但给出警告（可疑，不是非法）', () => {
    const r = validateAgentPlan({
      summary: '两个没连的节点',
      nodes: [
        { localId: 'a', type: 'prompt', data: {}, order: 0 },
        { localId: 'b', type: 'prompt', data: {}, order: 1 },
      ],
      edges: [],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings[0]).toContain('没连任何线')
  })
})

describe('validateAgentPlan · 非法计划要整份拒绝', () => {
  const bad = (over: Partial<AgentPlan>) => validateAgentPlan({ ...good, ...over })

  it('★ 类型不认识 → 拒绝并列出允许的类型', () => {
    const r = bad({ nodes: [{ ...good.nodes[0]!, type: 'video' as never }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('prompt / generation')
  })

  it('★ localId 重复 → 拒绝（重复会让连线指错节点）', () => {
    const r = bad({ nodes: [good.nodes[0]!, { ...good.nodes[1]!, localId: 'p1' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('localId 重复')
  })

  it('★ 连线指向不存在的节点 → 拒绝', () => {
    const r = bad({ edges: [{ source: 'p1', target: 'nope' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('终点不存在')
  })

  it('★ 自己连自己 / 重复连线 → 拒绝', () => {
    const self = bad({ edges: [{ source: 'p1', target: 'p1' }] })
    expect(self.ok).toBe(false)
    const dup = bad({ edges: [{ source: 'p1', target: 'g1' }, { source: 'p1', target: 'g1' }] })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.errors.join()).toContain('重复')
  })

  it('★ order 必须是 0 起的整数（小数 / 负数都拒）', () => {
    for (const order of [1.5, -1, Number.NaN]) {
      const r = bad({ nodes: [{ ...good.nodes[0]!, order }] })
      expect(r.ok).toBe(false)
    }
  })

  it('★ attach 指向画布上不存在的节点 → 拒绝（模型编的 id 不能放行）', () => {
    const r = validateAgentPlan(
      { ...good, attach: [{ localId: 'p1', existingNodeId: 'nope' }] },
      ['real-node'],
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('不在画布上')
  })

  it('★ 超过节点上限 → 拒绝并报「太大」（不是硬建几百个节点压垮画布）', () => {
    const nodes = Array.from({ length: AGENT_PLAN_MAX_NODES + 1 }, (_, i) => ({
      localId: 'n' + i,
      type: 'prompt' as const,
      data: {},
      order: i,
    }))
    const r = validateAgentPlan({ ...good, nodes })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('太大')
  })

  it('★ 空计划 / 非对象 → 拒绝', () => {
    expect(validateAgentPlan(null).ok).toBe(false)
    expect(validateAgentPlan('{}').ok).toBe(false)
    expect(validateAgentPlan({ summary: 'x', nodes: [], edges: [] }).ok).toBe(false)
  })

  it('★ 缺 summary → 拒绝（用户要据此判断这份计划在做什么）', () => {
    const r = validateAgentPlan({ ...good, summary: '  ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toContain('summary')
  })
})
