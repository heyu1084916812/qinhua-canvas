export const AGENT_TASK_STEP_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'failed',
  'skipped',
] as const

export type AgentTaskStepStatus = (typeof AGENT_TASK_STEP_STATUSES)[number]

export interface AgentTaskPlanStep {
  id: string
  title: string
  detail?: string
  requiresConfirmation?: boolean
  status: AgentTaskStepStatus
  note?: string
  startedAt?: number
  finishedAt?: number
  /** 用户明确确认过“这一步的结果可以接受”的时间。 */
  reviewApprovedAt?: number
  /** 当前步骤已产出可验收结果的时间；有此值且未验收时禁止进入下一阶段。 */
  resultsReadyAt?: number
}

export interface AgentTaskPlan {
  id: string
  title: string
  summary?: string
  /** 计划成立所依赖、但尚未由用户确认的前提。 */
  assumptions?: string[]
  steps: AgentTaskPlanStep[]
  currentStepId?: string
  createdAt: number
  updatedAt: number
}

export interface AgentTaskPlanProgress {
  total: number
  completed: number
  percent: number
  status: 'active' | 'completed' | 'failed'
  current?: AgentTaskPlanStep
}

export type AgentTaskPlanResult =
  | { ok: true; plan: AgentTaskPlan }
  | { ok: false; problems: string[] }

const MAX_STEPS = 16
const MAX_ASSUMPTIONS = 8
const TERMINAL_STEP_STATUSES = new Set<AgentTaskStepStatus>([
  'done',
  'failed',
  'skipped',
])

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textOf(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function stepStatusOf(value: unknown): AgentTaskStepStatus {
  return (AGENT_TASK_STEP_STATUSES as readonly string[]).includes(String(value))
    ? (value as AgentTaskStepStatus)
    : 'pending'
}

function assumptionsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => textOf(item, 180)).filter(Boolean))].slice(
    0,
    MAX_ASSUMPTIONS,
  )
}

export function agentTaskPlanProgress(
  plan: AgentTaskPlan,
): AgentTaskPlanProgress {
  const total = plan.steps.length
  const completed = plan.steps.filter(
    (step) => step.status === 'done' || step.status === 'skipped',
  ).length
  const failed = plan.steps.some((step) => step.status === 'failed')
  return {
    total,
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    status: failed ? 'failed' : completed === total ? 'completed' : 'active',
    ...(plan.steps.find(
      (step) =>
        step.id === plan.currentStepId &&
        step.status !== 'done' &&
        step.status !== 'failed' &&
        step.status !== 'skipped',
    )
      ? {
          current: plan.steps.find(
            (step) =>
              step.id === plan.currentStepId &&
              step.status !== 'done' &&
              step.status !== 'failed' &&
              step.status !== 'skipped',
          )!,
        }
      : plan.steps.find((step) => step.status === 'in_progress')
        ? { current: plan.steps.find((step) => step.status === 'in_progress')! }
        : {}),
  }
}

