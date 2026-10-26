import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { PlatformKit } from '../../platform/ports'
import { ChannelError } from '../../platform/channels/types'
import { runDirectGeneration, type DirectRunTraceInput } from './directRun'

const trace: DirectRunTraceInput = {
  projectId: 'p1',
  scopeVersion: 1,
  workbench: 'storyboard',
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
      call: async () => 'generated',
      outputHashesOf: () => [],
    })

    expect(finished.result).toBe('generated')
    expect(attempts).toBe(2)
    expect(finished.recordWarning).toContain('disk busy')
    expect(finished.record.status).toBe('succeeded')
  })
})
