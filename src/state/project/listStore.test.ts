import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { createProjectRepository } from './repository'
import { createProjectListStore } from './listStore'

describe('ProjectListStore', () => {
  it('removeMany 原子更新列表并保留未选项目', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const store = createProjectListStore(repo)
    const a = await repo.create({ name: 'A' })
    const b = await repo.create({ name: 'B' })
    const keep = await repo.create({ name: '保留' })

    await store.load()
    await store.removeMany([a.id, b.id])

    expect(store.getState().projects.map((p) => p.id)).toEqual([keep.id])
    expect(store.getState().visible.map((p) => p.id)).toEqual([keep.id])
    expect((await storage.query('projects', {})).map((r) => r.id)).toEqual([keep.id])
  })

  it('removeMany 去重且空数组不发仓储调用之外的更新', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const store = createProjectListStore(repo)
    const a = await repo.create({ name: 'A' })
    await store.load()

    await store.removeMany([a.id, a.id])
    await store.removeMany([])

    expect(store.getState().projects).toHaveLength(0)
  })
})
