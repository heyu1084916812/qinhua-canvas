import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  checkIndexedDbAvailable,
  flushOnPageHide,
  subscribeExternalWrites,
} from './session'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('session 启动与会话', () => {
  it('非浏览器环境下 checkIndexedDbAvailable 视为可用', async () => {
    // node 下 window 与 indexedDB 均未定义，应返回 true（不阻断 SSR / 测试）
    expect(typeof window).toBe('undefined')
    expect(typeof indexedDB).toBe('undefined')
    await expect(checkIndexedDbAvailable()).resolves.toBe(true)
  })

  it('浏览器里 indexedDB 缺失视为不可用（隐私模式 / 策略禁用，不能当 SSR 放行）', async () => {
    vi.stubGlobal('window', {})
    expect(typeof indexedDB).toBe('undefined')
    await expect(checkIndexedDbAvailable()).resolves.toBe(false)
  })

  it('非浏览器环境下 flushOnPageHide 返回可用的清理函数且不抛错', () => {
    expect(typeof window).toBe('undefined')
    const cleanup = flushOnPageHide(() => {})
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })

  it('其他标签写入本项目时回调触发', async () => {
    if (typeof BroadcastChannel === 'undefined') return
    let fired = 0
    const cleanup = subscribeExternalWrites('projZ', () => {
      fired += 1
    })
    const ch = new BroadcastChannel('flow-cross-tab')
    ch.postMessage({ projectId: 'projZ', tab: 'other-tab', ts: 1 })
    await new Promise((r) => setTimeout(r, 20))
    ch.close()
    cleanup()
    expect(fired).toBe(1)
  })

  it('仅对本项目触发，他项目写入不回调', async () => {
    if (typeof BroadcastChannel === 'undefined') return
    let fired = 0
    const cleanup = subscribeExternalWrites('projA', () => {
      fired += 1
    })
    const ch = new BroadcastChannel('flow-cross-tab')
    ch.postMessage({ projectId: 'projB', tab: 'other', ts: 1 })
    await new Promise((r) => setTimeout(r, 20))
    ch.close()
    cleanup()
    expect(fired).toBe(0)
  })

  it('cleanup 后不再触发', async () => {
    if (typeof BroadcastChannel === 'undefined') return
    let fired = 0
    const cleanup = subscribeExternalWrites('projC', () => {
      fired += 1
    })
    cleanup()
    const ch = new BroadcastChannel('flow-cross-tab')
    ch.postMessage({ projectId: 'projC', tab: 'other', ts: 1 })
    await new Promise((r) => setTimeout(r, 20))
    ch.close()
    expect(fired).toBe(0)
  })
})
