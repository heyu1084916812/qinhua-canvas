import { describe, it, expect } from 'vitest'
import { asAppError, describeError, errorTextOf } from './result'
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
      { kind: 'cli', detail: 'failed' },
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
      { kind: 'cli', detail: 'notfound' },
      { kind: 'cli', detail: 'failed', message: 'not logged in' },
      { kind: 'cli', detail: 'timeout' },
      { kind: 'cli', detail: 'canceled' },
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
      'notfound',
      'canceled',
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

  it('★★ verbatim HTTP error returns the raw server body', () => {
    const raw = '{"data":{"status":"FAILURE","fail_reason":"upstream pool exhausted"}}'
    expect(describeError({ kind: 'http', status: 502, body: raw, verbatim: true })).toBe(raw)
  })

  it('accepted execution errors do not claim the upstream definitely received the request', () => {
    const text = describeError({
      kind: 'execution',
      detail: 'accepted',
      message: 'timeout',
    })
    expect(text).toContain('可能已被上游接收')
    expect(text).not.toContain('请求已经提交')
  })

  /**
   * comfly 这类网关在地区限制 / WAF / 登录页上会回整页 HTML。
   * 以前 parse 错误只显示“格式对不上”，用户看不到 HTML 里真正的“不支持当前地区”；
   * 这里把原文剥成可读摘要，又不能把标签塞回日志。
   */
  it('★★ 服务端返回 HTML 时，错误要带可读原文，不能只报格式对不上', () => {
    const text = describeError({
      kind: 'parse',
      raw: '<html><h1>识别到您当前网络处于暂不支持的地区</h1><p>暂时无法继续访问。</p></html>',
    })
    expect(text).toContain('识别到您当前网络处于暂不支持的地区')
    expect(text).toContain('暂时无法继续访问')
    expect(text).not.toContain('<h1>')

    const httpText = describeError({
      kind: 'http',
      status: 451,
      body: '<html><h1>识别到您当前网络处于暂不支持的地区</h1></html>',
    })
    expect(httpText).toContain('HTTP 451')
    expect(httpText).toContain('识别到您当前网络处于暂不支持的地区')
    expect(httpText).not.toContain('<h1>')
  })
})

/**
 * 用户 2026-10-03 与 2026-10-14 各踩过一次 `[object Object]`：渠道层抛的不是
 * `Error` 实例，直接 `String(e)` 就把真实原因吞了。这个入口是那份共用兜底。
 */
describe('errorTextOf：任意抛出物 → 人能读的一句话', () => {
  it('★★ ChannelError（带 appError 载荷的 Error）翻成人话，不能是 [object Object]', () => {
    const text = errorTextOf(new FakeChannelError())
    expect(text).not.toContain('[object Object]')
    expect(text).toContain('渠道')
  })

  it('★★ 裸 AppError 字面量（渠道层直接抛的对象）也要翻成人话', () => {
    const text = errorTextOf({ kind: 'http', status: 500 })
    expect(text).not.toContain('[object Object]')
    expect(text).toContain('500')
  })

  it('★ 普通 Error / 字符串 / 带 message 的对象逐层兜底', () => {
    expect(errorTextOf(new Error('boom'))).toBe('boom')
    expect(errorTextOf('直接是字符串')).toBe('直接是字符串')
    expect(errorTextOf({ message: '人话' })).toBe('人话')
  })
})
