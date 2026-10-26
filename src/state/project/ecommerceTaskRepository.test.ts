import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { sha1Bytes } from '../../domain/shared/hash'
import type { EcommerceRequest } from '../../domain/ecommerce/types'
import type { AssetPort } from '../../platform/ports'
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

  it('成功 RunRecord 必须把产物 hash 回填到结果行，done 缺 hash 的历史行也会补账', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const hash1 = sha1Bytes(new Uint8Array([1])).slice(0, 16)
    const hash2 = sha1Bytes(new Uint8Array([2])).slice(0, 16)
    const { task, results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-reconcile-hash',
      request,
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    await repo.updateResult({
      ...results[1]!,
      status: 'done',
      updatedAt: 110,
    })
    await storage.put('runRecords', {
      id: 'run-1',
      nodeId: 'n1',
      projectId: 'p1',
      version: 1,
      createdAt: 120,
      status: 'succeeded',
      inputs: [],
      params: {},
      outputHashes: [hash1],
      fingerprint: 'fp-1',
      taskId: 'task-1',
      durationMs: 10,
      sentModel: 'gpt-image-2',
      outputWidth: 1024,
      outputHeight: 1024,
    })
    await storage.put('runRecords', {
      id: 'run-2',
      nodeId: 'n2',
      projectId: 'p1',
      version: 1,
      createdAt: 130,
      status: 'succeeded',
      inputs: [],
      params: {},
      outputHashes: [hash2],
      fingerprint: 'fp-2',
      taskId: 'task-2',
      durationMs: 10,
    })
    await storage.put('assets', {
      id: hash1,
      hash: hash1,
      mime: 'image/png',
      bytes: new Uint8Array([1]),
      createdAt: 120,
      projectId: 'p1',
    })
    await storage.put('assets', {
      id: hash2,
      hash: hash2,
      mime: 'image/png',
      bytes: new Uint8Array([2]),
      createdAt: 130,
      projectId: 'p1',
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)
    expect(reconciled.results.map((row) => [row.status, row.assetHash ?? ''])).toEqual([
      ['done', hash1],
      ['done', hash2],
    ])
    expect(reconciled.results[0]?.width).toBe(1024)
    expect(reconciled.results[0]?.model).toBe('gpt-image-2')
    expect(reconciled.tasks.find((row) => row.id === task.id)?.status).toBe('done')
  })

  it('RunRecord 报成功却没有产物时不伪装成 done', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-empty-success',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    await storage.put('runRecords', {
      id: 'run-empty',
      nodeId: 'n1',
      projectId: 'p1',
      version: 1,
      createdAt: 120,
      status: 'succeeded',
      inputs: [],
      params: {},
      outputHashes: [],
      fingerprint: 'fp-empty',
      taskId: 'task-empty',
      durationMs: 10,
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)
    expect(reconciled.results[0]?.status).toBe('failed')
    expect(reconciled.results[0]?.errorText).toContain('没有找到可展示的产物')
    expect(reconciled.results[0]?.id).toBe(results[0]?.id)
  })

  it('成功 RunRecord 只给 hash、素材字节缺失时停在 retry-save', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-missing-bytes',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    await storage.put('runRecords', {
      id: 'run-missing-bytes',
      nodeId: 'n1',
      projectId: 'p1',
      version: 1,
      createdAt: 120,
      status: 'succeeded',
      inputs: [],
      params: {},
      outputHashes: ['missing-bytes'],
      fingerprint: 'fp-missing-bytes',
      taskId: 'task-missing-bytes',
      durationMs: 10,
    })
    await storage.put('assetSaveQueue', {
      id: results[0]!.id,
      projectId: 'p1',
      resultId: results[0]!.id,
      taskId: results[0]!.taskId,
      planId: 'plan-missing-bytes',
      prompt: '待保存',
      model: 'image-model',
      assets: [
        {
          hash: 'missing-bytes',
          mime: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
      createdAt: 120,
      updatedAt: 120,
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)
    expect(reconciled.results[0]).toMatchObject({
      status: 'failed',
      recovery: 'retry-save',
      id: results[0]?.id,
    })
    expect(reconciled.results[0]?.assetHash).toBeUndefined()
    expect(reconciled.results[0]?.errorText).toContain('素材字节不在库中')
    expect(reconciled.tasks[0]?.status).toBe('failed')
  })

  it('素材行存在但字节损坏、hash 不匹配时也停在 retry-save', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-corrupt-bytes',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    const expectedHash = sha1Bytes(new Uint8Array([1, 2, 3])).slice(0, 16)
    await storage.put('assets', {
      id: expectedHash,
      hash: expectedHash,
      mime: 'image/png',
      bytes: new Uint8Array([9, 9, 9]),
      createdAt: 110,
      projectId: 'p1',
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: expectedHash,
      mime: 'image/png',
      updatedAt: 115,
    })
    await storage.put('runRecords', {
      id: 'run-corrupt-bytes',
      nodeId: 'n1',
      projectId: 'p1',
      version: 1,
      createdAt: 120,
      status: 'succeeded',
      inputs: [],
      params: {},
      outputHashes: [expectedHash],
      fingerprint: 'fp-corrupt',
      taskId: 'task-corrupt',
      durationMs: 10,
    })
    await storage.put('assetSaveQueue', {
      id: results[0]!.id,
      projectId: 'p1',
      resultId: results[0]!.id,
      taskId: results[0]!.taskId,
      planId: 'plan-corrupt-bytes',
      prompt: '待保存',
      model: 'image-model',
      assets: [
        {
          hash: expectedHash,
          mime: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
      createdAt: 120,
      updatedAt: 120,
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)
    expect(reconciled.results[0]).toMatchObject({
      status: 'failed',
      recovery: 'retry-save',
      id: results[0]?.id,
    })
    expect(reconciled.results[0]?.assetHash).toBeUndefined()
    expect(reconciled.results[0]?.errorText).toContain('素材字节不在库中')
  })

  it('远端视频只有合法 url 时仍算可用，不被误判成本地字节缺失', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-remote-video',
      request: { ...request, mediaKind: 'video', count: 1 },
      nodeIds: ['n1'],
      at: 100,
    })
    await storage.put('assets', {
      id: 'remote-video',
      hash: 'remote-video',
      mime: 'video/mp4',
      url: 'https://cdn.example.com/result.mp4',
      createdAt: 110,
      projectId: 'p1',
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: 'remote-video',
      mime: 'video/mp4',
      updatedAt: 115,
    })
    await storage.put('runRecords', {
      id: 'run-remote-video',
      nodeId: 'n1',
      projectId: 'p1',
      version: 1,
      createdAt: 120,
      status: 'succeeded',
      inputs: [],
      params: {},
      outputHashes: ['remote-video'],
      fingerprint: 'fp-remote',
      taskId: 'task-remote',
      durationMs: 10,
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)
    expect(reconciled.results[0]).toMatchObject({
      status: 'done',
      assetHash: 'remote-video',
      mime: 'video/mp4',
    })
    expect(reconciled.results[0]?.recovery).toBeUndefined()
    expect(reconciled.tasks[0]?.status).toBe('done')
  })

  it('图片只有远端 url、没有本地字节时不能判 done', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-remote-image',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    await storage.put('assets', {
      id: 'remote-image',
      hash: 'remote-image',
      mime: 'image/png',
      url: 'https://cdn.example.com/result.png',
      createdAt: 110,
      projectId: 'p1',
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: 'remote-image',
      mime: 'image/png',
      updatedAt: 115,
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)

    expect(reconciled.results[0]?.status).toBe('failed')
    expect(reconciled.results[0]?.assetHash).toBeUndefined()
  })

  it('历史 done 即使没有 RunRecord，也会校验 assetHash 而不是直接放行', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-done-without-run',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: 'missing-no-record',
      mime: 'image/png',
      updatedAt: 110,
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)

    expect(reconciled.results[0]).toMatchObject({
      status: 'failed',
      id: results[0]?.id,
    })
    expect(reconciled.results[0]?.assetHash).toBeUndefined()
    expect(reconciled.results[0]?.recovery).toBeUndefined()
  })

  it('同一仓储实例会重新读取字节，先前校验通过后损坏仍会降级', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-corrupt-after-check',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    const bytes = new Uint8Array([4, 5, 6])
    const hash = sha1Bytes(bytes).slice(0, 16)
    await storage.put('assets', {
      id: hash,
      hash,
      mime: 'image/png',
      bytes,
      createdAt: 110,
      projectId: 'p1',
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: hash,
      mime: 'image/png',
      updatedAt: 115,
    })
    await storage.put('runRecords', {
      id: 'run-corrupt-after-check',
      nodeId: 'n1',
      projectId: 'p1',
      version: 1,
      createdAt: 120,
      status: 'succeeded',
      inputs: [],
      params: {},
      outputHashes: [hash],
      fingerprint: 'fp-first',
      taskId: 'task-first',
      durationMs: 10,
    })

    expect((await repo.reconcileFromRunRecords('p1', 200)).results[0]?.status).toBe(
      'done',
    )

    await storage.put('assets', {
      id: hash,
      hash,
      mime: 'image/png',
      bytes: new Uint8Array([6, 5, 4]),
      createdAt: 210,
      projectId: 'p1',
    })

    const damaged = await repo.reconcileFromRunRecords('p1', 300)
    expect(damaged.results[0]).toMatchObject({
      status: 'failed',
      id: results[0]?.id,
    })
    expect(damaged.results[0]?.assetHash).toBeUndefined()
  })

  it('素材读取抛错时也不能继续把历史 done 当成可用', async () => {
    const storage = createMemoryStorage()
    const brokenAssets: AssetPort = {
      async read() {
        throw new Error('素材服务暂不可用')
      },
      async readUrl() {
        return null
      },
    }
    const repo = createEcommerceTaskRepository(storage, brokenAssets)
    const { results } = await repo.create({
      projectId: 'p1',
      batchId: 'batch-read-throws',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    await repo.updateResult({
      ...results[0]!,
      status: 'done',
      assetHash: 'read-throws',
      mime: 'image/png',
      updatedAt: 110,
    })

    const reconciled = await repo.reconcileFromRunRecords('p1', 200)

    expect(reconciled.results[0]?.status).toBe('failed')
    expect(reconciled.results[0]?.assetHash).toBeUndefined()
  })

  it('正常提交写入后仍会读回校验；字节被写坏不会直接置 done', async () => {
    const base = createMemoryStorage()
    const storage = {
      ...base,
      async put(table: Parameters<typeof base.put>[0], row: Parameters<typeof base.put>[1]) {
        if (table === 'assets') {
          await base.put('assets', {
            ...row,
            bytes: new Uint8Array([9, 9, 9]),
          } as never)
          return
        }
        await base.put(table, row)
      },
    }
    const repo = createEcommerceTaskRepository(storage)
    const created = await repo.create({
      projectId: 'p1',
      batchId: 'batch-commit-corrupt',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    const bytes = new Uint8Array([1, 2, 3])
    const hash = sha1Bytes(bytes).slice(0, 16)

    const outcome = await repo.commitAssets({
      resultId: created.results[0]!.id,
      planId: 'plan-commit-corrupt',
      prompt: '正常提交',
      model: 'image-model',
      assets: [{ hash, mime: 'image/png', bytes }],
      at: 110,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.result).toMatchObject({
      status: 'failed',
      recovery: 'retry-save',
    })
    expect(await repo.queuedSave(created.results[0]!.id)).not.toBeNull()
  })

  it('移除 retry-save 结果时同步删除内部恢复字节', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const created = await repo.create({
      projectId: 'p1',
      batchId: 'batch-remove-recovery',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    await repo.markRetrySave({
      resultId: created.results[0]!.id,
      planId: 'plan-1',
      prompt: '待保存',
      model: 'image-model',
      assets: [
        {
          hash: 'queued',
          mime: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
      errorText: '保存失败',
      at: 110,
    })
    expect(await repo.queuedSave(created.results[0]!.id)).not.toBeNull()

    await repo.removeResult(created.results[0]!.id, 120)

    expect(await repo.result(created.results[0]!.id)).toBeNull()
    expect(await repo.queuedSave(created.results[0]!.id)).toBeNull()
  })

  it('重试保存期间结果已进入新一轮时，旧句柄不能覆盖新状态', async () => {
    const storage = createMemoryStorage()
    const created = await createEcommerceTaskRepository(storage).create({
      projectId: 'p1',
      batchId: 'batch-retry-race',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    const bytes = new Uint8Array([7, 8, 9])
    const hash = sha1Bytes(bytes).slice(0, 16)
    let raced = false
    const racingAssets: AssetPort = {
      async read() {
        if (!raced) {
          raced = true
          const [row] = await storage.query('ecommerceResults', {
            id: created.results[0]!.id,
          })
          await storage.put('ecommerceResults', {
            ...(row as Record<string, unknown>),
            id: created.results[0]!.id,
            status: 'running',
            updatedAt: 999,
          })
        }
        return { bytes, mime: 'image/png' }
      },
      async readUrl() {
        return null
      },
    }
    const repo = createEcommerceTaskRepository(storage, racingAssets)
    await repo.markRetrySave({
      resultId: created.results[0]!.id,
      planId: 'plan-retry-race',
      prompt: '旧结果',
      model: 'image-model',
      assets: [{ hash, mime: 'image/png', bytes }],
      errorText: '等待保存',
      at: 110,
    })

    const outcome = await repo.retrySave(created.results[0]!.id, 200)

    expect(outcome.ok).toBe(false)
    expect(outcome.errorText).toContain('状态已变化')
    expect(await repo.result(created.results[0]!.id)).toMatchObject({
      status: 'running',
      updatedAt: 999,
    })
    expect(await repo.queuedSave(created.results[0]!.id)).not.toBeNull()
  })

  it('删除整批任务时同步清掉该批全部恢复句柄', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const created = await repo.create({
      projectId: 'p1',
      batchId: 'batch-remove-task-recovery',
      request,
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    for (const [index, result] of created.results.entries()) {
      await repo.markRetrySave({
        resultId: result.id,
        planId: `plan-${index}`,
        prompt: '待保存',
        model: 'image-model',
        assets: [
          {
            hash: `queued-${index}`,
            mime: 'image/png',
            bytes: new Uint8Array([index + 1]),
          },
        ],
        errorText: '保存失败',
        at: 110 + index,
      })
    }
    expect(await storage.query('assetSaveQueue', { taskId: created.task.id })).toHaveLength(2)

    await repo.remove(created.task.id)

    expect(await storage.query('assetSaveQueue', { taskId: created.task.id })).toHaveLength(0)
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
