import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { RunRecord } from '../../domain/shared/execution/runRecord'
import type { WorkbenchId } from '../../domain/shared/workbench'
import { createRunLogRepository } from './runLogRepository'

function record(
  id: string,
  projectId: string,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    nodeId: `node-${id}`,
    projectId,
    version: 1,
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    status: 'succeeded',
    inputs: [],
    params: {},
    outputHashes: [],
    fingerprint: `fp-${id}`,
    taskId: `task-${id}`,
    durationMs: 1,
    ...overrides,
  }
}

function project(id: string, workbench: WorkbenchId) {
  return {
    id,
    workbench,
    name: id,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('runLogRepository', () => {
  it('三个工作台私有视图互不串线，总日志只聚合一份记录', async () => {
    const storage = createMemoryStorage()
    await storage.bulkPut('projects', [
      project('p-canvas', 'canvas'),
      project('p-commerce', 'ecommerce'),
      project('p-story', 'storyboard'),
    ] as never)
    await storage.bulkPut('runRecords', [
      record('r1', 'p-canvas', {
        scopeVersion: 1,
        workbench: 'canvas',
        subjectId: 'canvas-node',
        scopeId: 'plan:1',
        operationId: 'op:1',
      }),
      record('r2', 'p-commerce', {
        scopeVersion: 1,
        workbench: 'ecommerce',
        subjectId: 'result-1',
        scopeId: 'task:1',
        operationId: 'op:2',
      }),
      record('r3', 'p-story', {
        scopeVersion: 1,
        workbench: 'storyboard',
        subjectId: 'shot-1',
        scopeId: 'episode-1',
        operationId: 'op:3',
      }),
      record('r4', 'p-canvas', { nodeId: 'legacy-node' }),
      record('r5', 'p-canvas', {
        scopeVersion: 1,
        workbench: 'ecommerce',
        subjectId: 'bad',
        scopeId: 'bad',
        operationId: 'bad',
      }),
    ] as never)
    const repo = createRunLogRepository(storage)

    expect(
      (
        await repo.query({
          projectId: 'p-canvas',
          workbench: 'canvas',
        })
      ).entries.map((e) => e.record.id),
    ).toEqual(['r4', 'r1'])
    expect(
      (
        await repo.query({
          projectId: 'p-commerce',
          workbench: 'ecommerce',
        })
      ).entries.map((e) => e.record.id),
    ).toEqual(['r2'])
    expect(
      (
        await repo.query({
          projectId: 'p-story',
          workbench: 'storyboard',
        })
      ).entries.map((e) => e.record.id),
    ).toEqual(['r3'])
    const all = await repo.query()
    expect(all.total).toBe(5)
    expect(all.entries.find((entry) => entry.record.id === 'r5')?.scopeState).toBe(
      'unclassified',
    )
  })

  it('旧记录只在项目工作台可证明时做 legacy 推断', async () => {
    const storage = createMemoryStorage()
    await storage.put('projects', project('p1', 'canvas') as never)
    await storage.bulkPut('runRecords', [
      record('r1', 'p1'),
      record('r2', 'missing-project'),
      record('r3', 'p1', {
        scopeVersion: 1,
        workbench: 'storyboard',
        subjectId: 'shot-1',
        scopeId: 'episode-1',
        operationId: 'op:3',
      }),
    ] as never)
    const repo = createRunLogRepository(storage)

    const canvas = await repo.query({
      projectId: 'p1',
      workbench: 'canvas',
    })
    expect(canvas.entries.map((entry) => [entry.record.id, entry.scopeState])).toEqual([
      ['r1', 'legacy'],
    ])
    const all = await repo.query()
    expect(all.entries.map((entry) => [entry.record.id, entry.scopeState])).toEqual([
      ['r3', 'unclassified'],
      ['r2', 'unclassified'],
      ['r1', 'legacy'],
    ])
  })

  it('按主体、范围、状态和时间过滤，并稳定分页', async () => {
    const storage = createMemoryStorage()
    await storage.put('projects', project('p1', 'storyboard') as never)
    await storage.bulkPut('runRecords', [
      record('r1', 'p1', {
        createdAt: 10,
        status: 'failed',
        scopeVersion: 1,
        workbench: 'storyboard',
        subjectId: 'shot-1',
        scopeId: 'episode-1',
        operationId: 'op:1',
      }),
      record('r2', 'p1', {
        createdAt: 20,
        scopeVersion: 1,
        workbench: 'storyboard',
        subjectId: 'shot-1',
        scopeId: 'episode-1',
        operationId: 'op:2',
      }),
      record('r3', 'p1', {
        createdAt: 30,
        scopeVersion: 1,
        workbench: 'storyboard',
        subjectId: 'shot-2',
        scopeId: 'episode-2',
        operationId: 'op:3',
      }),
    ] as never)
    const repo = createRunLogRepository(storage)

    const page = await repo.query({
      projectId: 'p1',
      workbench: 'storyboard',
      subjectId: 'shot-1',
      scopeId: 'episode-1',
      from: 10,
      to: 20,
      offset: 1,
      limit: 1,
    })
    expect(page.total).toBe(2)
    expect(page.entries.map((entry) => entry.record.id)).toEqual(['r1'])
    expect(
      (
        await repo.query({
          projectId: 'p1',
          workbench: 'storyboard',
          status: 'failed',
        })
      ).entries.map((entry) => entry.record.id),
    ).toEqual(['r1'])
  })

  it('无效、跨项目和成环的 parentRunId 进入未分类', async () => {
    const storage = createMemoryStorage()
    await storage.bulkPut('projects', [
      project('p1', 'storyboard'),
      project('p2', 'storyboard'),
    ] as never)
    const scoped = (id: string, projectId: string, parentRunId?: string) =>
      record(id, projectId, {
        scopeVersion: 1,
        workbench: 'storyboard',
        subjectId: `shot-${id}`,
        scopeId: 'episode-1',
        operationId: `op-${id}`,
        ...(parentRunId ? { parentRunId } : {}),
      })
    await storage.bulkPut('runRecords', [
      scoped('r1', 'p1'),
      scoped('r2', 'p1', 'missing'),
      scoped('r3', 'p1', 'r4'),
      scoped('r4', 'p2'),
      scoped('r5', 'p1', 'r6'),
      scoped('r6', 'p1', 'r5'),
    ] as never)
    const repo = createRunLogRepository(storage)

    const page = await repo.query({
      projectId: 'p1',
      workbench: 'storyboard',
    })
    expect(page.entries.map((entry) => [entry.record.id, entry.scopeState])).toEqual([
      ['r1', 'scoped'],
    ])
    const all = await repo.query()
    expect(
      all.entries
        .filter((entry) => entry.scopeState === 'unclassified')
        .map((entry) => entry.record.id)
        .sort(),
    ).toEqual(['r2', 'r3', 'r5', 'r6'])
  })

  it('递归校验全部祖先：祖父缺失、父无效、跨工作台和项目缺失都向外传播', async () => {
    const storage = createMemoryStorage()
    await storage.bulkPut('projects', [
      project('p1', 'storyboard'),
      project('p2', 'storyboard'),
      project('p3', 'ecommerce'),
    ] as never)
    const scoped = (
      id: string,
      projectId: string,
      overrides: Partial<RunRecord> = {},
    ) =>
      record(id, projectId, {
        scopeVersion: 1,
        workbench: 'storyboard',
        action: 'shot-image',
        subjectId: `shot-${id}`,
        scopeId: 'episode:1',
        operationId: `op-${id}`,
        ...overrides,
      })
    await storage.bulkPut('runRecords', [
      scoped('r1', 'p1'),
      scoped('r2', 'p1', { parentRunId: 'r1' }),
      scoped('r3', 'p1', { parentRunId: 'r2' }),
      scoped('r4', 'p1', { parentRunId: 'missing' }),
      scoped('r5', 'p1', { parentRunId: 'r4' }),
      scoped('r6', 'p1', { workbench: 'ecommerce' }),
      scoped('r7', 'p1', { parentRunId: 'r6' }),
      scoped('r8', 'p1', { parentRunId: 'r9' }),
      scoped('r9', 'p2'),
      scoped('r10', 'p1', { parentRunId: 'r11' }),
      scoped('r11', 'p1', { parentRunId: 'r10' }),
      scoped('r12', 'missing-project'),
      scoped('r13', 'p1', { parentRunId: 'r12' }),
      scoped('r14', 'p3', { workbench: 'ecommerce' }),
      scoped('r15', 'p1', { parentRunId: 'r10' }),
    ] as never)
    const repo = createRunLogRepository(storage)

    const privatePage = await repo.query({
      projectId: 'p1',
      workbench: 'storyboard',
    })
    expect(privatePage.entries.map((entry) => entry.record.id)).toEqual([
      'r3',
      'r2',
      'r1',
    ])
    expect(privatePage.total).toBe(3)

    const aggregate = await repo.query({ scopeState: 'unclassified' })
    const invalid = aggregate.entries.map((entry) => entry.record.id)
    expect(invalid).toEqual(
      expect.arrayContaining([
        'r4',
        'r5',
        'r6',
        'r7',
        'r8',
        'r10',
        'r11',
        'r12',
        'r13',
        'r15',
      ]),
    )
    expect(invalid).not.toContain('r3')
    expect(invalid).not.toContain('r14')
  })

  it('动作、operation、subject、scope 与 scopeState 可组合过滤，工作台同 subjectId 不串线', async () => {
    const storage = createMemoryStorage()
    await storage.bulkPut('projects', [
      project('p-story', 'storyboard'),
      project('p-shop', 'ecommerce'),
      project('p-canvas', 'canvas'),
    ] as never)
    await storage.bulkPut('runRecords', [
      record('r1', 'p-story', {
        createdAt: 30,
        scopeVersion: 1,
        workbench: 'storyboard',
        action: 'shot-image',
        subjectId: 'shared-subject',
        scopeId: 'episode:1',
        operationId: 'op:image',
      }),
      record('r2', 'p-shop', {
        createdAt: 20,
        scopeVersion: 1,
        workbench: 'ecommerce',
        action: 'result-image',
        subjectId: 'shared-subject',
        scopeId: 'task:1',
        operationId: 'op:commerce',
      }),
      record('r3', 'p-canvas', {
        createdAt: 10,
        nodeId: 'legacy-node',
      }),
    ] as never)
    const repo = createRunLogRepository(storage)

    const storyboard = await repo.query({
      projectId: 'p-story',
      workbench: 'storyboard',
      subjectId: 'shared-subject',
      operationId: 'op:image',
      scopeId: 'episode:1',
      action: 'shot-image',
      scopeState: 'scoped',
    })
    expect(storyboard.entries.map((entry) => entry.record.id)).toEqual(['r1'])

    const ecommerce = await repo.query({
      projectId: 'p-shop',
      workbench: 'ecommerce',
      subjectId: 'shared-subject',
    })
    expect(ecommerce.entries.map((entry) => entry.record.id)).toEqual(['r2'])

    const legacy = await repo.query({
      projectId: 'p-canvas',
      workbench: 'canvas',
      scopeState: 'legacy',
    })
    expect(legacy.entries.map((entry) => entry.record.id)).toEqual(['r3'])

    const aggregateAction = await repo.query({ action: 'shot-image' })
    expect(aggregateAction.entries.map((entry) => entry.record.id)).toEqual(['r1'])
    await expect(
      repo.query({ projectId: 'p-story', workbench: 'storyboard', scopeState: 'unclassified' }),
    ).rejects.toThrow('未分类记录只能在总日志聚合查询中读取')
    await expect(repo.query({ workbench: 'storyboard' })).rejects.toThrow(
      '必须同时绑定 projectId + workbench',
    )
    const aggregateWorkbench = await repo.query({
      workbench: 'storyboard',
      aggregate: true,
    })
    expect(aggregateWorkbench.entries.map((entry) => entry.record.id)).toEqual(['r1'])
  })

  it('198 / 201 分页边界在存储查询内稳定切片，旧记录仍可兼容读取', async () => {
    const storage = createMemoryStorage()
    await storage.bulkPut('projects', [
      project('p1', 'storyboard'),
      project('p2', 'canvas'),
    ] as never)
    const rows = Array.from({ length: 450 }, (_, index) =>
      record(`r${index + 1}`, 'p1', {
        createdAt: index + 1,
        scopeVersion: 1,
        workbench: 'storyboard',
        action: 'shot-image',
        subjectId: `shot-${index + 1}`,
        scopeId: 'episode:1',
        operationId: `op-${index + 1}`,
      }),
    )
    rows.push(
      record('legacy-1', 'p2', {
        createdAt: 1,
        nodeId: 'legacy-node',
      }),
    )
    await storage.bulkPut('runRecords', rows as never)
    const calls: string[] = []
    const query = storage.query.bind(storage)
    const queryPage = storage.queryPage!.bind(storage)
    storage.query = async (table, filter, options) => {
      calls.push(`query:${table}`)
      return query(table, filter, options)
    }
    storage.queryPage = async (table, filter, options) => {
      calls.push(`page:${table}`)
      return queryPage(table, filter, options)
    }
    const repo = createRunLogRepository(storage)

    const first = await repo.query({
      projectId: 'p1',
      workbench: 'storyboard',
      action: 'shot-image',
      limit: 198,
    })
    const at198 = await repo.query({
      projectId: 'p1',
      workbench: 'storyboard',
      action: 'shot-image',
      offset: 198,
      limit: 3,
    })
    const at201 = await repo.query({
      projectId: 'p1',
      workbench: 'storyboard',
      action: 'shot-image',
      offset: 201,
      limit: 1,
    })
    expect(first.entries).toHaveLength(198)
    expect(first.total).toBe(450)
    expect(at198.entries).toHaveLength(3)
    expect(at201.entries).toHaveLength(1)
    expect(new Set([...first.entries, ...at198.entries].map((entry) => entry.record.id)).size).toBe(
      201,
    )
    expect(calls).not.toContain('query:runRecords')
    expect(calls.filter((call) => call === 'page:runRecords').length).toBeGreaterThan(1)

    const canvas = await repo.query({
      projectId: 'p2',
      workbench: 'canvas',
    })
    expect(canvas.entries.map((entry) => [entry.record.id, entry.scopeState])).toEqual([
      ['legacy-1', 'legacy'],
    ])
  })
})