/** 存储行 → 可继续的任务计划；坏数据直接丢弃，不让整条会话失效。 */
export function normalizeStoredTaskPlan(
  raw: unknown,
): AgentTaskPlan | undefined {
  const source = recordOf(raw)
  const id = textOf(source.id, 120)
  const title = textOf(source.title, 80)
  const rows = Array.isArray(source.steps) ? source.steps : []
  if (!id || !title || rows.length < 2) return undefined
  const used = new Set<string>()
  const steps: AgentTaskPlanStep[] = []
  for (const [index, value] of rows.slice(0, MAX_STEPS).entries()) {
    const row = recordOf(value)
    const requestedId =
      textOf(row.id, 80) || textOf(row.stepId, 80) || `step-${index + 1}`
    let stepId = requestedId
    let suffix = 2
    while (used.has(stepId)) {
      stepId = `${requestedId}-${suffix}`
      suffix += 1
    }
    const stepTitle = textOf(row.title, 80)
    if (!stepTitle) continue
    used.add(stepId)
    const detail = textOf(row.detail, 240)
    const note = textOf(row.note, 240)
    const reviewApprovedAt =
      typeof row.reviewApprovedAt === 'number' && row.reviewApprovedAt > 0
        ? row.reviewApprovedAt
        : undefined
    const resultsReadyAt =
      typeof row.resultsReadyAt === 'number' && row.resultsReadyAt > 0
        ? row.resultsReadyAt
        : undefined
    steps.push({
      id: stepId,
      title: stepTitle,
      status: stepStatusOf(row.status),
      ...(detail ? { detail } : {}),
      ...(note ? { note } : {}),
      ...(row.requiresConfirmation === true
        ? { requiresConfirmation: true }
        : {}),
      ...(typeof row.startedAt === 'number' && row.startedAt > 0
        ? { startedAt: row.startedAt }
        : {}),
      ...(typeof row.finishedAt === 'number' && row.finishedAt > 0
        ? { finishedAt: row.finishedAt }
        : {}),
      ...(reviewApprovedAt ? { reviewApprovedAt } : {}),
      ...(resultsReadyAt ? { resultsReadyAt } : {}),
    })
  }
  if (steps.length < 2) return undefined
  /**
   * 旧版本允许跨步骤更新，可能留下“前一步未完成、后一步已完成”的坏顺序。
   * 读回时把被跨过的后续状态收回 pending，避免进度卡继续显示两个当前步骤。
   */
  let blocked = false
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!
    if (blocked && step.status !== 'pending') {
      steps[index] = {
        id: step.id,
        title: step.title,
        status: 'pending',
        ...(step.detail ? { detail: step.detail } : {}),
        ...(step.note ? { note: step.note } : {}),
        ...(step.requiresConfirmation ? { requiresConfirmation: true } : {}),
      }
    }
    if (step.status !== 'done' && step.status !== 'skipped') blocked = true
  }
  const requestedCurrent = textOf(source.currentStepId, 80)
  const currentStepId =
    steps.find(
      (step) => step.id === requestedCurrent && step.status === 'in_progress',
    )?.id ??
    steps.find((step) => step.status === 'in_progress')?.id
  const summary = textOf(source.summary, 240)
  const assumptions = assumptionsOf(source.assumptions)
  return {
    id,
    title,
    steps,
    ...(currentStepId ? { currentStepId } : {}),
    ...(summary ? { summary } : {}),
    ...(assumptions.length > 0 ? { assumptions } : {}),
    createdAt:
      typeof source.createdAt === 'number' && source.createdAt > 0
        ? source.createdAt
        : 0,
    updatedAt:
      typeof source.updatedAt === 'number' && source.updatedAt > 0
        ? source.updatedAt
        : 0,
  }
}

/**
 * 模型给出的执行计划 → 可持久化的任务计划。
 *
 * 计划必须至少两步；单步请求直接做事，不应该多一层确认。第一个步骤默认进入
 * `in_progress`，后续步骤保持 `pending`，这样用户确认计划后马上能看到当前阶段。
 */
export function normalizeTaskPlanProposal(
  raw: unknown,
  options: { id: string; now: number },
): AgentTaskPlanResult {
  const source = recordOf(raw)
  const title = textOf(source.title, 80)
  const summary = textOf(source.summary, 240)
  const assumptions = assumptionsOf(source.assumptions)
  const rows = Array.isArray(source.steps) ? source.steps : []
  const problems: string[] = []
  if (!title) problems.push('计划缺少标题')
  if (rows.length < 2) problems.push('执行计划至少需要 2 个步骤')
  if (rows.length > MAX_STEPS) {
    problems.push(`执行计划最多 ${MAX_STEPS} 个步骤`)
  }

  const usedIds = new Set<string>()
  const steps: AgentTaskPlanStep[] = []
  for (const [index, value] of rows.slice(0, MAX_STEPS).entries()) {
    const row = recordOf(value)
    const stepTitle = textOf(row.title, 80)
    if (!stepTitle) {
      problems.push(`第 ${index + 1} 个步骤缺少标题`)
      continue
    }
    const requestedId =
      textOf(row.id, 80) ||
      textOf(row.key, 80) ||
      textOf(row.stepId, 80) ||
      `step-${index + 1}`
    let id = requestedId
    let suffix = 2
    while (usedIds.has(id)) {
      id = `${requestedId}-${suffix}`
      suffix += 1
    }
    usedIds.add(id)
    const detail = textOf(row.detail, 240)
    steps.push({
      id,
      title: stepTitle,
      ...(detail ? { detail } : {}),
      ...(row.requiresConfirmation === true
        ? { requiresConfirmation: true }
        : {}),
      status: steps.length === 0 ? 'in_progress' : 'pending',
      ...(steps.length === 0 ? { startedAt: options.now } : {}),
    })
  }
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    plan: {
      id: options.id,
      title,
      ...(summary ? { summary } : {}),
      ...(assumptions.length > 0 ? { assumptions } : {}),
      steps,
      currentStepId: steps[0]?.id,
      createdAt: options.now,
      updatedAt: options.now,
    },
  }
}

