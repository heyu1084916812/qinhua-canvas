import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createAgentJobStore } from './jobStore'

const store = () => createAgentJobStore(createMemoryPlatform().storage)

describe('AgentJobStore', () => {
  it('按 sessionId + turnId 幂等创建，并写入首个 created 事件', async () => {
    const jobs = store()
    const first = await jobs.create({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-1',
    })
    const again = await jobs.create({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-1',
    })

    expect(first.created).toBe(true)
    expect(again.created).toBe(false)
    expect(again.job.id).toBe(first.job.id)
    expect(await jobs.events(first.job.id)).toMatchObject([
      { seq: 1, type: 'created' },
    ])
  })

  it('状态转换与事件在同一事务内递增 seq', async () => {
    const jobs = store()
    const { job } = await jobs.create({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-1',
    })
    const planning = await jobs.transition(job.id, 'planning')
    const paused = await jobs.transition(job.id, 'paused')

    expect(planning?.job.status).toBe('planning')
    expect(paused).toMatchObject({
      job: { status: 'paused', revision: 2 },
      event: {
        seq: 3,
        payload: { from: 'planning', to: 'paused' },
      },
    })
  })

  it('一个会话不能同时出现两个活动 Job', async () => {
    const jobs = store()
    const first = await jobs.create({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-1',
    })
    const second = await jobs.create({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-2',
    })
    await jobs.transition(first.job.id, 'planning')

    await expect(
      jobs.transition(second.job.id, 'planning'),
    ).rejects.toThrow('已有活动 AgentJob')
  })

  it('暂停任务恢复后仍暂停，已进入等待生成的任务恢复为 needs_attention', async () => {
    const jobs = store()
    const paused = await jobs.create({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-1',
    })
    await jobs.transition(paused.job.id, 'planning')
    await jobs.transition(paused.job.id, 'paused', 'checkpoint_saved', {
      checkpoint: {
        kind: 'max_steps',
        maxSteps: 8,
        completedSteps: 8,
        savedAt: 20,
      },
    })

    const waiting = await jobs.create({
      sessionId: 's2',
      projectId: 'p1',
      turnId: 'turn-2',
    })
    await jobs.transition(waiting.job.id, 'planning')
    await jobs.transition(waiting.job.id, 'waiting_generation')

    const recoveredPaused = await jobs.recoverSession('s1')
    const recoveredWaiting = await jobs.recoverSession('s2')
    expect(recoveredPaused[0]?.status).toBe('paused')
    expect(recoveredWaiting[0]?.status).toBe('needs_attention')
    expect((await jobs.events(waiting.job.id)).at(-1)).toMatchObject({
      type: 'recovered',
      payload: {
        from: 'waiting_generation',
        to: 'needs_attention',
        recovery: true,
      },
    })
  })

  it('检查点随 paused 状态持久化，继续时进入规划', async () => {
    const jobs = store()
    const { job } = await jobs.create({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-1',
    })
    await jobs.transition(job.id, 'planning')
    const checkpoint = {
      kind: 'max_steps' as const,
      maxSteps: 8,
      completedSteps: 8,
      savedAt: 30,
    }
    await jobs.transition(job.id, 'paused', 'checkpoint_saved', { checkpoint })
    expect((await jobs.get(job.id))?.checkpoint).toEqual(checkpoint)

    const resumed = await jobs.transition(job.id, 'planning')
    expect(resumed?.job.status).toBe('planning')
  })
})
