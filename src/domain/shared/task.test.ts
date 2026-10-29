import { describe, it, expect } from 'vitest'
import {
  backoffMs,
  isRequestResendSafe,
  isRetryableStatus,
  isRouteFallbackSafe,
  trimLog,
  isInterruptible,
  isTerminal,
} from './task'

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

  it('仅 429 / 5xx 可重试；408 不自动重发', () => {
    expect(isRetryableStatus(408)).toBe(false)
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
  })

  it('only explicitly not-sent network errors are safe to resubmit', () => {
    expect(
      isRequestResendSafe({ kind: 'network', detail: 'cors', sendPhase: 'not-sent' }),
    ).toBe(true)
    expect(
      isRequestResendSafe({ kind: 'network', detail: 'cors', sendPhase: 'unknown' }),
    ).toBe(false)
    expect(isRequestResendSafe({ kind: 'network', detail: 'dns' })).toBe(false)
    expect(isRequestResendSafe({ kind: 'http', status: 408 })).toBe(false)
  })
})

describe('路由候选降级', () => {
  it('HTTP 401 归一成 missingKey 后仍可安全换下一个候选', () => {
    expect(isRouteFallbackSafe({ kind: 'channel', detail: 'missingKey' })).toBe(true)
    expect(isRouteFallbackSafe({ kind: 'http', status: 401 })).toBe(true)
    expect(isRouteFallbackSafe({ kind: 'http', status: 403 })).toBe(true)
    expect(isRouteFallbackSafe({ kind: 'http', status: 429 })).toBe(true)
  })

  it('超时、408、响应丢失和内容错误不换候选', () => {
    expect(
      isRouteFallbackSafe({ kind: 'network', detail: 'timeout', sendPhase: 'unknown' }),
    ).toBe(false)
    expect(isRouteFallbackSafe({ kind: 'http', status: 408 })).toBe(false)
    expect(isRouteFallbackSafe({ kind: 'channel', detail: 'unsupported' })).toBe(false)
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