/**
 * 更新计划中的一个步骤。
 *
 * 步骤必须严格按顺序推进：上一步没有结束，不能把后面的步骤写成 `in_progress`；
 * 完成一步也不会自动启动下一步，模型必须在下一次真正开始时显式写 `in_progress`。
 * 需要用户验收的步骤，在没有 `reviewApprovedAt` 前不能写 `done`。
 */
export function updateAgentTaskPlanStep(
  plan: AgentTaskPlan,
  raw: unknown,
  now: number,
): AgentTaskPlanResult {
  const source = recordOf(raw)
  const stepId = textOf(source.stepId, 80)
  const status = stepStatusOf(source.status)
  const stepIndex = plan.steps.findIndex((step) => step.id === stepId)
  if (!stepId || stepIndex < 0) {
    return { ok: false, problems: [`找不到计划步骤：${stepId || '未指定'}`] }
  }
  const rawStatus = String(source.status ?? '')
  if (!(AGENT_TASK_STEP_STATUSES as readonly string[]).includes(rawStatus)) {
    return {
      ok: false,
      problems: [
        `步骤状态只能是 ${AGENT_TASK_STEP_STATUSES.join(' / ')}`,
      ],
    }
  }
  const step = plan.steps[stepIndex]
  const previousOpen = plan.steps
    .slice(0, stepIndex)
    .find((item) => !TERMINAL_STEP_STATUSES.has(item.status))
  const activeIndex = plan.steps.findIndex((item) => item.status === 'in_progress')

  if (status === 'pending') {
    return {
      ok: false,
      problems: ['步骤不能由模型退回 pending；请继续当前步骤或结束整轮等待用户'],
    }
  }
  if (status === 'in_progress') {
    if (TERMINAL_STEP_STATUSES.has(step.status)) {
      return { ok: false, problems: [`步骤「${step.title}」已经结束，不能重新开始`] }
    }
    if (previousOpen) {
      return {
        ok: false,
        problems: [`请先完成上一步「${previousOpen.title}」，再开始「${step.title}」`],
      }
    }
    if (activeIndex >= 0 && activeIndex !== stepIndex) {
      return {
        ok: false,
        problems: [`当前步骤「${plan.steps[activeIndex]?.title ?? activeIndex + 1}」还没有结束`],
      }
    }
  }
  if (status === 'done') {
    if (step.status === 'done') {
      return { ok: true, plan: { ...plan, updatedAt: now } }
    }
    if (step.status !== 'in_progress') {
      return {
        ok: false,
        problems: [`步骤「${step.title}」还没有开始，不能直接标为完成`],
      }
    }
    if (step.requiresConfirmation && !step.reviewApprovedAt) {
      return {
        ok: false,
        problems: [
          `步骤「${step.title}」的结果还需要用户验收。先调用 requestTaskConfirmation，` +
            'purpose 写 review、stepId 写当前步骤；用户确认后才能标为 done。',
        ],
      }
    }
  }
  if (status === 'skipped' || status === 'failed') {
    if (step.status !== 'in_progress' && activeIndex !== stepIndex) {
      return {
        ok: false,
        problems: [`只能结束当前进行中的步骤；「${step.title}」尚未开始`],
      }
    }
  }
  const note = textOf(source.note, 240)
  const steps = plan.steps.map((step, index) => {
    if (index !== stepIndex) {
      return { ...step }
    }
    return {
      ...step,
      status,
      ...(note ? { note } : {}),
      ...(status === 'in_progress'
        ? { reviewApprovedAt: undefined, resultsReadyAt: undefined }
        : {}),
      ...(!step.startedAt
        ? { startedAt: now }
        : {}),
      ...(TERMINAL_STEP_STATUSES.has(status) ? { finishedAt: now } : {}),
    }
  })

  const currentStepId = steps.find((step) => step.status === 'in_progress')?.id

  return {
    ok: true,
    plan: {
      ...plan,
      steps,
      ...(currentStepId ? { currentStepId } : { currentStepId: undefined }),
      updatedAt: now,
    },
  }
}

