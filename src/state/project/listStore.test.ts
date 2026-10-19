import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { createProjectRepository } from './repository'
import type { ProjectRepository } from './repository'
import { createProjectListStore } from './listStore'

describe('ProjectListStore', () => {
  it('读取失败时结束 loading 并保留可读错误，不伪装成空列表', async () => {
    const repo = {
      list: async () => {
        throw new Error('shared store unavailable')
      },
    } as unknown as ProjectRepository
    const store = createProjectListStore(repo)

    await store.load()

    expect(store.getState().loading).toBe(false)
    expect(store.getState().loaded).toBe(false)
    expect(store.getState().error).toContain('shared store unavailable')
    expect(store.getState().visible).toEqual([])
  })

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
    // 软删（对账 #378 A3）：列表里只剩未删的，但底层行还在 —— 回收站能还原
    expect((await storage.query('projects', {})).map((r) => r.id)).toHaveLength(3)
    expect(await repo.listDeleted()).toHaveLength(2)
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
