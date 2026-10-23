import { describe, expect, it } from 'vitest'
import {
  freshestResultsById,
  resultDisplayStatus,
  statusOfResult,
  statusOfTask,
  taskStatusOf,
  taskSummaryOf,
} from './tasks'
import type { EcommerceResultRecord } from './tasks'

describe('电商任务 / 结果状态纯函数', () => {
  it('全部完成 = done', () => {
    expect(taskStatusOf([{ status: 'done' }, { status: 'done' }])).toBe('done')
  })

  it('只要还有 pending / running，整批就是 running', () => {
    expect(taskStatusOf([{ status: 'done' }, { status: 'running' }])).toBe('running')
    expect(taskStatusOf([{ status: 'failed' }, { status: 'pending' }])).toBe('running')
  })

  it('部分完成 / 全失败 / 全取消三种收口分清', () => {
    expect(taskStatusOf([{ status: 'done' }, { status: 'failed' }])).toBe('partial')
    expect(taskStatusOf([{ status: 'failed' }, { status: 'failed' }])).toBe('failed')
    expect(taskStatusOf([{ status: 'canceled' }, { status: 'canceled' }])).toBe('canceled')
  })

  it('空结果集按失败处理；脏状态不会漏成未定义', () => {
    expect(taskStatusOf([])).toBe('failed')
    expect(statusOfTask('nonsense')).toBe('failed')
    expect(statusOfResult('nonsense')).toBe('failed')
    expect(statusOfTask('partial')).toBe('partial')
    expect(statusOfResult('canceled')).toBe('canceled')
  })

  it('实时运行态优先于旧产物 hash：重跑已有结果仍显示生成中，没有等待态', () => {
    expect(
      resultDisplayStatus({ stored: 'done', live: 'running', hasAsset: true }),
    ).toBe('running')
    expect(
      resultDisplayStatus({ stored: 'failed', live: 'queued', hasAsset: true }),
    ).toBe('running')
    expect(
      resultDisplayStatus({ stored: 'done', live: 'failed', hasAsset: true }),
    ).toBe('failed')
  })

  it('没有实时状态时按结果行与产物如实收口', () => {
    expect(resultDisplayStatus({ stored: 'done', hasAsset: true })).toBe('done')
    expect(resultDisplayStatus({ stored: 'running', hasAsset: true })).toBe('running')
    expect(resultDisplayStatus({ stored: 'canceled', hasAsset: false })).toBe('failed')
    expect(resultDisplayStatus({ stored: 'pending', hasAsset: false })).toBe('running')
  })

  it('数据库结果与内存结果按 updatedAt 取新，旧 running 不能覆盖已完成', () => {
    const resultOf = (
      id: string,
      status: EcommerceResultRecord['status'],
      updatedAt: number,
    ): EcommerceResultRecord => ({
      id,
      taskId: 't1',
      projectId: 'p1',
      nodeId: 'n1',
      position: 0,
      createdAt: 1,
      updatedAt,
      status,
    })
    const stored = resultOf('r1', 'done', 30)
    const staleLive = resultOf('r1', 'running', 20)
    expect(freshestResultsById([stored], [staleLive]).get('r1')?.status).toBe('done')
    expect(freshestResultsById([stored], [resultOf('r1', 'running', 40)]).get('r1')?.status)
      .toBe('running')
    expect(freshestResultsById([stored], [resultOf('r1', 'running', 30)]).get('r1')?.status)
      .toBe('done')
  })

  it('★ 历史批次摘要：时间 / 用途 / 平台 / 张数 / 状态', () => {
    const at = new Date(2026, 9, 15, 8, 5).getTime()
    expect(
      taskSummaryOf({
        createdAt: at,
        status: 'partial',
        request: {
          usage: 'detail',
          platformId: 'amazon',
          language: 'en',
          count: 4,
          ratio: '3:4',
          productNodeId: 'n1',
          referenceNodeIds: [],
        },
      }),
    ).toBe('2026-10-15 08:05 · 详情页 · 亚马逊 · 4 张 · 部分完成')
    expect(
      taskSummaryOf({
        createdAt: at,
        status: 'done',
        request: {
          usage: 'white-bg',
          language: 'zh-CN',
          count: 1,
          ratio: '1:1',
          productNodeId: 'n1',
          referenceNodeIds: [],
        },
      }),
    ).toContain('· 通用 · 1 张 · 已完成')
    expect(
      taskSummaryOf({
        createdAt: at,
        status: 'done',
        request: {
          mediaKind: 'video',
          modeLabel: '带货视频',
          usage: 'set',
          language: 'en',
          count: 1,
          ratio: '9:16',
          productNodeId: 'n1',
          referenceNodeIds: [],
        },
      }),
    ).toContain('· 带货视频 · 通用 · 1 条 · 已完成')
  })
})
