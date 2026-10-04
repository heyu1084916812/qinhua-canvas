import { describe, it, expect } from 'vitest'
import { asAppError, describeError } from './result'
import type { AppError } from './result'

class FakeChannelError extends Error {
  readonly appError: { kind: 'channel'; detail: 'unsupported' }
  constructor() {
    super('[channel] unsupported')
    this.name = 'FakeChannelError'
    this.appError = { kind: 'channel', detail: 'unsupported' }
  }
}

describe('asAppError', () => {
  it('裸 AppError 字面量（平台层的抛法）原样取出', () => {
    expect(asAppError({ kind: 'network', detail: 'dns' })).toEqual({ kind: 'network', detail: 'dns' })
    expect(asAppError({ kind: 'http', status: 500 })).toEqual({ kind: 'http', status: 500 })
  })

  it('带货的 Error（ChannelError）取出 appError 载荷', () => {
    expect(asAppError(new FakeChannelError())).toEqual({ kind: 'channel', detail: 'unsupported' })
  })

  it('普通 Error / 非对象 → null（交给调用方按 message 兜底）', () => {
    expect(asAppError(new Error('boom'))).toBeNull()
    expect(asAppError('boom')).toBeNull()
    expect(asAppError(null)).toBeNull()
    expect(asAppError(undefined)).toBeNull()
    // 有 appError 字段但不是 AppError 的畸形对象也不认
    expect(asAppError({ appError: { nope: 1 } })).toBeNull()
  })

  it('describeError 覆盖全部 kind（不落空串）', () => {
    const all = [
      { kind: 'network', detail: 'dns' },
      { kind: 'http', status: 500 },
      { kind: 'parse', raw: 'x' },
      { kind: 'storage', detail: 'quota' },
      { kind: 'validation', field: 'name', reason: '空' },
      { kind: 'channel', detail: 'missingKey' },
    ] as const
    for (const e of all) expect(describeError(e).length).toBeGreaterThan(0)
  })

  /**
   * ★★ **报错文案不许露代码**（用户 2026-10-05 第 3 批：
   * 「他显示报错的时候能否把中文发我，而不是代码」）。
   *
   * 判据分两条：① 每种 kind × 每个 detail 的译文都要带中文；
   * ② 译文里**不出现枚举标识符本身**（`cors` / `missingKey` / `quota` …）——
   * 以前正是 `网络错误：cors`、`渠道错误：missingKey` 这种形态。
   */
  it('★★ 报错文案全中文：每个取值都有人话，且不出现英文枚举标识符', () => {
    const all: AppError[] = [
      { kind: 'network', detail: 'dns' },
      { kind: 'network', detail: 'tls' },
      { kind: 'network', detail: 'cors' },
      { kind: 'network', detail: 'timeout' },
      { kind: 'network', detail: 'aborted' },
      { kind: 'http', status: 402, body: '{"error":{"message":"预扣费不足"}}' },
      { kind: 'http', status: 500 },
      { kind: 'parse', raw: '<html>' },
      { kind: 'storage', detail: 'quota' },
      { kind: 'storage', detail: 'corrupt' },
      { kind: 'storage', detail: 'permission' },
      { kind: 'validation', field: 'name', reason: '不能为空' },
      { kind: 'channel', detail: 'missingKey' },
      { kind: 'channel', detail: 'missingModel' },
      { kind: 'channel', detail: 'unsupported' },
    ]
    const banned = [
      'dns',
      'tls',
      'cors',
      'timeout',
      'aborted',
      'quota',
      'corrupt',
      'missingKey',
      'missingModel',
      'unsupported',
      '[object Object]',
      'undefined',
    ]
    for (const e of all) {
      const text = describeError(e)
      expect(text.length).toBeGreaterThan(0)
      /** 必须有人话（汉字），不能是「HTTP 500」这种纯代码 */
      expect(/[\u4e00-\u9fa5]/.test(text)).toBe(true)
      for (const b of banned) expect(text).not.toContain(b)
    }
  })

  it('★ HTTP 错误优先带服务端原话；没给原因时也只说人话', () => {
    expect(
      describeError({ kind: 'http', status: 402, body: '{"error":{"message":"预扣费不足"}}' }),
    ).toContain('预扣费不足')
    const noReason = describeError({ kind: 'http', status: 503 })
    expect(noReason).toContain('服务端')
    expect(noReason).not.toBe('HTTP 503')
  })
})
