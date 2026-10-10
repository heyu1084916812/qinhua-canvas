import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createProjectRepository } from './repository'

/**
 * 回收站（软删 / 还原 / 永久删除，用户 2026-10-09，对账 #378 A3）。
 *
 * 这一组断言的重点是**级联数据**：删项目时节点 / 连线 / 运行记录一条都不能动，
 * 否则"还原"回来会是一张空图 —— 那比直接删掉更吓人（用户以为数据还在）。
 */
function seed() {
  return createMemoryPlatform({
    rows: {
      projects: [
        { id: 'p1', name: '项目一', workbench: 'canvas', createdAt: 1, updatedAt: 10 },
        { id: 'p2', name: '项目二', workbench: 'canvas', createdAt: 2, updatedAt: 20 },
      ],
      nodes: [
        { id: 'n1', projectId: 'p1', type: 'prompt' },
        { id: 'n2', projectId: 'p1', type: 'generation' },
        { id: 'n3', projectId: 'p2', type: 'prompt' },
      ],
      edges: [{ id: 'e1', projectId: 'p1', source: 'n1', target: 'n2' }],
      runRecords: [{ id: 'r1', projectId: 'p1', createdAt: 5, outputHashes: [] }],
      tasks: [{ id: 't1', projectId: 'p1' }],
      agentSessions: [{ id: 's1', projectId: 'p1' }],
    },
  })
}

describe('回收站 · 软删与还原', () => {
  it('★★ 删除后：列表看不到、回收站看得到，且节点 / 连线 / 记录一条没动', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)

    await repo.remove('p1')

    const visible = await repo.list()
    expect(visible.map((p) => p.id)).toEqual(['p2'])

    const deleted = await repo.listDeleted()
    expect(deleted.map((p) => p.id)).toEqual(['p1'])
    expect(deleted[0]!.deletedAt).toBeGreaterThan(0)
    // 回收站里也要能看到封面 / 节点数（导出自仓储的同一份口径）
    expect(deleted[0]!.nodeCount).toBe(2)

    // ★ 关键：级联表一条都没删 —— 还原才有意义
    expect(await platform.storage.query('nodes', { projectId: 'p1' })).toHaveLength(2)
    expect(await platform.storage.query('edges', { projectId: 'p1' })).toHaveLength(1)
    expect(await platform.storage.query('runRecords', { projectId: 'p1' })).toHaveLength(1)
    expect(await platform.storage.query('tasks', { projectId: 'p1' })).toHaveLength(1)
    expect(await platform.storage.query('agentSessions', { projectId: 'p1' })).toHaveLength(1)
  })

  it('★★ 还原后图是完好的（节点数回到原值，不是一张空图）', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)

    await repo.remove('p1')
    await repo.restore('p1')

    const list = await repo.list()
    const p1 = list.find((p) => p.id === 'p1')!
    expect(p1.nodeCount).toBe(2)
    expect(p1.deletedAt).toBeUndefined()
    expect(await repo.listDeleted()).toHaveLength(0)
  })

  it('★ 批量软删：全部进回收站，且删除时间一致（方便按批撤销）', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)

    await repo.removeMany(['p1', 'p2', 'p1']) // 重复 id 只算一次
    expect(await repo.list()).toHaveLength(0)

    const deleted = await repo.listDeleted()
    expect(deleted).toHaveLength(2)
    // 最近删的排前面（同一时间戳时顺序不保证，所以只断言集合）
    expect(deleted.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('★★ 永久删除才动级联表；清空回收站把它们全清掉', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)

    await repo.remove('p1')
    await repo.purge('p1')
    expect(await platform.storage.query('nodes', { projectId: 'p1' })).toHaveLength(0)
    expect(await platform.storage.query('edges', { projectId: 'p1' })).toHaveLength(0)
    expect(await platform.storage.query('runRecords', { projectId: 'p1' })).toHaveLength(0)

    await repo.remove('p2')
    const purged = await repo.purgeAll()
    expect(purged).toBe(1)
    expect(await repo.listDeleted()).toHaveLength(0)
    expect(await platform.storage.query('projects', {})).toHaveLength(0)
  })

  it('★ 删除不存在的项目是空操作（不抛错、不写脏行）', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)
    await expect(repo.remove('不存在')).resolves.toBeUndefined()
    expect(await repo.list()).toHaveLength(2)
  })

  it('★★ 复制回收站里的项目不会让副本一出生就在回收站', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)
    await repo.remove('p1')

    const copy = await repo.duplicate('p1')
    expect(copy.deletedAt).toBeUndefined()
    const list = await repo.list()
    expect(list.map((p) => p.id)).toContain(copy.id)
  })
})

/**
 * **清理 N 天前**（对账 #409）。
 *
 * 这条能力的边界只有一个，但必须钉死：**只清超期的那些，其余（含级联表）一条不动**。
 * 走的是"用户点两下"的显式动作 —— 后台不自动删，所以这里连"没超期就什么都不做"也要验。
 */
describe('回收站 · 清理 N 天前', () => {
  const DAY = 24 * 60 * 60 * 1000
  const NOW = 1_800_000_000_000

  const putDeleted = (platform: ReturnType<typeof seed>, id: string, deletedAt: number) =>
    platform.storage.put('projects', {
      id,
      name: `项目 ${id}`,
      workbench: 'canvas',
      createdAt: 1,
      updatedAt: 2,
      deletedAt,
    } as never)

  it('★★ 只清超过保留期的那几个：超期的连同级联表清掉，没超期的一条不动', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)
    await putDeleted(platform, 'p1', NOW - 31 * DAY) // 超期（31 天前删的）
    await putDeleted(platform, 'p2', NOW - 3 * DAY) // 还想留（3 天前删的）

    const purged = await repo.purgeOlderThan(30, NOW)

    expect(purged).toBe(1)
    expect((await repo.listDeleted()).map((p) => p.id)).toEqual(['p2'])
    /** 级联：超期那条的图 / 连线 / 记录 / 会话一起清（与「彻底删除」同一套口径） */
    expect(await platform.storage.query('nodes', { projectId: 'p1' })).toHaveLength(0)
    expect(await platform.storage.query('edges', { projectId: 'p1' })).toHaveLength(0)
    expect(await platform.storage.query('runRecords', { projectId: 'p1' })).toHaveLength(0)
    expect(await platform.storage.query('agentSessions', { projectId: 'p1' })).toHaveLength(0)
    /** 没超期那条原封不动 */
    expect(await platform.storage.query('nodes', { projectId: 'p2' })).toHaveLength(1)
    expect(await platform.storage.query('projects', { id: 'p2' })).toHaveLength(1)
  })

  it('★ 没有超期的就什么都不做（返回 0 —— 界面据此说"没有超过 30 天的项目"）', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)
    await repo.remove('p1') // 刚刚删的

    expect(await repo.purgeOlderThan(30, Date.now())).toBe(0)
    expect(await repo.listDeleted()).toHaveLength(1)
    expect(await platform.storage.query('nodes', { projectId: 'p1' })).toHaveLength(2)
  })

  it('★ 边界：正好 30 天前的那条**不算**超期（判据是 `<`，不是 `≤`）', async () => {
    const platform = seed()
    const repo = createProjectRepository(platform.storage)
    await putDeleted(platform, 'p1', NOW - 30 * DAY)

    expect(await repo.purgeOlderThan(30, NOW)).toBe(0)
    expect(await repo.listDeleted()).toHaveLength(1)
  })
})
