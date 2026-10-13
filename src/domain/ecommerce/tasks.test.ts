import { describe, expect, it } from 'vitest'
import { statusOfResult, statusOfTask, taskStatusOf } from './tasks'

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
})
