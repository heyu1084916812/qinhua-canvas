import { describe, expect, it } from 'vitest'
import {
  AGENT_PLAN_MAX_NODES,
  normalizeAgentPlan,
  summarizeTitle,
  validateAgentPlan,
  type AgentPlan,
} from './plan'

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

  it('★ paramSources 合法时通过，来源写错则拒绝（别让非法值流到预览界面上）', () => {
    const ok = validateAgentPlan({
      ...good,
      paramSources: { ratio: 'conversation', count: 'recipe' },
    })
    expect(ok.ok).toBe(true)

    const bad = validateAgentPlan({ ...good, paramSources: { ratio: 'magic' } })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.join()).toContain('paramSources.ratio')
  })
})

/**
 * 归一化（用户 2026-10-02 报的「重复让我确认新建工作流，重复了三次，
 * 但是我的画布中没有」）。
 *
 * 真模型给的 JSON 常常只差一点形状：`order` 写成字符串或干脆没有、
 * `localId` 写成 `id`、连线用 `from` `to`。这些语义**唯一确定**，
 * 我们补得出来；补不出来的（不认识的类型、连线指向不存在的节点）照旧整份拒绝。
 *
 * 每条断言都拿真实的模型写法当输入 —— 自己编一个「刚好合法」的用例，
 * 证明不了任何事。
 */
describe('normalizeAgentPlan · 模型给的形状差异', () => {
  /** 真模型最常见的一版：用 `id`、连线用 `from`/`to`、`order` 是字符串或没有 */
  const fromModel = {
    summary: '画一只小猫钓鱼',
    nodes: [
      { id: 'p1', type: 'prompt', data: { text: '小猫钓鱼' } },
      { id: 'g1', type: 'generation', data: { mode: 'image' }, order: '1' },
    ],
    edges: [{ from: 'p1', to: 'g1' }],
  }

  it('★★ 别名 + 缺 order：补得出来就该通过，而不是整份拒绝', () => {
    const { plan, notes } = normalizeAgentPlan(fromModel)
    const checked = validateAgentPlan(plan)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.plan.nodes.map((n) => [n.localId, n.order])).toEqual([
      ['p1', 0],
      ['g1', 1],
    ])
    expect(checked.plan.edges[0]).toMatchObject({ source: 'p1', target: 'g1' })
    expect(notes.length).toBeGreaterThan(0)
  })

  it('★ order 缺了按**连线**推导（列 = 第几步，与布局同一口径）', () => {
    const { plan } = normalizeAgentPlan({
      summary: '三步',
      nodes: [
        { localId: 'a', type: 'prompt', data: {} },
        { localId: 'b', type: 'generation', data: {} },
        { localId: 'c', type: 'compare', data: {} },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    })
    const checked = validateAgentPlan(plan)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.plan.nodes.map((n) => n.order)).toEqual([0, 1, 2])
  })

  it('★ data 不是对象 → 按空对象处理（它的含义就是「用默认参数」）', () => {
    const { plan } = normalizeAgentPlan({
      summary: 'x',
      nodes: [{ localId: 'a', type: 'prompt', order: 0 }],
      edges: [],
    })
    const checked = validateAgentPlan(plan)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.plan.nodes[0]?.data).toEqual({})
  })

  it('★ 缺 summary → 兜一句能当确认卡标题的话，不拦', () => {
    const { plan } = normalizeAgentPlan({
      nodes: [{ localId: 'a', type: 'prompt', data: {}, order: 0 }],
      edges: [],
    })
    const checked = validateAgentPlan(plan)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.plan.summary.trim()).not.toBe('')
  })

  it('★ 有环也不卡死（推导回落，连线仍在）', () => {
    const { plan } = normalizeAgentPlan({
      summary: '环',
      nodes: [
        { localId: 'a', type: 'prompt', data: {} },
        { localId: 'b', type: 'generation', data: {} },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    })
    const checked = validateAgentPlan(plan)
    expect(checked.ok).toBe(true)
  })

  it('★★ 推不出来的照旧拒绝（归一化不是「什么都放行」）', () => {
    const noType = normalizeAgentPlan({
      summary: 'x',
      nodes: [{ localId: 'a', data: {}, order: 0 }],
      edges: [],
    })
    expect(validateAgentPlan(noType.plan).ok).toBe(false)

    const dangling = normalizeAgentPlan({
      summary: 'x',
      nodes: [{ localId: 'a', type: 'prompt', data: {}, order: 0 }],
      edges: [{ source: 'a', target: '不存在' }],
    })
    const checked = validateAgentPlan(dangling.plan)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.errors.join()).toContain('不存在')
  })

  /**
   * 节点名（用户 2026-10-03：「我通过 agent 生成出现的节点上的名称要根据我的提示词
   * 来总结成一个节点的名称，不能要是图片节点1这种」）。
   *
   * 系统提示词里已经要求模型给 title，但它常常不给 —— 不给就落到 `spec.label`
   * （「图片生成」「提示词」），那正是用户看到的「跟内容无关的名字」。
   * 所以这里必须有一道**确定性的**兜底。
   */
  it('★★ 没给 title 时按提示词总结出名字（下游节点借上游那句）', () => {
    const { plan, notes } = normalizeAgentPlan({
      summary: 'x',
      nodes: [
        {
          localId: 'p1',
          type: 'prompt',
          data: { text: '小猫钓鱼，湖边木码头，水彩绘本风\n第二行不算' },
          order: 0,
        },
        { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
      ],
      edges: [{ source: 'p1', target: 'g1' }],
    })
    const checked = validateAgentPlan(plan)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    const [p, g] = checked.plan.nodes
    expect(p?.title).toBe('小猫钓鱼，湖边木码头，水')
    // 生成节点自己没有正文 → 顺着入边借上游那句
    expect(g?.title).toBe('小猫钓鱼，湖边木码头，水')
    expect(notes.join()).toContain('按提示词总结')
  })

  it('★ 模型自己起了名字就尊重它（不覆盖）', () => {
    const { plan } = normalizeAgentPlan({
      summary: 'x',
      nodes: [
        { localId: 'p1', type: 'prompt', title: '小猫钓鱼', data: { text: '随便什么' }, order: 0 },
      ],
      edges: [],
    })
    const checked = validateAgentPlan(plan)
    expect(checked.ok && checked.plan.nodes[0]?.title).toBe('小猫钓鱼')
  })

  it('★ 一句话都没有可总结时**不硬编**名字（留给 spec 的默认名）', () => {
    const { plan } = normalizeAgentPlan({
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 0 }],
      edges: [],
    })
    const checked = validateAgentPlan(plan)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.plan.nodes[0]?.title).toBeUndefined()
  })
})

describe('summarizeTitle', () => {
  it('★ 取第一行、空白收紧、截到 12 个字', () => {
    expect(summarizeTitle('小猫钓鱼')).toBe('小猫钓鱼')
    expect(summarizeTitle('第一行\n第二行')).toBe('第一行')
    expect(summarizeTitle('  a   b  ')).toBe('a b')
    expect(summarizeTitle('一二三四五六七八九十十一十二十三')).toHaveLength(12)
    expect(summarizeTitle('')).toBe('')
  })
})
