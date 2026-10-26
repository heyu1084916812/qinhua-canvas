import type { AppError } from '../../../shared/result'
import type { RunTaskState } from '../../shared/execution/runEngine'
import type {
  StoryboardRunAction,
  StoryboardRunPlan,
  StoryboardRunTask,
} from '../../../domain/storyboard/runTypes'

interface SubjectEntry {
  planId: string
  taskId: string
  subjectId: string
  action: StoryboardRunAction
  state: RunTaskState
  order: number
}

interface PlanEntry {
  order: number
  tasks: Map<string, Omit<SubjectEntry, 'state' | 'order'>>
}

interface ProjectEntry {
  version: number
  sequence: number
  subjects: Map<string, SubjectEntry>
  plans: Map<string, PlanEntry>
}

const projects = new Map<string, ProjectEntry>()
const listeners = new Set<() => void>()

function projectEntry(projectId: string): ProjectEntry {
  const existing = projects.get(projectId)
  if (existing) return existing
  const created: ProjectEntry = {
    version: 0,
    sequence: 0,
    subjects: new Map(),
    plans: new Map(),
  }
  projects.set(projectId, created)
  return created
}

function subjectKey(
  action: StoryboardRunAction,
  subjectId: string,
): string {
  return `${action}\u0000${subjectId}`
}

function publish(project: ProjectEntry): void {
  project.version += 1
  for (const listener of listeners) listener()
}

function displayState(state: RunTaskState): RunTaskState {
  if (state.kind !== 'succeeded') return state
  // UI status must survive a page unmount without pinning generated media bytes in module scope.
  return { ...state, result: [] }
}

export function beginStoryboardExecutionPlan(
  projectId: string,
  plan: StoryboardRunPlan,
): void {
  const project = projectEntry(projectId)
  const order = ++project.sequence
  const tasks = new Map<string, Omit<SubjectEntry, 'state' | 'order'>>()
  for (const task of plan.tasks) {
    const entry = {
      planId: plan.id,
      taskId: task.id,
      subjectId: task.subject.id,
      action: task.action,
    }
    tasks.set(task.id, entry)
    const key = subjectKey(task.action, task.subject.id)
    const current = project.subjects.get(key)
    if (current && current.order > order) continue
    project.subjects.set(key, {
      ...entry,
      state: { kind: 'queued' },
      order,
    })
  }
  project.plans.set(plan.id, { order, tasks })
  publish(project)
}

export function updateStoryboardExecutionTask(
  projectId: string,
  planId: string,
  taskId: string,
  state: RunTaskState,
): void {
  const project = projectEntry(projectId)
  const plan = project.plans.get(planId)
  const task = plan?.tasks.get(taskId)
  if (!plan || !task) return
  const key = subjectKey(task.action, task.subjectId)
  const current = project.subjects.get(key)
  if (!current || current.planId !== planId) return
  project.subjects.set(key, {
    ...current,
    state: displayState(state),
  })
  publish(project)
}

export function failStoryboardExecutionPlan(
  projectId: string,
  planId: string,
  error: AppError,
): void {
  const project = projectEntry(projectId)
  const plan = project.plans.get(planId)
  if (!plan) return
  for (const task of plan.tasks.values()) {
    const key = subjectKey(task.action, task.subjectId)
    const current = project.subjects.get(key)
    if (
      !current ||
      current.planId !== planId ||
      current.state.kind !== 'queued'
    ) {
      continue
    }
    project.subjects.set(key, {
      ...current,
      state: { kind: 'failed', error, attempts: 0 },
    })
  }
  publish(project)
}

export function finishStoryboardExecutionPlan(
  projectId: string,
  planId: string,
): void {
  const project = projectEntry(projectId)
  if (!project.plans.delete(planId)) return
  publish(project)
}

export function subjectStateOf(
  projectId: string,
  subjectId: string,
  action: StoryboardRunAction,
): RunTaskState | undefined {
  return projects.get(projectId)?.subjects.get(subjectKey(action, subjectId))
    ?.state
}

export function runningStoryboardPlanIds(projectId: string): string[] {
  return [...(projects.get(projectId)?.plans.keys() ?? [])]
}

export function storyboardExecutionVersion(projectId: string): number {
  return projects.get(projectId)?.version ?? 0
}

export function subscribeStoryboardExecutionStatus(
  listener: () => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearStoryboardExecutionStatus(projectId?: string): void {
  if (projectId) projects.delete(projectId)
  else projects.clear()
  for (const listener of listeners) listener()
}

export function registerStoryboardTaskForTest(
  projectId: string,
  task: StoryboardRunTask,
): void {
  beginStoryboardExecutionPlan(projectId, {
    id: task.planId,
    workbench: 'storyboard',
    tasks: [task],
    scope: 'node',
    mode: 'single',
  })
}
