export type AgentRunTaskStatus = 'queued' | 'running' | 'done' | 'failed'

export interface AgentRunTask {
  nodeId: string
  title: string
  status: AgentRunTaskStatus
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface AgentRunTaskInput {
  nodeId: string
  title: string
}

export function createAgentRunTasks(
  inputs: readonly AgentRunTaskInput[],
): AgentRunTask[] {
  const seen = new Set<string>()
  return inputs.flatMap((input) => {
    const nodeId = input.nodeId.trim()
    if (!nodeId || seen.has(nodeId)) return []
    seen.add(nodeId)
    return [
      {
        nodeId,
        title: input.title.trim() || nodeId,
        status: 'queued' as const,
      },
    ]
  })
}

export function startAgentRunWave(
  tasks: readonly AgentRunTask[],
  nodeIds: readonly string[],
  now = Date.now(),
): AgentRunTask[] {
  const started = new Set(nodeIds)
  return tasks.map((task) =>
    started.has(task.nodeId) && task.status === 'queued'
      ? { ...task, status: 'running', startedAt: now }
      : task,
  )
}

export function finishAgentRunTask(
  tasks: readonly AgentRunTask[],
  nodeId: string,
  result: { ok: boolean; error?: string },
  now = Date.now(),
): AgentRunTask[] {
  return tasks.map((task) =>
    task.nodeId === nodeId &&
    (task.status === 'running' || (task.status === 'done' && !result.ok))
      ? {
          ...task,
          status: result.ok ? 'done' : 'failed',
          finishedAt: now,
          ...(!result.ok && result.error ? { error: result.error } : {}),
        }
      : task,
  )
}

export function agentRunTaskCounts(tasks: readonly AgentRunTask[]): {
  total: number
  queued: number
  running: number
  done: number
  failed: number
} {
  const counts = {
    total: tasks.length,
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
  }
  for (const task of tasks) counts[task.status] += 1
  return counts
}

export function agentRunTaskTitle(tasks: readonly AgentRunTask[]): string {
  const counts = agentRunTaskCounts(tasks)
  if (counts.failed > 0) {
    return `生成完成 ${counts.done}/${counts.total}，${counts.failed} 个失败`
  }
  if (counts.running > 0) {
    return `图像生成中 ${counts.done + counts.failed}/${counts.total}`
  }
  if (counts.queued > 0) {
    return `图像生成中 ${counts.done + counts.failed}/${counts.total}`
  }
  return `生成完成 ${counts.done}/${counts.total}`
}

export function formatAgentRunElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  if (safe < 60) return `${safe}秒`
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return rest > 0 ? `${minutes}分${rest}秒` : `${minutes}分`
}
