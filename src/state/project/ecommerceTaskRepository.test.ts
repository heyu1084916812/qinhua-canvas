import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { EcommerceRequest } from '../../domain/ecommerce/types'
import { createEcommerceTaskRepository } from './ecommerceTaskRepository'

const request: EcommerceRequest = {
  usage: 'set',
  platformId: 'amazon',
  language: 'en',
  count: 2,
  ratio: '1:1',
  productNodeId: 'node-product',
  referenceNodeIds: [],
  note: '突出防水材质',
  model: 'GPT Image 2',
}

describe('电商任务 / 结果仓储（内存存储）', () => {
  it('create 一次落任务与 N 格 pending，latest 按 position 读回', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { task, results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-1',
      request,
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    expect(task.status).toBe('running')
    expect(results.map((r) => [r.position, r.status, r.nodeId])).toEqual([
      [0, 'pending', 'n1'],
      [1, 'pending', 'n2'],
    ])
    const latest = await repo.latestWithResults('p1')
    expect(latest?.task.id).toBe(task.id)
    expect(latest?.results.map((r) => r.nodeId)).toEqual(['n1', 'n2'])
  })

  it('逐张配置随结果落库：类型、比例、文案与共享视觉系统刷新后仍可追溯', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const created = await repo.create({
      projectId: 'p1',
      batchId: 'batch-meta',
      request: { ...request, ratio: 'smart' },
      nodeIds: ['n1', 'n2'],
      metadata: [
        {
          shotTitle: '核心卖点图',
          brief: '第一核心卖点',
          ratio: '4:3',
          headline: 'Keep paws dry',
          subheadline: 'Water-resistant surface',
          visualSystem: '清爽户外；字体：同一无衬线体系',
        },
        {
          shotTitle: '场景氛围图',
          brief: '宽幅环境',
          ratio: '21:9',
          headline: 'Outdoor days',
          visualSystem: '清爽户外；字体：同一无衬线体系',
        },
      ],
      at: 100,
    })
    expect(created.results.map((row) => row.shotTitle)).toEqual([
      '核心卖点图',
      '场景氛围图',
    ])
    const latest = await repo.latestWithResults('p1')
    expect(latest?.results.map((row) => row.ratio)).toEqual(['4:3', '21:9'])
    expect(latest?.results[0]?.headline).toBe('Keep paws dry')
    expect(latest?.results[1]?.visualSystem).toContain('同一无衬线体系')
  })

  it('更新逐格与整批状态后，latest 返回的是更新后的那一份', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { task, results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-1',
      request,
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: 'h1',
      mime: 'video/mp4',
      width: 64,
      height: 64,
    })
    await repo.updateResult({ ...results[1]!, status: 'failed', errorText: '上游 500' })
    await repo.updateTask({ ...task, status: 'partial', updatedAt: 200, errorText: '一张失败' })
    const latest = await repo.latestWithResults('p1')
    expect(latest?.task.status).toBe('partial')
    expect(latest?.task.errorText).toBe('一张失败')
    expect(latest?.results[0]?.assetHash).toBe('h1')
    expect(latest?.results[0]?.mime).toBe('video/mp4')
    expect(latest?.results[1]?.errorText).toBe('上游 500')
  })

  it('中断收口：running 任务下所有 pending / running 结果变 failed，可重复调用且不覆盖已完成项', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { task, results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-interrupt',
      request,
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: 'kept',
      updatedAt: 110,
    })
    const recovered = await repo.interruptUnfinished(task.id, '上次生成被中断，请重新生成', 200)
    expect(recovered?.task.status).toBe('partial')
    expect(recovered?.task.errorText).toContain('上次生成被中断')
    expect(recovered?.results.map((row) => [row.status, row.assetHash ?? ''])).toEqual([
      ['done', 'kept'],
      ['failed', ''],
    ])
    expect(await repo.interruptUnfinished(task.id, '再次收口', 300)).toBeNull()
  })

  it('失败记录可单独移除：成功结果保留，任务节点与状态重新收口', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-remove-failed',
      request,
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    await repo.updateResult({ ...results[0]!, status: 'done', assetHash: 'kept', updatedAt: 110 })
    await repo.updateResult({
      ...results[1]!,
      status: 'failed',
      errorText: '上游失败',
      updatedAt: 120,
    })
    const removed = await repo.removeResult(results[1]!.id, 200)
    expect(removed?.results.map((row) => [row.nodeId, row.status])).toEqual([['n1', 'done']])
    expect(removed?.task.nodeIds).toEqual(['n1'])
    expect(removed?.task.status).toBe('done')
    expect(removed?.task.errorText).toBeUndefined()
    expect(await repo.removeResult(results[0]!.id, 300)).toBeNull()
  })

  it('AI 编辑任务保存来源任务 / 来源结果 / 原图 hash，用于前后对比', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { task } = await repo.create({
      projectId: 'p1',
      batchId: 'edit-1',
      request: { ...request, usage: 'edit', count: 1, note: '只换背景' },
      nodeIds: ['n-edit'],
      sourceTaskId: 'task-origin',
      sourceResultId: 'result-origin',
      sourceAssetHash: 'hash-origin',
      at: 300,
    })
    expect(task.sourceTaskId).toBe('task-origin')
    expect(task.sourceResultId).toBe('result-origin')
    expect(task.sourceAssetHash).toBe('hash-origin')
    const latest = await repo.latestWithResults('p1')
    expect(latest?.task.sourceAssetHash).toBe('hash-origin')
  })

  it('appendResults 为抽卡承载节点追加结果行，位置接在队尾且任务回到 running', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const created = await repo.create({
      projectId: 'p1',
      batchId: 'batch-append',
      request,
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    const appended = await repo.appendResults(created.task.id, ['n3', 'n3', 'n4'])
    expect(appended.task.status).toBe('running')
    expect(appended.task.nodeIds).toEqual(['n1', 'n2', 'n3', 'n4'])
    expect(appended.results.map((r) => [r.position, r.status, r.nodeId])).toEqual([
      [0, 'pending', 'n1'],
      [1, 'pending', 'n2'],
      [2, 'pending', 'n3'],
      [3, 'pending', 'n4'],
    ])
    const latest = await repo.latestWithResults('p1')
    expect(latest?.results.map((r) => r.nodeId)).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('latest 选最近的一批；没有结果的任务不冒充当前结果', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    await repo.create({ projectId: 'p1', batchId: 'old', request, nodeIds: ['a'], at: 100 })
    await storage.put('ecommerceTasks', {
      id: 'empty-task',
      projectId: 'p1',
      batchId: 'empty',
      createdAt: 200,
      updatedAt: 200,
      status: 'running',
      request,
      nodeIds: [],
    })
    const latest = await repo.latestWithResults('p1')
    expect(latest?.task.batchId).toBe('old')
  })

  it('remove 只删这一批任务与结果，不碰别的项目', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const a = await repo.create({ projectId: 'p1', batchId: 'a', request, nodeIds: ['n1'], at: 1 })
    await repo.create({ projectId: 'p2', batchId: 'b', request, nodeIds: ['n2'], at: 2 })
    await repo.remove(a.task.id)
    expect(await storage.query('ecommerceTasks', { projectId: 'p1' })).toHaveLength(0)
    expect(await storage.query('ecommerceResults', { projectId: 'p1' })).toHaveLength(0)
    expect(await storage.query('ecommerceTasks', { projectId: 'p2' })).toHaveLength(1)
    expect(await repo.list('p2')).toHaveLength(1)
  })
})
