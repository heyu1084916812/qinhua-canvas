import { describe, it, expect } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { createProjectRepository } from './repository'
import { createId } from '../../shared/id'

/**
 * 仓储单测（node 环境，走内存存储，不碰 IndexedDB）。
 * 覆盖：创建落库、列表排序与节点计数、删除级联清图。
 */
describe('ProjectRepository（内存存储）', () => {
  it('create 写入 projects 表并回传 nodeCount=0 的项', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const item = await repo.create({ name: '我的项目' })
    expect(item.name).toBe('我的项目')
    expect(item.nodeCount).toBe(0)
    const rows = await storage.query('projects', {})
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(item.id)
  })

  it('list 按 updatedAt 倒序并统计节点数', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const a = await repo.create({ name: 'A' })
    await new Promise((r) => setTimeout(r, 2))
    const b = await repo.create({ name: 'B' })
    await storage.put('nodes', { id: createId('node'), projectId: a.id, type: 'prompt' })
    await storage.put('nodes', { id: createId('node'), projectId: a.id, type: 'prompt' })

    const list = await repo.list()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(b.id) // b 创建更晚 → 排前面
    const aItem = list.find((p) => p.id === a.id)!
    expect(aItem.nodeCount).toBe(2)
  })

  it('remove 级联删除图数据（nodes/edges/resultGroups）', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: 'X' })
    await storage.put('nodes', { id: 'n1', projectId: p.id })
    await storage.put('edges', { id: 'e1', projectId: p.id })

    await repo.remove(p.id)

    expect(await storage.query('projects', {})).toHaveLength(0)
    expect(await storage.query('nodes', { projectId: p.id })).toHaveLength(0)
    expect(await storage.query('edges', { projectId: p.id })).toHaveLength(0)
  })

  it('rename 更新名称与 updatedAt', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: '旧名' })
    await repo.rename(p.id, '新名')
    const after = await repo.get(p.id)
    expect(after?.name).toBe('新名')
    expect(after?.updatedAt).toBeGreaterThanOrEqual(p.updatedAt)
  })

  it('duplicate 复制项目与图数据，节点/连线 id 重映射且归属新项目', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: '原项目' })
    await storage.put('nodes', { id: 'n1', projectId: p.id, type: 'prompt' })
    await storage.put('nodes', { id: 'n2', projectId: p.id, type: 'generation' })
    await storage.put('edges', { id: 'e1', projectId: p.id, source: 'n1', target: 'n2' })

    const copy = await repo.duplicate(p.id)
    expect(copy.id).not.toBe(p.id)
    expect(copy.name).toBe('原项目 副本')
    expect(copy.nodeCount).toBe(2)

    const nodes = await storage.query('nodes', { projectId: copy.id })
    const edges = await storage.query('edges', { projectId: copy.id })
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    // 连线端点已重映射到副本节点 id
    const ids = new Set(nodes.map((n) => String(n.id)))
    expect(ids.has(String(edges[0].source))).toBe(true)
    expect(ids.has(String(edges[0].target))).toBe(true)
    // 原项目未被改动
    expect(await storage.query('nodes', { projectId: p.id })).toHaveLength(2)
  })
})
