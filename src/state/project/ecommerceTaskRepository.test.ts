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
    await repo.updateResult({ ...results[0]!, status: 'done', assetHash: 'h1', width: 64, height: 64 })
    await repo.updateResult({ ...results[1]!, status: 'failed', errorText: '上游 500' })
    await repo.updateTask({ ...task, status: 'partial', updatedAt: 200, errorText: '一张失败' })
    const latest = await repo.latestWithResults('p1')
    expect(latest?.task.status).toBe('partial')
    expect(latest?.task.errorText).toBe('一张失败')
    expect(latest?.results[0]?.assetHash).toBe('h1')
    expect(latest?.results[1]?.errorText).toBe('上游 500')
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
