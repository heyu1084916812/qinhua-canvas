import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory'
import type { StoragePort } from '../../../platform/ports'
import { createEcommerceCanvasRepository } from '../../../state/project/ecommerceCanvasRepository'
import { createEcommerceTaskRepository } from '../../../state/project/ecommerceTaskRepository'
import { executeEcommerceCommands } from './ecommerceCommandExecutor'

async function fixture() {
  const platform = createMemoryPlatform()
  const taskRepo = createEcommerceTaskRepository(platform.storage)
  const canvasRepo = createEcommerceCanvasRepository(platform.storage)
  const created = await taskRepo.create({
    projectId: 'p1',
    batchId: 'batch1',
    request: {
      usage: 'main',
      language: 'zh-CN',
      count: 1,
      ratio: '1:1',
      productNodeId: 'input1',
      referenceNodeIds: [],
    },
    nodeIds: ['ecr_subject_1'],
  })
  return { platform, taskRepo, canvasRepo, created }
}

describe('executeEcommerceCommands', () => {
  it('成功先生成素材和结果行，再写 RunRecord，最后同步投影', async () => {
    const { platform, taskRepo, canvasRepo, created } = await fixture()
    const record = {
      id: 'rec1',
      nodeId: created.results[0]!.nodeId,
      projectId: 'p1',
      version: 1,
      createdAt: 1,
      status: 'succeeded' as const,
      inputs: [],
      params: {},
      outputHashes: ['asset1'],
      fingerprint: 'fp',
      taskId: 'task1',
      durationMs: 10,
      outputWidth: 64,
      outputHeight: 64,
    }
    const warnings = await executeEcommerceCommands(
      [
        {
          kind: 'result.commit',
          planId: 'ecommerce:ect_1:run',
          resultId: created.results[0]!.id,
          prompt: '主图提示词',
          model: 'image-model',
          assets: [
            {
              hash: 'asset1',
              mime: 'image/png',
              bytes: new Uint8Array([1, 2, 3]),
              width: 64,
              height: 64,
            },
          ],
        },
        {
          kind: 'runRecord.finalize',
          planId: 'ecommerce:ect_1:run',
          record,
          resultId: created.results[0]!.id,
        },
        {
          kind: 'projection.sync',
          planId: 'ecommerce:ect_1:run',
          projectId: 'p1',
          taskId: created.task.id,
        },
      ],
      {
        storage: platform.storage,
        taskRepo,
        canvasRepo,
        now: () => 10,
      },
    )

    expect(warnings).toEqual([])
    expect(await taskRepo.result(created.results[0]!.id)).toMatchObject({
      status: 'done',
      assetHash: 'asset1',
      mime: 'image/png',
      prompt: '主图提示词',
      model: 'image-model',
      width: 64,
      height: 64,
    })
    expect(await platform.storage.query('runRecords', { projectId: 'p1' })).toHaveLength(1)
    expect(await canvasRepo.list('p1')).toHaveLength(1)
    expect((await taskRepo.list('p1'))[0]?.status).toBe('done')
  })

  it('失败保留真实原因，并继续同步投影', async () => {
    const { platform, taskRepo, canvasRepo, created } = await fixture()
    const warnings = await executeEcommerceCommands(
      [
        {
          kind: 'runRecord.finalize',
          planId: 'ecommerce:ect_1:run',
          record: {
            id: 'rec2',
            nodeId: created.results[0]!.nodeId,
            projectId: 'p1',
            version: 1,
            createdAt: 1,
            status: 'failed',
            inputs: [],
            params: {},
            outputHashes: [],
            fingerprint: 'fp',
            taskId: 'task1',
            durationMs: 10,
            errorText: '上游返回原文',
          },
          resultId: created.results[0]!.id,
          status: 'failed',
          errorText: '上游返回原文',
        },
        {
          kind: 'projection.sync',
          planId: 'ecommerce:ect_1:run',
          projectId: 'p1',
          taskId: created.task.id,
        },
      ],
      { storage: platform.storage, taskRepo, canvasRepo },
    )

    expect(warnings).toEqual([])
    expect(await taskRepo.result(created.results[0]!.id)).toMatchObject({
      status: 'failed',
      errorText: '上游返回原文',
    })
    expect((await taskRepo.list('p1'))[0]?.status).toBe('failed')
  })

  it('单条投影失败只返回警告，不回滚结果与 RunRecord', async () => {
    const { platform, taskRepo, created } = await fixture()
    const brokenCanvasRepo = {
      ...createEcommerceCanvasRepository(platform.storage),
      sync: async () => {
        throw new Error('投影失败')
      },
    }
    const warnings = await executeEcommerceCommands(
      [
        {
          kind: 'result.commit',
          planId: 'ecommerce:ect_1:run',
          resultId: created.results[0]!.id,
          prompt: '投影失败测试',
          model: 'image-model',
          assets: [
            {
              hash: 'asset2',
              mime: 'image/png',
              bytes: new Uint8Array([4]),
            },
          ],
        },
        {
          kind: 'projection.sync',
          planId: 'ecommerce:ect_1:run',
          projectId: 'p1',
          taskId: created.task.id,
        },
      ],
      {
        storage: platform.storage,
        taskRepo,
        canvasRepo: brokenCanvasRepo,
      },
    )

    expect(warnings[0]).toContain('投影失败')
    expect(await taskRepo.result(created.results[0]!.id)).toMatchObject({
      status: 'done',
      assetHash: 'asset2',
    })
  })

  it('素材写入失败时保持可恢复失败态，成功 RunRecord 不能把结果补成 done', async () => {
    const { platform, taskRepo, canvasRepo, created } = await fixture()
    await taskRepo.updateResult({
      ...created.results[0]!,
      status: 'done',
      assetHash: 'old-asset',
      mime: 'image/jpeg',
      width: 32,
      height: 32,
      updatedAt: 0,
    })
    const baseStorage = platform.storage
    const storage: StoragePort = {
      ...baseStorage,
      async put(table, row) {
        if (table === 'assets') throw new Error('磁盘空间不足')
        await baseStorage.put(table, row)
      },
    }
    const warnings = await executeEcommerceCommands(
      [
        {
          kind: 'result.status',
          planId: 'ecommerce:ect_1:run',
          resultId: created.results[0]!.id,
          status: 'running',
        },
        {
          kind: 'result.commit',
          planId: 'ecommerce:ect_1:run',
          resultId: created.results[0]!.id,
          prompt: '素材保存失败测试',
          model: 'image-model',
          assets: [
            {
              hash: 'asset-storage-failed',
              mime: 'image/png',
              bytes: new Uint8Array([1, 2, 3]),
            },
          ],
        },
        {
          kind: 'runRecord.finalize',
          planId: 'ecommerce:ect_1:run',
          record: {
            id: 'rec-storage-failed',
            nodeId: created.results[0]!.nodeId,
            projectId: 'p1',
            version: 1,
            createdAt: 1,
            status: 'succeeded',
            inputs: [],
            params: {},
            outputHashes: ['asset-storage-failed'],
            fingerprint: 'fp',
            taskId: 'task1',
            durationMs: 10,
            outputWidth: 64,
            outputHeight: 64,
          },
          resultId: created.results[0]!.id,
        },
        {
          kind: 'projection.sync',
          planId: 'ecommerce:ect_1:run',
          projectId: 'p1',
          taskId: created.task.id,
        },
      ],
      {
        storage,
        taskRepo,
        canvasRepo,
        now: () => 10,
      },
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('素材保存失败')
    expect(await taskRepo.result(created.results[0]!.id)).toMatchObject({
      status: 'failed',
      recovery: 'retry-save',
      errorText: expect.stringContaining('不要重新生成'),
    })
    const failedResult = await taskRepo.result(created.results[0]!.id)
    expect(failedResult?.assetHash).toBeUndefined()
    expect(failedResult?.mime).toBeUndefined()
    expect(failedResult?.width).toBeUndefined()
    expect(failedResult?.height).toBeUndefined()
    expect(await platform.storage.query('runRecords', { projectId: 'p1' })).toHaveLength(1)
    expect((await taskRepo.list('p1'))[0]?.status).toBe('failed')
  })
})
