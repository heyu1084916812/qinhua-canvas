import { describe, expect, it, vi } from 'vitest'
import { fingerprintHex } from '../../../domain/shared/hash'
import { createMemoryPlatform } from '../../../platform/memory'
import { createAgentJobStore } from '../../../state/agent/jobStore'
import { createAgentToolEffectLedger } from './AgentToolEffectLedger'

async function setup() {
  const jobs = createAgentJobStore(createMemoryPlatform().storage)
  const { job } = await jobs.create({
    sessionId: 's1',
    projectId: 'p1',
    turnId: 'turn-1',
  })
  return { jobs, job, ledger: createAgentToolEffectLedger(jobs) }
}

describe('AgentToolEffectLedger', () => {
  it('executes once and replays the persisted result', async () => {
    const { job, ledger } = await setup()
    const execute = vi.fn(async () => ({ ok: true, nodeId: 'node-1' }))
    const input = {
      jobId: job.id,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      args: { nodeIds: ['node-1'] },
      execute,
    }

    await expect(ledger.run(input)).resolves.toMatchObject({
      kind: 'completed',
      result: { ok: true, nodeId: 'node-1' },
      replayed: false,
    })
    await expect(ledger.run(input)).resolves.toMatchObject({
      kind: 'completed',
      result: { ok: true, nodeId: 'node-1' },
      replayed: true,
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not rerun an effect that started but never finished', async () => {
    const { jobs, job, ledger } = await setup()
    await jobs.claimToolEffect({
      jobId: job.id,
      effectKey: `agent:${job.id}:step-1:call-1`,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      argsDigest: fingerprintHex(JSON.stringify(null)),
    })
    const execute = vi.fn()

    await expect(
      ledger.run({
        jobId: job.id,
        stepId: 'step-1',
        toolCallId: 'call-1',
        toolName: 'runNode',
        args: null,
        execute,
      }),
    ).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('不会自动重发'),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('blocks every new tool effect while one earlier effect is unresolved', async () => {
    const { jobs, job, ledger } = await setup()
    await jobs.claimToolEffect({
      jobId: job.id,
      effectKey: `agent:${job.id}:step-1:call-1`,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      argsDigest: fingerprintHex(JSON.stringify({})),
    })
    const execute = vi.fn()

    await expect(
      ledger.run({
        jobId: job.id,
        stepId: 'step-1',
        toolCallId: 'call-2',
        toolName: 'runFrom',
        args: {},
        execute,
      }),
    ).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('已经开始但结果未知'),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('persists a real execution error and never claims success', async () => {
    const { job, ledger } = await setup()
    const input = {
      jobId: job.id,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      args: {},
    }
    await expect(
      ledger.run({
        ...input,
        execute: async () => {
          throw new Error('渠道超时，结果未知')
        },
      }),
    ).resolves.toMatchObject({
      kind: 'failed',
      error: '渠道超时，结果未知',
      replayed: false,
    })
    await expect(
      ledger.run({ ...input, execute: vi.fn() }),
    ).resolves.toMatchObject({
      kind: 'failed',
      error: '渠道超时，结果未知',
      replayed: true,
    })
  })
})
