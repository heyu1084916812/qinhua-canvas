import { describe, expect, it, vi } from 'vitest'
import type { StoragePort } from '../../platform/ports'
import {
  countStorageAssets,
  countStorageProjects,
  formatBytes,
  rootKindLabel,
  storageUsagePercent,
} from './StoragePanel'

describe('StoragePanel helpers', () => {
  it('formats storage sizes without inventing precision', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })

  it('returns a bounded percentage only when quota is real', () => {
    expect(storageUsagePercent(null)).toBeNull()
    expect(storageUsagePercent({ used: 10, quota: 0 })).toBeNull()
    expect(storageUsagePercent({ used: 25, quota: 100 })).toBe(25)
    expect(storageUsagePercent({ used: 120, quota: 100 })).toBe(100)
    expect(storageUsagePercent({ used: 1, quota: 3 })).toBe(33.3)
  })

  it('counts only live projects without loading project payloads', async () => {
    const scan = vi.fn(async (_table, _batch, onBatch) => {
      await onBatch([{ id: 'p1' }, { id: 'p2', deletedAt: 1 }] as never, { total: 2 })
      return 2
    })
    const storage = { scan } as unknown as StoragePort

    await expect(countStorageProjects(storage)).resolves.toBe(1)
    expect(scan).toHaveBeenCalledWith(
      'projects',
      50,
      expect.any(Function),
      { includePayload: false },
    )
  })

  it('uses the same deduplicated asset count as the assets page', async () => {
    const now = Date.now()
    const scan = vi.fn(async (_table, _batch, onBatch) => {
      await onBatch(
        [
          { id: 'image', hash: 'image', mime: 'image/png', bytesLength: 10 },
          { id: 'video', hash: 'video', mime: 'video/mp4', bytesLength: 20 },
          { id: 'hidden', hash: 'hidden', mime: 'image/png', bytesLength: 30 },
        ] as never,
        { total: 3 },
      )
      return 3
    })
    const query = vi.fn(async (table: string) => {
      if (table === 'runRecords') {
        return [
          {
            id: 'run-1',
            nodeId: 'node-1',
            projectId: 'project-1',
            version: 1,
            createdAt: now,
            status: 'succeeded',
            inputs: [],
            params: { prompt: 'fixture', model: 'image-model' },
            outputHashes: ['image', 'video', 'hidden'],
            fingerprint: 'fingerprint',
            taskId: 'task-1',
            durationMs: 1,
          },
        ]
      }
      if (table === 'assetLibrary') {
        return [{ id: 'uploaded', hash: 'uploaded', mime: 'image/webp', savedAt: now }]
      }
      if (table === 'presets') {
        return [{ id: 'assetRecordsHidden:v1', hashes: ['hidden'] }]
      }
      return []
    })
    const storage = { scan, query } as unknown as StoragePort

    await expect(countStorageAssets(storage, now)).resolves.toMatchObject({
      all: 3,
      image: 2,
      video: 1,
      audio: 0,
      saved: 1,
    })
    expect(scan).toHaveBeenCalledWith(
      'assets',
      8,
      expect.any(Function),
      { includePayload: false },
    )
  })

  it('labels every resource-root state without pretending partial data is usable', () => {
    expect(
      rootKindLabel({ path: 'D:/data', kind: 'v2', ready: true }),
    ).toBe('V2')
    expect(
      rootKindLabel({ path: 'D:/data', kind: 'partial', ready: false }),
    ).toBe('迁移未完成')
    expect(
      rootKindLabel({ path: 'D:/data', kind: 'unknown', ready: false }),
    ).toBe('不可用')
  })
})
