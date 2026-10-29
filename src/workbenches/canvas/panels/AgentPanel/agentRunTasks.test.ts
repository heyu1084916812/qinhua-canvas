import { describe, expect, it } from 'vitest'
import {
  agentRunTaskCounts,
  agentRunTaskTitle,
  createAgentRunTasks,
  finishAgentRunTask,
  formatAgentRunElapsed,
  startAgentRunWave,
} from './agentRunTasks'

describe('Agent generation task state', () => {
  it('only starts tasks in the wave that is actually running', () => {
    let tasks = createAgentRunTasks([
      { nodeId: 'a', title: '封面' },
      { nodeId: 'b', title: '侧面' },
      { nodeId: 'c', title: '背面' },
    ])

    tasks = startAgentRunWave(tasks, ['a', 'b'], 1_000)
    expect(tasks.map((task) => task.status)).toEqual([
      'running',
      'running',
      'queued',
    ])

    tasks = finishAgentRunTask(tasks, 'a', { ok: true }, 4_000)
    expect(tasks.map((task) => task.status)).toEqual(['done', 'running', 'queued'])

    tasks = finishAgentRunTask(tasks, 'b', { ok: true }, 9_000)
    tasks = startAgentRunWave(tasks, ['c'], 10_000)
    expect(tasks.map((task) => task.status)).toEqual(['done', 'done', 'running'])
  })

  it('keeps parallel tasks running together and reports real counts', () => {
    let tasks = createAgentRunTasks([
      { nodeId: 'a', title: '封面' },
      { nodeId: 'b', title: '侧面' },
    ])
    tasks = startAgentRunWave(tasks, ['a', 'b'], 1_000)

    expect(agentRunTaskCounts(tasks)).toEqual({
      total: 2,
      queued: 0,
      running: 2,
      done: 0,
      failed: 0,
    })
    expect(agentRunTaskTitle(tasks)).toBe('图像生成中 0/2')
  })

  it('does not move a queued task to running twice', () => {
    let tasks = createAgentRunTasks([{ nodeId: 'a', title: '封面' }])
    tasks = startAgentRunWave(tasks, ['a'], 5_000)
    tasks = startAgentRunWave(tasks, ['a'], 8_000)
    expect(tasks[0]?.startedAt).toBe(5_000)
  })

  it('can correct a provisional completion when record reconciliation reports failure', () => {
    let tasks = createAgentRunTasks([{ nodeId: 'a', title: '封面' }])
    tasks = startAgentRunWave(tasks, ['a'], 1_000)
    tasks = finishAgentRunTask(tasks, 'a', { ok: true }, 3_000)
    expect(tasks[0]?.status).toBe('done')
    tasks = finishAgentRunTask(tasks, 'a', { ok: false, error: '没有留下记录' }, 4_000)
    expect(tasks[0]).toMatchObject({
      status: 'failed',
      error: '没有留下记录',
      finishedAt: 4_000,
    })
  })

  it('formats elapsed time in seconds and minutes', () => {
    expect(formatAgentRunElapsed(0)).toBe('0秒')
    expect(formatAgentRunElapsed(13.9)).toBe('13秒')
    expect(formatAgentRunElapsed(65)).toBe('1分5秒')
    expect(formatAgentRunElapsed(120)).toBe('2分')
  })
})
