import { describe, expect, it } from 'vitest'
import {
  agentTaskPlanProgress,
  approveAgentTaskPlanReview,
  normalizeStoredTaskPlan,
  normalizeTaskPlanProposal,
  taskPlanPrompt,
  updateAgentTaskPlanStep,
} from './taskPlan'

describe('Agent 任务计划', () => {
  it('计划至少两步，批准后第一步自动成为当前步骤', () => {
    const result = normalizeTaskPlanProposal(
      {
        title: '品牌视觉套件',
        summary: '先确认品牌规范，再生成应用物料',
        steps: [
          { id: 'research', title: '梳理品牌输入' },
          { id: 'system', title: '建立视觉规范', requiresConfirmation: true },
          { id: 'deliver', title: '生成应用物料' },
        ],
      },
      { id: 'plan-1', now: 100 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.currentStepId).toBe('research')
    expect(result.plan.steps.map((step) => step.status)).toEqual([
      'in_progress',
      'pending',
      'pending',
    ])
    expect(result.plan.steps.map((step) => step.requiresConfirmation)).toEqual([
      undefined,
      true,
      undefined,
    ])
    expect(agentTaskPlanProgress(result.plan)).toMatchObject({
      total: 3,
      completed: 0,
      percent: 0,
      status: 'active',
    })
    expect(taskPlanPrompt(result.plan)).toContain('updateTaskStep')
    expect(taskPlanPrompt(result.plan)).toContain('需要用户确认')
    expect(taskPlanPrompt(result.plan)).toContain('系统不会自动启动下一步')
  })

  it('完成一步只打勾，不自动把下一步设为进行中', () => {
    const created = normalizeTaskPlanProposal(
      {
        title: '发布物料',
        steps: [
          { id: 'a', title: '整理文案' },
          { id: 'b', title: '生成图片' },
        ],
      },
      { id: 'plan-1', now: 100 },
    )
    if (!created.ok) throw new Error('plan')
    const ready = {
      ...created.plan,
      steps: created.plan.steps.map((step) =>
        step.id === 'a' ? { ...step, resultsReadyAt: 140 } : step,
      ),
    }
    const approved = approveAgentTaskPlanReview(ready, 'a', 150)
    if (!approved.ok) throw new Error('approval')
    const updated = updateAgentTaskPlanStep(
      approved.plan,
      { stepId: 'a', status: 'done' },
      200,
    )
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.plan.currentStepId).toBeUndefined()
    expect(updated.plan.steps.map((step) => step.status)).toEqual([
      'done',
      'pending',
    ])
    expect(agentTaskPlanProgress(updated.plan)).toMatchObject({
      completed: 1,
      percent: 50,
    })
    expect(agentTaskPlanProgress(updated.plan).current).toBeUndefined()

    const next = updateAgentTaskPlanStep(
      updated.plan,
      { stepId: 'b', status: 'in_progress' },
      250,
    )
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.plan.currentStepId).toBe('b')
    expect(next.plan.steps.map((step) => step.status)).toEqual([
      'done',
      'in_progress',
    ])
  })

  it('拒绝跳过未完成步骤直接把后面的步骤设为进行中或完成', () => {
    const created = normalizeTaskPlanProposal(
      {
        title: '品牌设计',
        steps: [
          { id: 'a', title: '确认资料' },
          { id: 'b', title: '生成 Logo' },
        ],
      },
      { id: 'plan-1', now: 100 },
    )
    if (!created.ok) throw new Error('plan')
    expect(
      updateAgentTaskPlanStep(created.plan, { stepId: 'b', status: 'in_progress' }, 200),
    ).toMatchObject({ ok: false })
    expect(
      updateAgentTaskPlanStep(created.plan, { stepId: 'b', status: 'done' }, 200),
    ).toMatchObject({ ok: false })
  })

  it('有产出的步骤必须先由用户验收结果，验收后仍由模型显式完成', () => {
    const created = normalizeTaskPlanProposal(
      {
        title: 'Logo 设计',
        steps: [
          {
            id: 'logo',
            title: '生成 Logo 主方案',
            requiresConfirmation: true,
          },
          { id: 'guide', title: '制作品牌规范' },
        ],
      },
      { id: 'plan-1', now: 100 },
    )
    if (!created.ok) throw new Error('plan')

    expect(
      updateAgentTaskPlanStep(created.plan, { stepId: 'logo', status: 'done' }, 200),
    ).toMatchObject({ ok: false })
    const ready = {
      ...created.plan,
      steps: created.plan.steps.map((step) =>
        step.id === 'logo' ? { ...step, resultsReadyAt: 250 } : step,
      ),
    }
    const approved = approveAgentTaskPlanReview(ready, 'logo', 300)
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.plan.steps[0]).toMatchObject({
      status: 'in_progress',
      reviewApprovedAt: 300,
    })
    const done = updateAgentTaskPlanStep(
      approved.plan,
      { stepId: 'logo', status: 'done' },
      400,
    )
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.plan.steps.map((step) => step.status)).toEqual(['done', 'pending'])
  })

  it('旧计划缺失验收字段时不阻塞完成', () => {
    const plan = normalizeStoredTaskPlan({
      id: 'plan-legacy',
      title: '旧计划',
      steps: [
        { id: 'first', title: '整理资料', status: 'in_progress' },
        { id: 'second', title: '输出结果', status: 'pending' },
      ],
      currentStepId: 'first',
      createdAt: 100,
      updatedAt: 100,
    })
    if (!plan) throw new Error('plan')

    expect(plan.steps[0]?.requiresConfirmation).toBeUndefined()
    expect(
      updateAgentTaskPlanStep(plan, { stepId: 'first', status: 'done' }, 200),
    ).toMatchObject({ ok: true })
  })

  it('用户确认验收时补记结果产出时间', () => {
    const plan = normalizeStoredTaskPlan({
      id: 'plan-review',
      title: '视觉方案',
      steps: [
        {
          id: 'visual',
          title: '确认视觉方向',
          status: 'in_progress',
          requiresConfirmation: true,
          startedAt: 100,
        },
        { id: 'deliver', title: '生成物料', status: 'pending' },
      ],
      currentStepId: 'visual',
      createdAt: 100,
      updatedAt: 100,
    })
    if (!plan) throw new Error('plan')

    expect(approveAgentTaskPlanReview(plan, 'visual', 200)).toMatchObject({
      ok: true,
      plan: {
        steps: [
          {
            id: 'visual',
            resultsReadyAt: 200,
            reviewApprovedAt: 200,
          },
          { id: 'deliver' },
        ],
      },
    })
  })

  it('失败会停止自动推进，非法 stepId / 状态直接拒绝', () => {
    const created = normalizeTaskPlanProposal(
      {
        title: '交付',
        steps: [
          { id: 'a', title: '出图' },
          { id: 'b', title: '验收' },
        ],
      },
      { id: 'plan-1', now: 100 },
    )
    if (!created.ok) throw new Error('plan')
    const failed = updateAgentTaskPlanStep(
      created.plan,
      { stepId: 'a', status: 'failed', note: '渠道无响应' },
      200,
    )
    expect(failed.ok).toBe(true)
    if (failed.ok) {
      expect(failed.plan.currentStepId).toBeUndefined()
      expect(agentTaskPlanProgress(failed.plan).status).toBe('failed')
    }
    expect(
      updateAgentTaskPlanStep(created.plan, { stepId: 'missing', status: 'done' }, 200),
    ).toMatchObject({ ok: false })
    expect(
      updateAgentTaskPlanStep(created.plan, { stepId: 'a', status: 'almost' }, 200),
    ).toMatchObject({ ok: false })
  })

  it('一步计划不触发计划确认流程', () => {
    expect(
      normalizeTaskPlanProposal(
        { title: '单图', steps: [{ id: 'one', title: '生成一张图' }] },
        { id: 'plan-1', now: 100 },
      ),
    ).toMatchObject({ ok: false })
  })

  it('持久化读回保留步骤状态与当前步骤', () => {
    const created = normalizeTaskPlanProposal(
      {
        title: '品牌套件',
        summary: '先产出 Logo，再展开应用',
        assumptions: ['品牌名暂定 HE YU', '首轮先做浅色方案'],
        steps: [
          { id: 'a', title: '确认品牌输入' },
          { id: 'b', title: '生成视觉规范' },
        ],
      },
      { id: 'plan-1', now: 100 },
    )
    if (!created.ok) throw new Error('plan')
    const ready = {
      ...created.plan,
      steps: created.plan.steps.map((step) =>
        step.id === 'a' ? { ...step, resultsReadyAt: 140 } : step,
      ),
    }
    const approved = approveAgentTaskPlanReview(ready, 'a', 150)
    if (!approved.ok) throw new Error('approval')
    const updated = updateAgentTaskPlanStep(
      approved.plan,
      { stepId: 'a', status: 'done' },
      200,
    )
    if (!updated.ok) throw new Error('update')
    expect(normalizeStoredTaskPlan(updated.plan)).toEqual(updated.plan)
    expect(updated.plan.assumptions).toEqual(['品牌名暂定 HE YU', '首轮先做浅色方案'])
  })

  it('读回旧坏顺序时收回后一步，避免出现两个当前进度', () => {
    const plan = normalizeStoredTaskPlan({
      id: 'plan-old',
      title: '旧计划',
      steps: [
        { id: 'first', title: '资料确认', status: 'pending' },
        {
          id: 'second',
          title: '生成 Logo',
          status: 'in_progress',
          startedAt: 100,
        },
        { id: 'third', title: '制作规范', status: 'done', finishedAt: 200 },
      ],
      currentStepId: 'second',
      createdAt: 1,
      updatedAt: 2,
    })
    expect(plan?.steps.map((step) => step.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
    expect(plan?.currentStepId).toBeUndefined()
  })
})
