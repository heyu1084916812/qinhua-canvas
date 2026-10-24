import { describe, expect, it, vi } from 'vitest'
import type { StoragePort } from '../../platform/ports'
import {
  countStorageProjects,
  countStorageRows,
  formatBytes,
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

  it('counts asset rows without requesting full binary payloads', async () => {
    const scan = vi.fn(async (_table, _batch, onBatch) => {
      await onBatch([{ id: 'a' }, { id: 'b' }] as never, { total: 2 })
      return 2
    })
    const storage = { scan } as unknown as StoragePort

    await expect(countStorageRows(storage, 'assets')).resolves.toBe(2)
    expect(scan).toHaveBeenCalledWith(
      'assets',
      50,
      expect.any(Function),
      { includePayload: false },
    )
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
})
