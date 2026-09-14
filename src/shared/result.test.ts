import { describe, it, expect } from 'vitest'
import { asAppError, describeError } from './result'

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
})