/**
 * 用户确认验收当前步骤的结果。只记录“结果已获用户确认”，不改 done；
 * 下一步仍由模型显式写 in_progress，避免确认后自动串行执行。
 */
export function approveAgentTaskPlanReview(
  plan: AgentTaskPlan,
  stepId: string,
  now: number,
): AgentTaskPlanResult {
  const step = plan.steps.find((item) => item.id === stepId)
  if (!step) return { ok: false, problems: [`找不到计划步骤：${stepId}`] }
  if (step.status !== 'in_progress') {
    return {
      ok: false,
      problems: [`只有当前进行中的步骤需要结果验收；「${step.title}」当前是 ${step.status}`],
    }
  }
  return {
    ok: true,
    plan: {
      ...plan,
      steps: plan.steps.map((item) =>
        item.id === stepId
          ? {
              ...item,
              resultsReadyAt: item.resultsReadyAt ?? now,
              reviewApprovedAt: now,
            }
          : item,
      ),
      updatedAt: now,
    },
  }
}

/** 当前步骤已有可验收结果；此后必须等用户验收，不能再开下一阶段。 */
export function markAgentTaskPlanResultsReady(
  plan: AgentTaskPlan,
  now: number,
): AgentTaskPlanResult {
  const current =
    plan.steps.find((step) => step.id === plan.currentStepId) ??
    plan.steps.find((step) => step.status === 'in_progress')
  if (!current || current.status !== 'in_progress') {
    return { ok: false, problems: ['当前没有可标记结果等待验收的计划步骤'] }
  }
  return {
    ok: true,
    plan: {
      ...plan,
      steps: plan.steps.map((step) =>
        step.id === current.id ? { ...step, resultsReadyAt: now } : step,
      ),
      updatedAt: now,
    },
  }
}

export function taskPlanPrompt(plan: AgentTaskPlan): string {
  const progress = agentTaskPlanProgress(plan)
  return [
    '## 当前任务计划',
    `计划：${plan.title}｜${plan.id}（${progress.completed}/${progress.total}）`,
    ...(plan.summary ? [`目标：${plan.summary}`] : []),
    ...(plan.assumptions?.length
      ? ['计划前提（未经用户明确确认前不得当成事实）：', ...plan.assumptions.map((item) => `- ${item}`)]
      : []),
    ...plan.steps.map(
      (step) =>
        `- ${step.id}｜${step.title}｜${step.status}` +
        `${step.requiresConfirmation ? '｜需要用户确认' : ''}` +
        `${step.reviewApprovedAt ? '｜用户已验收结果' : ''}` +
        `${step.resultsReadyAt && !step.reviewApprovedAt ? '｜结果待验收' : ''}` +
        `${step.note ? `｜${step.note}` : ''}`,
    ),
    '',
    '一次只能推进一个步骤。用 updateTaskStep 在真正开始时写 in_progress；上一步结束前不能开始下一步。',
    '完成一步只写 done，系统不会自动启动下一步。失败写 failed，不适用写 skipped。',
    '标注“需要用户确认”的步骤完成后，必须先调用 requestTaskConfirmation（purpose=review）',
    '请用户验收结果；用户确认后才能把这一步写 done。结果待验收期间禁止 applyPlan / runNode',
    '进入下一阶段。视觉验收发现问题时更不能自动进入下一步。',
  ].join('\n')
}

