import { describe, expect, it, vi } from 'vitest'
import { bindAbortToCancel } from './abortToCancel'

describe('bindAbortToCancel', () => {
  it('已经取消时立即执行一次，不注册悬挂监听', () => {
    const controller = new AbortController()
    controller.abort()
    const cancel = vi.fn()
    const unbind = bindAbortToCancel(controller.signal, cancel)
    expect(cancel).toHaveBeenCalledTimes(1)
    unbind()
  })

  it('取消时执行一次，解除绑定后不再响应', () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const unbind = bindAbortToCancel(controller.signal, cancel)
    controller.abort()
    controller.abort()
    expect(cancel).toHaveBeenCalledTimes(1)
    unbind()
    controller.abort()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
