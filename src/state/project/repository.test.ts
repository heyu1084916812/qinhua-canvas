import { describe, it, expect } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { StoragePort } from '../../platform/ports'
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

  it('list 固定只查 projects / nodes / runRecords 三张表，不按项目逐个查询', async () => {
    const base = createMemoryStorage()
    const calls: string[] = []
    const tracked: StoragePort = {
      ...base,
      query: (async (table, filter, options) => {
        calls.push(table)
        return base.query(table, filter, options)
      }) as StoragePort['query'],
    }
    const repo = createProjectRepository(tracked)
    const projects = await Promise.all(
      Array.from({ length: 12 }, (_, index) => repo.create({ name: `P${index}` })),
    )
    for (const project of projects) {
      await tracked.put('nodes', { id: createId('node'), projectId: project.id, type: 'prompt' })
    }

    calls.length = 0
    const list = await repo.list()

    expect(list).toHaveLength(projects.length)
    expect(calls.filter((table) => ['projects', 'nodes', 'runRecords'].includes(table))).toEqual([
      'projects',
      'nodes',
      'runRecords',
    ])
  })

  it('remove 是软删：项目列表看不到，但节点 / 连线仍在（回收站可还原）', async () => {
    // ⚠️ 2026-10-09 口径变更（对账 #378 A3）：remove 从硬删改成软删。
    // 级联表一条都不动 —— 因为要支持回收站还原；真正级联清理由 purge / purgeAll 承担。
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: 'X' })
    await storage.put('nodes', { id: 'n1', projectId: p.id })
    await storage.put('edges', { id: 'e1', projectId: p.id })

    await repo.remove(p.id)

    expect(await repo.list()).toHaveLength(0)
    expect(await repo.listDeleted()).toHaveLength(1)
    expect(await storage.query('projects', {})).toHaveLength(1)
    expect(await storage.query('nodes', { projectId: p.id })).toHaveLength(1)
    expect(await storage.query('edges', { projectId: p.id })).toHaveLength(1)

    await repo.purge(p.id)
    expect(await storage.query('projects', {})).toHaveLength(0)
    expect(await storage.query('nodes', { projectId: p.id })).toHaveLength(0)
    expect(await storage.query('edges', { projectId: p.id })).toHaveLength(0)
  })

  /**
   * ★★ 删项目要把**所有带 projectId 的行**一起清掉。
   *
   * 这条是补漏：原先级联只列了 nodes / edges，`tasks` / `runRecords` /
   * `agentSessions` 全留在库里。用户看不见它们（查询一律按 projectId 过滤），
   * 所以「删干净了没有」读代码看不出来 —— 只有回读断言能抓。
   */
  it('★★ 删项目连执行日志与 Agent 会话一起清，且不误伤别的项目', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const a = await repo.create({ name: 'A' })
    const b = await repo.create({ name: 'B' })
    for (const p of [a, b]) {
      await storage.put('tasks', { id: `t-${p.id}`, projectId: p.id })
      await storage.put('runRecords', { id: `r-${p.id}`, projectId: p.id, nodeId: 'n1' })
      await storage.put('agentSessions', { id: `s-${p.id}`, projectId: p.id, messages: [] })
    }

    await repo.remove(a.id)

    // 软删后这些行**仍然在**（还原要用），永久删除才清 —— 口径见 repository.recycle.test.ts
    expect(await storage.query('tasks', { projectId: a.id })).toHaveLength(1)
    expect(await storage.query('runRecords', { projectId: a.id })).toHaveLength(1)
    expect(await storage.query('agentSessions', { projectId: a.id })).toHaveLength(1)
    // 另一个项目的一行都不能少
    expect(await storage.query('tasks', { projectId: b.id })).toHaveLength(1)
    expect(await storage.query('runRecords', { projectId: b.id })).toHaveLength(1)
    expect(await storage.query('agentSessions', { projectId: b.id })).toHaveLength(1)
  })

  it('removeMany 一次级联删除多个项目，不影响未选项目', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const a = await repo.create({ name: 'A' })
    const b = await repo.create({ name: 'B' })
    const keep = await repo.create({ name: '保留' })
    await storage.put('nodes', { id: 'na', projectId: a.id })
    await storage.put('edges', { id: 'eb', projectId: b.id })

    await repo.removeMany([a.id, b.id, a.id])

    // 软删：列表只剩未删的那个，但被删项目的图数据都还在
    expect((await repo.list()).map((r) => r.id)).toEqual([keep.id])
    expect(await repo.listDeleted()).toHaveLength(2)
    expect(await storage.query('nodes', { projectId: a.id })).toHaveLength(1)
    expect(await storage.query('edges', { projectId: b.id })).toHaveLength(1)
    expect(await storage.query('nodes', { projectId: keep.id })).toHaveLength(0)
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

  it('文件夹可混放画布 / 电商 / 漫剧，删除文件夹只把项目放回未归档', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const folder = await repo.createFolder('客户项目')
    const canvas = await repo.create({ name: '画布', workbench: 'canvas' })
    const ecommerce = await repo.create({ name: '电商', workbench: 'ecommerce' })
    const storyboard = await repo.create({ name: '漫剧', workbench: 'storyboard' })

    for (const item of [canvas, ecommerce, storyboard]) {
      await repo.setProjectFolder(item.id, folder.id)
    }

    const stored = await repo.list()
    expect(stored.filter((item) => item.folderId === folder.id)).toHaveLength(3)
    expect(new Set(stored.map((item) => item.workbench))).toEqual(
      new Set(['canvas', 'ecommerce', 'storyboard']),
    )

    await repo.removeFolder(folder.id)

    expect(await repo.listFolders()).toHaveLength(0)
    expect((await repo.list()).map((item) => item.folderId)).toEqual([null, null, null])
    expect(await storage.query('projects', {})).toHaveLength(3)
  })

  it('文件夹与项目都按置顶优先排序，取消置顶后字段被清掉', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const oldFolder = await repo.createFolder('旧文件夹')
    await new Promise((resolve) => setTimeout(resolve, 2))
    const newFolder = await repo.createFolder('新文件夹')
    const oldProject = await repo.create({ name: '旧项目' })
    await new Promise((resolve) => setTimeout(resolve, 2))
    await repo.create({ name: '新项目' })

    await repo.setFolderPinned(oldFolder.id, true)
    expect((await repo.listFolders()).map((item) => item.id)).toEqual([
      oldFolder.id,
      newFolder.id,
    ])
    await repo.setFolderPinned(oldFolder.id, false)
    expect((await repo.listFolders())[0].pinnedAt).toBeUndefined()

    await repo.setProjectPinned(oldProject.id, true)
    expect((await repo.list())[0].id).toBe(oldProject.id)
    await repo.setProjectPinned(oldProject.id, false)
    expect(
      (await repo.list()).find((item) => item.id === oldProject.id)?.pinnedAt,
    ).toBeUndefined()
  })

  it('创建项目可直接进文件夹；复制副本继承文件夹但不继承置顶', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const folder = await repo.createFolder('归档')
    const source = await repo.create({
      name: '原项目',
      workbench: 'ecommerce',
      folderId: folder.id,
    })
    await repo.setProjectPinned(source.id, true)

    const copy = await repo.duplicate(source.id)

    expect(copy.folderId).toBe(folder.id)
    expect(copy.pinnedAt).toBeUndefined()
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

  /**
   * ★★ 复制项目要带上漫剧文档（对账 #456）。
   *
   * `GRAPH_TABLES`（复制）与 `PROJECT_CASCADE_TABLES`（删除级联）是**两份不同的集合**，
   * 而 `storyboards` 当初只加进了删除那一份 ⇒ 复制出来的漫剧项目「有画布、没剧本」。
   */
  it('★★ duplicate 也抄漫剧文档：副本有自己的那一行，`projectId` 内外都换成副本 id', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: '漫剧原项目', workbench: 'storyboard' })
    const doc = {
      projectId: p.id,
      title: '雨夜快递',
      episodes: [{ id: 'ep1', name: '第一集', shots: [{ id: 'sh1', scene: '雨夜街道' }] }],
    }
    await storage.put('storyboards', { id: p.id, projectId: p.id, updatedAt: 1, doc })

    const copy = await repo.duplicate(p.id)

    const rows = await storage.query('storyboards', { projectId: copy.id })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(copy.id)
    const copied = rows[0].doc as typeof doc
    expect(copied.title).toBe('雨夜快递')
    expect(copied.episodes).toHaveLength(1)
    expect(copied.projectId).toBe(copy.id)
    // 原件一个字没动
    const origin = await storage.query('storyboards', { projectId: p.id })
    expect(origin).toHaveLength(1)
    expect((origin[0].doc as typeof doc).projectId).toBe(p.id)
  })

  it('★★ duplicate 也抄电商任务 / 结果：引用全换成副本，原结果表不动', async () => {
    const storage = createMemoryStorage()
    const repo = createProjectRepository(storage)
    const p = await repo.create({ name: '电商原项目', workbench: 'ecommerce' })
    await storage.put('nodes', {
      id: 'n1',
      projectId: p.id,
      type: 'generation',
      data: { prompt: '图', ecommerceBatch: 'batch-old' },
    })
    await storage.put('ecommerceTasks', {
      id: 'et1',
      projectId: p.id,
      batchId: 'batch-old',
      createdAt: 1,
      updatedAt: 1,
      status: 'done',
      request: { usage: 'main' },
      nodeIds: ['n1'],
    })
    await storage.put('ecommerceResults', {
      id: 'er1',
      projectId: p.id,
      taskId: 'et1',
      nodeId: 'n1',
      canvasCopyNodeId: 'n1',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
      status: 'done',
      assetHash: 'h1',
    })

    const copy = await repo.duplicate(p.id)

    const tasks = await storage.query('ecommerceTasks', { projectId: copy.id })
    const results = await storage.query('ecommerceResults', { projectId: copy.id })
    const copiedNodes = await storage.query('nodes', { projectId: copy.id })
    expect(tasks).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(tasks[0].id).not.toBe('et1')
    expect(results[0].id).not.toBe('er1')
    expect(results[0].taskId).toBe(tasks[0].id)
    expect(results[0].nodeId).toBe(copiedNodes[0].id)
    expect(results[0].canvasCopyNodeId).toBe(copiedNodes[0].id)
    expect((copiedNodes[0].data as { ecommerceBatch?: string }).ecommerceBatch).not.toBe(
      'batch-old',
    )
    expect(await storage.query('ecommerceTasks', { projectId: p.id })).toHaveLength(1)
    expect(await storage.query('ecommerceResults', { projectId: p.id })).toHaveLength(1)
  })
})
