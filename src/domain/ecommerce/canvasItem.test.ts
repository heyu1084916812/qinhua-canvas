import { describe, expect, it } from 'vitest'
import {
  defaultWorkbenchWidth,
  findFreeWorkbenchPosition,
  layoutEcommerceResults,
  mergeWorkbenchItems,
  resultAspectOf,
  snapWorkbenchMove,
  type EcommerceCanvasItem,
} from './canvasItem'
import type { EcommerceResultRecord, EcommerceTaskRecord } from './tasks'

const task = (id: string, createdAt: number): EcommerceTaskRecord => ({
  id,
  projectId: 'p1',
  batchId: id,
  createdAt,
  updatedAt: createdAt,
  status: 'done',
  request: {
    usage: 'set',
    language: 'zh-CN',
    ratio: '1:1',
    count: 1,
    productNodeId: '',
    productNodeIds: [],
    referenceNodeIds: [],
  },
  nodeIds: [],
})

const result = (
  id: string,
  taskId: string,
  position: number,
  over: Partial<EcommerceResultRecord> = {},
): EcommerceResultRecord => ({
  id,
  taskId,
  projectId: 'p1',
  nodeId: `n-${id}`,
  position,
  createdAt: position,
  updatedAt: position,
  status: 'done',
  assetHash: id,
  mime: 'image/png',
  width: 1600,
  height: 900,
  ...over,
})

describe('ecommerce canvas item layout', () => {
  it('按任务与 position 纵向排列，任务之间多留一段间距', () => {
    const items = layoutEcommerceResults(
      'p1',
      [task('t2', 2), task('t1', 1)],
      [result('r2', 't2', 0), result('r1', 't1', 0)],
      1280,
    )
    expect(items.map((item) => item.resultId)).toEqual(['r1', 'r2'])
    expect(items[1]!.y - (items[0]!.y + items[0]!.height)).toBe(96)
  })

  it('保持真实宽高比，视频也进入同一工作台', () => {
    const [image, video] = layoutEcommerceResults(
      'p1',
      [task('t1', 1)],
      [
        result('r1', 't1', 0),
        result('r2', 't1', 1, { mime: 'video/mp4', width: 720, height: 1280 }),
      ],
      1280,
    )
    expect(resultAspectOf(result('r1', 't1', 0))).toBeCloseTo(16 / 9)
    expect(image!.height).toBe(Math.round(image!.width / (16 / 9)))
    expect(video!.kind).toBe('video')
    expect(video!.height).toBe(Math.round(video!.width / (720 / 1280)))
  })

  it('已有对象坐标保留，只生成新增对象并移除消失结果', () => {
    const existing: EcommerceCanvasItem[] = [
      {
        id: 'old-r1',
        projectId: 'p1',
        kind: 'image',
        taskId: 't1',
        resultId: 'r1',
        assetHash: 'r1',
        x: 999,
        y: 777,
        width: 500,
        height: 300,
        rotation: 12,
        zIndex: 4,
        aspectLocked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'old-r9',
        projectId: 'p1',
        kind: 'image',
        resultId: 'r9',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        zIndex: 1,
        aspectLocked: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const desired = layoutEcommerceResults(
      'p1',
      [task('t1', 1)],
      [result('r1', 't1', 0), result('r2', 't1', 1)],
      1280,
    )
    const merged = mergeWorkbenchItems(existing, desired)
    expect(merged.items.find((item) => item.id === 'old-r1')).toMatchObject({
      x: 999,
      y: 777,
      rotation: 12,
    })
    expect(merged.added.map((item) => item.resultId)).toEqual(['r2'])
    expect(merged.removedIds).toEqual(['old-r9'])
  })

  it('运行中与失败结果也有最终落位，运行框不再依赖左侧托盘', () => {
    const items = layoutEcommerceResults(
      'p1',
      [task('t1', 1)],
      [
        result('running', 't1', 0, {
          status: 'running',
          assetHash: undefined,
          mime: undefined,
          width: undefined,
          height: undefined,
        }),
        result('failed', 't1', 1, {
          status: 'failed',
          assetHash: undefined,
          mime: undefined,
          width: undefined,
          height: undefined,
          errorText: '上游失败',
        }),
      ],
      1280,
    )
    expect(items.map((item) => item.resultId)).toEqual(['running', 'failed'])
    expect(items[0]!.height).toBe(items[0]!.width)
    expect(items[1]!.y - (items[0]!.y + items[0]!.height)).toBe(24)
  })

  it('取消结果仍保留可移除的位置，视频任务按 task.mediaKind 建视频容器', () => {
    const videoTask = task('video-task', 1)
    videoTask.request = {
      ...videoTask.request,
      mediaKind: 'video',
      ratio: '9:16',
      count: 1,
    }
    const [item] = layoutEcommerceResults(
      'p1',
      [videoTask],
      [
        result('canceled', 'video-task', 0, {
          status: 'canceled',
          assetHash: undefined,
          mime: undefined,
          width: undefined,
          height: undefined,
        }),
      ],
      1280,
    )
    expect(item).toMatchObject({ resultId: 'canceled', kind: 'video', aspectLocked: false })
    expect(item!.height).toBe(Math.round(item!.width / (9 / 16)))
  })

  it('默认宽度受视口约束', () => {
    expect(defaultWorkbenchWidth(1280)).toBe(922)
    expect(defaultWorkbenchWidth(400)).toBe(288)
    expect(defaultWorkbenchWidth(1920)).toBe(960)
  })

  it('图片边缘靠近另一张图的边缘时吸附并返回参考线', () => {
    const moving: EcommerceCanvasItem = {
      id: 'moving',
      projectId: 'p1',
      kind: 'image',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      rotation: 0,
      zIndex: 2,
      aspectLocked: true,
      createdAt: 1,
      updatedAt: 1,
    }
    const other = { ...moving, id: 'other', x: 500, y: 203, width: 320, height: 180 }
    const snapped = snapWorkbenchMove(moving, 203, 2, [other], 1)
    expect(snapped.x).toBe(200)
    expect(snapped.y).toBe(3)
    expect(snapped.guides.x).toBe(500)
    expect(snapped.guides.y).toBe(203)
  })

  it('重复添加对象时自动避开已有对象', () => {
    const occupied: EcommerceCanvasItem[] = [{
      id: 'a',
      projectId: 'p1',
      kind: 'text',
      x: 100,
      y: 100,
      width: 280,
      height: 84,
      rotation: 0,
      zIndex: 1,
      aspectLocked: false,
      createdAt: 1,
      updatedAt: 1,
    }]
    const free = findFreeWorkbenchPosition(occupied, 280, 84, { x: 100, y: 100 })
    expect(free.x).toBeGreaterThan(100)
    expect(free.y).toBeGreaterThan(100)
  })
})
