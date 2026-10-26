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

    expect((await repo.query({ workbench: 'canvas' })).entries.map((e) => e.record.id)).toEqual([
      'r4',
      'r1',
    ])
    expect((await repo.query({ workbench: 'ecommerce' })).entries.map((e) => e.record.id)).toEqual([
      'r2',
    ])
    expect((await repo.query({ workbench: 'storyboard' })).entries.map((e) => e.record.id)).toEqual([
      'r3',
    ])
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

    const canvas = await repo.query({ workbench: 'canvas' })
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

    const page = await repo.query({ workbench: 'storyboard' })
    expect(page.entries.map((entry) => [entry.record.id, entry.scopeState])).toEqual([
      ['r4', 'scoped'],
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
})
