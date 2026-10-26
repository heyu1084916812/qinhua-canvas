import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory'
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
})
