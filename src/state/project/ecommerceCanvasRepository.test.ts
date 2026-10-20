import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { createEcommerceCanvasRepository } from './ecommerceCanvasRepository'
import { createEcommerceTaskRepository } from './ecommerceTaskRepository'

function seed() {
  return createMemoryStorage({
    rows: {
      ecommerceTasks: [
        {
          id: 't1',
          projectId: 'p1',
          createdAt: 1,
          request: { count: 1 },
          nodeIds: ['n1', 'n2'],
        },
      ],
      ecommerceResults: [
        {
          id: 'r1',
          taskId: 't1',
          projectId: 'p1',
          nodeId: 'n1',
          position: 0,
          createdAt: 1,
          status: 'done',
          assetHash: 'a1',
          mime: 'image/png',
          width: 1600,
          height: 900,
        },
        {
          id: 'r2',
          taskId: 't1',
          projectId: 'p1',
          nodeId: 'n2',
          position: 1,
          createdAt: 2,
          status: 'done',
          assetHash: 'a2',
          mime: 'image/png',
          width: 1000,
          height: 1000,
        },
        {
          id: 'failed',
          taskId: 't1',
          projectId: 'p1',
          nodeId: 'n3',
          position: 2,
          createdAt: 3,
          status: 'failed',
        },
      ],
    },
  })
}

describe('ecommerceCanvasRepository', () => {
  it('从结果回填布局，成功、失败和运行中都会占住最终位置', async () => {
    const storage = seed()
    const repo = createEcommerceCanvasRepository(storage)
    const items = await repo.sync('p1', 1280)
    expect(items.map((item) => item.resultId)).toEqual(['r1', 'r2', 'failed'])
    expect(items[0]!.x).toBe(96)
    expect(items[0]!.width).toBe(922)
    expect(items[1]!.y).toBe(
      items[0]!.y +
        items[0]!.height +
        24,
    )
  })

  it('再次 sync 不覆盖用户调整过的坐标', async () => {
    const storage = seed()
    const repo = createEcommerceCanvasRepository(storage)
    const [first] = await repo.sync('p1', 1280)
    await repo.save({ ...first!, x: 777, y: 333, rotation: 15 })
    const next = await repo.sync('p1', 1280)
    expect(next.find((item) => item.resultId === 'r1')).toMatchObject({
      x: 777,
      y: 333,
      rotation: 15,
    })
  })

  it('失败结果删除后对应布局可同步清理', async () => {
    const storage = seed()
    const repo = createEcommerceCanvasRepository(storage)
    await repo.sync('p1', 1280)
    await storage.delete('ecommerceResults', 'failed')
    const next = await repo.sync('p1', 1280)
    expect(next.map((item) => item.resultId)).toEqual(['r1', 'r2'])
    await repo.removeByResultIds('p1', ['r1', 'r2'])
    expect(await repo.list('p1')).toHaveLength(0)
  })

  it('用户移动并放大第一批后，新批次从真实底部继续，不覆盖已有对象', async () => {
    const storage = seed()
    const repo = createEcommerceCanvasRepository(storage)
    const first = await repo.sync('p1', 1280)
    const moved = first.map((item, index) =>
      index === 0 ? { ...item, x: 240, y: 900, width: 1200, height: 1000 } : item,
    )
    await repo.replace('p1', moved)
    await storage.put('ecommerceTasks', {
      id: 't2',
      projectId: 'p1',
      batchId: 'b2',
      createdAt: 10,
      updatedAt: 10,
      status: 'done',
      request: { count: 1 },
      nodeIds: ['n4'],
    } as never)
    await storage.put('ecommerceResults', {
      id: 'r4',
      taskId: 't2',
      projectId: 'p1',
      nodeId: 'n4',
      position: 0,
      createdAt: 10,
      updatedAt: 10,
      status: 'done',
      assetHash: 'a4',
      mime: 'image/png',
      width: 1000,
      height: 1000,
    } as never)
    const next = await repo.sync('p1', 1280)
    const added = next.find((item) => item.resultId === 'r4')!
    const firstBottom = Math.max(
      ...next
        .filter((item) => item.resultId !== 'r4')
        .map((item) => item.y + item.height),
    )
    expect(added.y).toBeGreaterThanOrEqual(firstBottom + 96)
  })
})

describe('ecommerceTaskRepository · RunRecord reconciliation', () => {
  it('API 已失败但结果行仍是 running 时，用 RunRecord 收口真实错误并更新任务', async () => {
    const storage = createMemoryStorage({
      rows: {
        ecommerceTasks: [
          {
            id: 't-real',
            projectId: 'p1',
            batchId: 'b-real',
            createdAt: 1,
            updatedAt: 1,
            status: 'running',
            request: { count: 1 },
            nodeIds: ['n-real'],
          },
        ],
        ecommerceResults: [
          {
            id: 'r-real',
            taskId: 't-real',
            projectId: 'p1',
            nodeId: 'n-real',
            position: 0,
            createdAt: 1,
            updatedAt: 1,
            status: 'running',
          },
        ],
        runRecords: [
          {
            id: 'run-real',
            projectId: 'p1',
            nodeId: 'n-real',
            version: 1,
            createdAt: 2,
            status: 'failed',
            inputs: [],
            params: { model: 'gemini-3.1-flash-image' },
            outputHashes: [],
            fingerprint: 'fp',
            taskId: 'engine-task',
            durationMs: 1200,
            errorText: 'HTTP 503：当前分组没有可用渠道',
            sentChannelId: 'comfly',
            sentModel: 'gemini-3.1-flash-image-512px',
          },
        ],
      },
    })
    const repo = createEcommerceTaskRepository(storage)
    const result = await repo.reconcileFromRunRecords('p1', 3)
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      errorText: 'HTTP 503：当前分组没有可用渠道',
    })
    expect(result.tasks[0]).toMatchObject({
      status: 'failed',
      errorText: 'HTTP 503：当前分组没有可用渠道',
    })
    expect(await repo.listResults('p1')).toMatchObject([
      { id: 'r-real', status: 'failed', errorText: 'HTTP 503：当前分组没有可用渠道' },
    ])
  })

  it('结果行残留 running、但最近 RunRecord 已失败时，移除记录必须真正删掉', async () => {
    const storage = createMemoryStorage({
      rows: {
        ecommerceTasks: [
          {
            id: 't-remove',
            projectId: 'p1',
            batchId: 'b-remove',
            createdAt: 1,
            updatedAt: 1,
            status: 'running',
            request: { count: 1 },
            nodeIds: ['n-remove'],
          },
        ],
        ecommerceResults: [
          {
            id: 'r-remove',
            taskId: 't-remove',
            projectId: 'p1',
            nodeId: 'n-remove',
            position: 0,
            createdAt: 1,
            updatedAt: 1,
            status: 'running',
          },
        ],
        runRecords: [
          {
            id: 'run-remove',
            projectId: 'p1',
            nodeId: 'n-remove',
            createdAt: 2,
            status: 'failed',
            errorText: '真实失败',
          },
        ],
      },
    })
    const repo = createEcommerceTaskRepository(storage)
    await expect(repo.removeResult('r-remove')).resolves.not.toBeNull()
    expect(await repo.listResults('p1')).toEqual([])
  })
})
