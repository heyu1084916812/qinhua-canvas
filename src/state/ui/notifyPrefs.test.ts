import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFY_STORAGE_KEY } from '../../domain/ui/notify'
import {
  __reloadNotifyPrefsForTest,
  getNotifyPrefs,
  setNotifyPref,
  subscribeNotifyPrefs,
} from './notifyPrefs'

/**
 * 通知偏好落盘（对账 #386 的 E5）。
 *
 * 判据不是"能写能读"，而是三件真会出事的事：
 * ① 改一档马上就能被订阅者看到（设置页的开关要跟手）；
 * ② 刷新后仍然是用户选的那份（`flow:notify` 真的写进去了）；
 * ③ 存储不可用 / 内容损坏 → 回默认，**不许崩**。
 */
function fakeStorage(seed: Record<string, string> = {}) {
  const backing = new Map(Object.entries(seed))
  return {
    backing,
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  }
}

describe('通知偏好 · 落盘与订阅', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage())
    __reloadNotifyPrefsForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('★ 没存过 → 默认（完成 / 失败开，批量进度关）', () => {
    expect(getNotifyPrefs()).toEqual({ success: true, failure: true, progress: false })
  })

  it('★★ 改一档：订阅者立刻收到，值也真写进了 localStorage', () => {
    let hits = 0
    const off = subscribeNotifyPrefs(() => {
      hits += 1
    })
    setNotifyPref('progress', true)
    expect(hits).toBe(1)
    expect(getNotifyPrefs().progress).toBe(true)
    expect(JSON.parse(globalThis.localStorage.getItem(NOTIFY_STORAGE_KEY) ?? '{}')).toEqual({
      success: true,
      failure: true,
      progress: true,
    })
    off()
  })

  it('★★ 换一次"进程"（≈刷新）读回的是存过的那份', () => {
    setNotifyPref('success', false)
    setNotifyPref('failure', false)
    __reloadNotifyPrefsForTest()
    expect(getNotifyPrefs()).toEqual({ success: false, failure: false, progress: false })
  })

  it('★ 退订之后不再收到通知（设置页卸载要能摘干净）', () => {
    let hits = 0
    const off = subscribeNotifyPrefs(() => {
      hits += 1
    })
    off()
    setNotifyPref('failure', false)
    expect(hits).toBe(0)
  })

  it('★★ 内容损坏 / 存储抛错 → 回默认，不崩', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [NOTIFY_STORAGE_KEY]: '{ 这不是 JSON' }))
    __reloadNotifyPrefsForTest()
    expect(getNotifyPrefs()).toEqual({ success: true, failure: true, progress: false })

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('隐私模式禁止访问')
      },
      setItem: () => {
        throw new Error('配额已满')
      },
      removeItem: () => {},
    })
    __reloadNotifyPrefsForTest()
    expect(getNotifyPrefs()).toEqual({ success: true, failure: true, progress: false })
    // 写失败也不许抛：本次生效就够
    expect(() => setNotifyPref('success', false)).not.toThrow()
    expect(getNotifyPrefs().success).toBe(false)
  })
})
