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
}

export interface AgentTaskPlan {
  id: string
  title: string
  summary?: string
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
    })
  }
  if (steps.length < 2) return undefined
  const requestedCurrent = textOf(source.currentStepId, 80)
  const currentStepId =
    steps.find((step) => step.id === requestedCurrent)?.id ??
    steps.find((step) => step.status === 'in_progress')?.id
  const summary = textOf(source.summary, 240)
  return {
    id,
    title,
    steps,
    ...(currentStepId ? { currentStepId } : {}),
    ...(summary ? { summary } : {}),
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
 * `done` / `skipped` 后会自动把下一个未完成步骤设为 `in_progress`，这样模型只
 * 需要报告“刚做完哪一步”，面板就会自然露出“现在做什么”。失败则停下来，不自动
 * 跳过或重试。
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
  const note = textOf(source.note, 240)
  const steps = plan.steps.map((step, index) => {
    if (index !== stepIndex) {
      if (status === 'in_progress' && step.status === 'in_progress') {
        return { ...step, status: 'pending' as const }
      }
      return { ...step }
    }
    return {
      ...step,
      status,
      ...(note ? { note } : {}),
      ...(status !== 'pending' && !step.startedAt
        ? { startedAt: now }
        : {}),
      ...(TERMINAL_STEP_STATUSES.has(status) ? { finishedAt: now } : {}),
    }
  })

  if (status === 'done' || status === 'skipped') {
    const next = steps
      .slice(stepIndex + 1)
      .find((step) => step.status === 'pending')
    if (next) next.status = 'in_progress'
    if (next && !next.startedAt) next.startedAt = now
  }

  const currentStepId =
    status === 'failed'
      ? undefined
      : steps.find((step) => step.status === 'in_progress')?.id

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

export function taskPlanPrompt(plan: AgentTaskPlan): string {
  const progress = agentTaskPlanProgress(plan)
  return [
    '## 当前任务计划',
    `计划：${plan.title}（${progress.completed}/${progress.total}）`,
    ...plan.steps.map(
      (step) =>
        `- ${step.id}｜${step.title}｜${step.status}` +
        `${step.requiresConfirmation ? '｜需要用户确认' : ''}` +
        `${step.note ? `｜${step.note}` : ''}`,
    ),
    '',
    '执行时必须用 updateTaskStep 更新这些 stepId 的状态：开始一步写 in_progress，',
    '完成写 done，失败写 failed，不适用写 skipped。不要只在正文里口头说“正在做/已完成”。',
    '步骤标注“需要用户确认”时，在真正越过该阶段之前调用 requestTaskConfirmation。',
  ].join('\n')
}

