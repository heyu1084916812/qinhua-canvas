import { describe, expect, it, vi } from 'vitest'
import { emptyStoryboard } from '../../domain/storyboard/storyboard'
import { createMemoryStorage } from '../../platform/memory'
import type { StoragePort } from '../../platform/ports'
import { createStoryboardStore } from './storyboardStore'

describe('storyboardStore 写入队列', () => {
  it('不同 Store 实例对同一项目的保存串行，读取会等最后一次写完', async () => {
    const memory = createMemoryStorage()
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let writes = 0
    const storage = {
      ...memory,
      async put(table: 'storyboards', row: Record<string, unknown>) {
        writes += 1
        if (writes === 1) await firstGate
        return memory.put(table as never, row as never)
      },
    } as StoragePort
    const pageStore = createStoryboardStore(storage)
    const executorStore = createStoryboardStore(storage)
    const first = {
      ...emptyStoryboard('project-1'),
      script: { title: 'first', body: '', logline: '' },
    }
    const second = {
      ...first,
      script: { title: 'second', body: '', logline: '' },
    }

    const saveFirst = pageStore.save(first)
    const saveSecond = executorStore.save(second)
    const load = pageStore.load('project-1')
    releaseFirst()

    await Promise.all([saveFirst, saveSecond])
    expect((await load).script.title).toBe('second')
  })

  it('一次保存失败不会毒化后续队列', async () => {
    const memory = createMemoryStorage()
    const put = vi
      .spyOn(memory, 'put')
      .mockRejectedValueOnce(new Error('disk full'))
    const store = createStoryboardStore(memory)
    const doc = emptyStoryboard('project-1')

    await expect(store.save(doc)).rejects.toThrow('disk full')
    await expect(store.save({ ...doc, updatedAt: 2 })).resolves.toBeUndefined()
    expect(put).toHaveBeenCalledTimes(2)
    expect((await store.load('project-1')).updatedAt).toBe(2)
  })
})
