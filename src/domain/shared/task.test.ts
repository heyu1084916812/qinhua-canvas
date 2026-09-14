import { describe, it, expect } from 'vitest'
import { backoffMs, isRetryableStatus, trimLog, isInterruptible, isTerminal } from './task'

describe('重试与退避', () => {
  it('退避按 2 的幂增长并叠加抖动', () => {
    expect(backoffMs(0, 1000, 0)).toBe(1000)
    expect(backoffMs(1, 1000, 0)).toBe(2000)
    expect(backoffMs(2, 1000, 0)).toBe(4000)
    expect(backoffMs(1, 1000, 0.5)).toBe(3000)
  })

  it('尝试次数封顶，避免无限增长', () => {
    expect(backoffMs(9, 1000, 0)).toBe(backoffMs(4, 1000, 0))
  })

  it('只有 408 / 429 / 5xx 可重试', () => {
    expect(isRetryableStatus(408)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
  })
})

describe('日志裁剪', () => {
  it('超出上限保留最近的部分', () => {
    expect(trimLog([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
  })

  it('未超出上限原样返回副本', () => {
    const input = [1, 2]
    const out = trimLog(input, 5)
    expect(out).toEqual([1, 2])
    expect(out).not.toBe(input)
  })
})

describe('中断恢复', () => {
  it('validating / queued / running / retrying 需要被接管', () => {
    expect(isInterruptible('queued')).toBe(true)
    expect(isInterruptible('running')).toBe(true)
    expect(isInterruptible('succeeded')).toBe(false)
  })

  it('终态判定', () => {
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('canceled')).toBe(true)
    expect(isTerminal('running')).toBe(false)
  })
})
