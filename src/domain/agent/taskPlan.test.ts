import { describe, expect, it } from 'vitest'
import {
  agentTaskPlanProgress,
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
    expect(agentTaskPlanProgress(result.plan)).toMatchObject({
      total: 3,
      completed: 0,
      percent: 0,
      status: 'active',
    })
    expect(taskPlanPrompt(result.plan)).toContain('updateTaskStep')
    expect(taskPlanPrompt(result.plan)).toContain('需要用户确认')
  })

  it('完成一步会自动推进下一步，并保留稳定 stepId', () => {
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
    const updated = updateAgentTaskPlanStep(
      created.plan,
      { stepId: 'a', status: 'done' },
      200,
    )
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.plan.currentStepId).toBe('b')
    expect(updated.plan.steps.map((step) => step.status)).toEqual([
      'done',
      'in_progress',
    ])
    expect(agentTaskPlanProgress(updated.plan)).toMatchObject({
      completed: 1,
      percent: 50,
      current: { id: 'b' },
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
        steps: [
          { id: 'a', title: '确认品牌输入' },
          { id: 'b', title: '生成视觉规范' },
        ],
      },
      { id: 'plan-1', now: 100 },
    )
    if (!created.ok) throw new Error('plan')
    const updated = updateAgentTaskPlanStep(
      created.plan,
      { stepId: 'a', status: 'done' },
      200,
    )
    if (!updated.ok) throw new Error('update')
    expect(normalizeStoredTaskPlan(updated.plan)).toEqual(updated.plan)
  })
})
