import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { PlatformKit } from '../../platform/ports'
import { ChannelError } from '../../platform/channels/types'
import {
  directTextTrace,
  runDirectGeneration,
  runDirectText,
  type DirectRunTraceInput,
} from './directRun'

const trace: DirectRunTraceInput = {
  projectId: 'p1',
  scopeVersion: 1,
  workbench: 'storyboard',
  action: 'shot-video',
  subjectId: 'shot:1:video',
  scopeId: 'episode:1',
  operationId: 'video:shot-1',
  params: { kind: 'video', model: 'v1' },
  inputs: [],
  fingerprint: 'fp-1',
}

function storageWithPut(
  base: PlatformKit['storage'],
  put: PlatformKit['storage']['put'],
): PlatformKit['storage'] {
  return {
    ...base,
    put,
  }
}

describe('runDirectGeneration', () => {
  it('成功调用写一条带工作台作用域的 RunRecord', async () => {
    const platform = createMemoryPlatform()
    const finished = await runDirectGeneration({
      storage: platform.storage,
      trace,
      now: (() => {
        let value = 100
        return () => (value += 25)
      })(),
      call: async () => ({ hash: 'asset-1' }),
      outputHashesOf: (result) => [result.hash],
      outputAssetOf: () => ({
        hash: 'asset-1',
        mime: 'video/mp4',
        bytes: new Uint8Array([1]),
        width: 1920,
        height: 1080,
      }),
    })

    expect(finished.record).toMatchObject({
      projectId: 'p1',
      workbench: 'storyboard',
      action: 'shot-video',
      subjectId: 'shot:1:video',
      scopeId: 'episode:1',
      operationId: 'video:shot-1',
      status: 'succeeded',
      outputHashes: ['asset-1'],
      outputWidth: 1920,
      outputHeight: 1080,
      durationMs: 25,
    })
    expect(await platform.storage.query('runRecords', {})).toHaveLength(1)
  })

  it('失败先留真实原因再抛回原错误', async () => {
    const platform = createMemoryPlatform()
    const error = new ChannelError({ kind: 'http', status: 500, body: 'upstream failed' })

    await expect(
      runDirectGeneration({
        storage: platform.storage,
        trace,
        call: async () => {
          throw error
        },
        outputHashesOf: () => [],
      }),
    ).rejects.toBe(error)

    const rows = await platform.storage.query('runRecords', {})
    expect(rows[0]).toMatchObject({
      status: 'failed',
      outputHashes: [],
    })
    expect(String(rows[0]?.errorText)).toContain('upstream failed')
  })

  it('取消记 canceled，但不伪造失败原因', async () => {
    const platform = createMemoryPlatform()
    const controller = new AbortController()
    controller.abort()

    await expect(
      runDirectGeneration({
        storage: platform.storage,
        trace,
        signal: controller.signal,
        call: async () => {
          throw new DOMException('Aborted', 'AbortError')
        },
        outputHashesOf: () => [],
      }),
    ).rejects.toBeInstanceOf(DOMException)

    const rows = await platform.storage.query('runRecords', {})
    expect(rows[0]).toMatchObject({ status: 'canceled', outputHashes: [] })
    expect(rows[0]?.errorText).toBeUndefined()
  })

  it('日志写入失败只重试日志，不把成功生成改成失败', async () => {
    const platform = createMemoryPlatform()
    let attempts = 0
    let calls = 0
    const warnings: string[] = []
    const storage = storageWithPut(platform.storage, async (table, row) => {
      if (table === 'runRecords') {
        attempts += 1
        throw new Error('disk busy')
      }
      return platform.storage.put(table, row)
    })

    const finished = await runDirectGeneration({
      storage,
      trace,
      call: async () => {
        calls += 1
        return 'generated'
      },
      outputHashesOf: () => [],
      onRecordWarning: (warning) => warnings.push(warning),
    })

    expect(finished.result).toBe('generated')
    expect(calls).toBe(1)
    expect(attempts).toBe(2)
    expect(finished.recordWarning).toContain('disk busy')
    expect(warnings).toEqual([finished.recordWarning])
    expect(finished.record.status).toBe('succeeded')
  })

  it('失败时日志也写不进去，仍透出日志警告并且只调用一次付费请求', async () => {
    const platform = createMemoryPlatform()
    const error = new ChannelError({ kind: 'http', status: 500, body: 'model failed' })
    let calls = 0
    const warnings: string[] = []
    const storage = storageWithPut(platform.storage, async (table, row) => {
      if (table === 'runRecords') throw new Error('disk busy')
      return platform.storage.put(table, row)
    })

    await expect(
      runDirectText({
        storage,
        trace,
        call: async () => {
          calls += 1
          throw error
        },
        onRecordWarning: (warning) => warnings.push(warning),
      }),
    ).rejects.toBe(error)

    expect(calls).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('disk busy')
  })

  it('直连路由遇到 403 时只切换到下一候选，并写进同一份尝试记录', async () => {
    const platform = createMemoryPlatform()
    const calls: string[] = []
    const finished = await runDirectText({
      storage: platform.storage,
      trace: {
        ...directTextTrace({
          projectId: 'p1',
          workbench: 'canvas',
          subjectId: 'session:1',
          scopeId: 'session:1',
          operationId: 'op-route',
          purpose: 'agent',
          channelId: 'ch-a',
          model: 'model-upstream-a',
          prompt: 'hello',
        }),
        routePlanId: 'logical:chat:priority',
      },
      channelId: 'ch-a',
      routeCandidates: [
        { channelId: 'ch-a', model: 'model-upstream-a' },
        { channelId: 'ch-b', credentialGroupId: 'g-b', model: 'model-upstream-b' },
      ],
      call: async (_signal, route) => {
        calls.push(`${route?.channelId}:${route?.model}`)
        if (route?.channelId === 'ch-a') {
          throw new ChannelError({ kind: 'http', status: 403, body: 'group denied' })
        }
        return 'ok'
      },
    })

    expect(finished).toBe('ok')
    expect(calls).toEqual([
      'ch-a:model-upstream-a',
      'ch-b:model-upstream-b',
    ])
    const [record] = await platform.storage.query('runRecords', { projectId: 'p1' })
    expect(record).toMatchObject({
      status: 'succeeded',
      sentChannelId: 'ch-b',
      sentModel: 'model-upstream-b',
      credentialGroupId: 'g-b',
      routePlanId: 'logical:chat:priority',
      routeAttempts: [
        {
          attempt: 1,
          channelId: 'ch-a',
          sentModel: 'model-upstream-a',
          status: 'failed',
          httpStatus: 403,
        },
        {
          attempt: 2,
          channelId: 'ch-b',
          credentialGroupId: 'g-b',
          sentModel: 'model-upstream-b',
          status: 'succeeded',
        },
      ],
    })
  })

  it('直连路由遇到结果未知的超时不换候选，避免第二次付费提交', async () => {
    const platform = createMemoryPlatform()
    let calls = 0
    const timeout = new ChannelError({
      kind: 'network',
      detail: 'timeout',
      sendPhase: 'unknown',
    })

    await expect(
      runDirectText({
        storage: platform.storage,
        trace: {
          ...trace,
          sentChannelId: 'ch-a',
          sentModel: 'm-a',
        },
        routeCandidates: [
          { channelId: 'ch-a', model: 'm-a' },
          { channelId: 'ch-b', model: 'm-b' },
        ],
        call: async () => {
          calls += 1
          throw timeout
        },
      }),
    ).rejects.toBe(timeout)

    expect(calls).toBe(1)
    const [record] = await platform.storage.query('runRecords', { projectId: 'p1' })
    expect(record).toMatchObject({
      status: 'failed',
      sentChannelId: 'ch-a',
      sentModel: 'm-a',
      routeAttempts: [
        {
          attempt: 1,
          channelId: 'ch-a',
          status: 'failed',
          errorKind: 'network',
          sendPhase: 'unknown',
        },
      ],
    })
  })

  it('画布提示词工具、Agent、电商文字动作共用同一作用域契约', async () => {
    const platform = createMemoryPlatform()
    const cases = [
      { workbench: 'canvas', subjectId: 'node:tool', scopeId: 'session:node:tool', operationId: 'op:optimize', purpose: 'canvas-optimize' },
      { workbench: 'canvas', subjectId: 'node:tool', scopeId: 'session:node:tool', operationId: 'op:translate', purpose: 'canvas-translate' },
      { workbench: 'canvas', subjectId: 'node:tool', scopeId: 'session:node:tool', operationId: 'op:describe', purpose: 'canvas-describe' },
      { workbench: 'canvas', subjectId: 'node:tool', scopeId: 'session:node:tool', operationId: 'op:skill', purpose: 'canvas-skill' },
      { workbench: 'canvas', subjectId: 'chat_session', scopeId: 'session:chat_session', operationId: 'op:agent', purpose: 'agent' },
      { workbench: 'canvas', subjectId: 'chat_session', scopeId: 'session:chat_session', operationId: 'op:agent', purpose: 'agent-tool-probe' },
      { workbench: 'ecommerce', subjectId: 'project:p1:intent', scopeId: 'session:ec-intent', operationId: 'op:ec-intent', purpose: 'ecommerce-intent' },
      { workbench: 'ecommerce', subjectId: 'node:product', scopeId: 'session:ec-selling', operationId: 'op:ec-selling', purpose: 'ecommerce-selling-points' },
      { workbench: 'ecommerce', subjectId: 'node:product', scopeId: 'session:ec-shots', operationId: 'op:ec-plan', purpose: 'ecommerce-shots' },
      { workbench: 'ecommerce', subjectId: 'node:product', scopeId: 'session:ec-shots', operationId: 'op:ec-plan', purpose: 'ecommerce-review' },
    ] as const

    for (const item of cases) {
      await runDirectText({
        storage: platform.storage,
        trace: directTextTrace({
          projectId: 'p1',
          ...item,
          channelId: 'ch1',
          model: 'm1',
          prompt: item.purpose,
        }),
        call: async () => `${item.purpose}:ok`,
      })
    }

    const rows = await platform.storage.query('runRecords', { projectId: 'p1' })
    expect(rows).toHaveLength(cases.length)
    for (const [index, row] of rows.entries()) {
      const expected = cases[index]!
      expect(row).toMatchObject({
        scopeVersion: 1,
        workbench: expected.workbench,
        subjectId: expected.subjectId,
        scopeId: expected.scopeId,
        operationId: expected.operationId,
        sentChannelId: 'ch1',
        sentModel: 'm1',
        status: 'succeeded',
      })
    }
    expect(new Set(rows.map((row) => row.operationId)).size).toBe(8)
  })
})
