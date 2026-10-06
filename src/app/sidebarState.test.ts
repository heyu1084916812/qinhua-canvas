import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_EXPANDED_W,
  SIDEBAR_PIN_STORAGE_KEY,
  __resetSidebarForTest,
  getSidebarHovering,
  getSidebarOpen,
  getSidebarPinned,
  setSidebarHovering,
  setSidebarPinned,
  sidebarWidth,
  subscribeSidebar,
  toggleSidebarPin,
} from './sidebarState'

/**
 * 应用壳侧栏状态（产品文档 §2.2）。
 *
 * ## 2026-10-06 换了口径，这份测试是那次改动的看守
 *
 * 旧口径：「不记忆上次状态，刷新回到收起态」。
 * 新口径（用户）：**悬停即展开**（临时、不落盘）＋**折叠按钮 = 常驻开关**（落盘、跨重启记住）。
 * 于是状态从"一个布尔"变成"两个来源、一个宽度"，最容易写错的三处都钉在这里：
 * ① 常驻优先（锁上之后移开鼠标不能收回）；② 落盘（重启要读回来）；③ 悬停不留痕迹。
 *
 * 它是模块级单例，所以每个用例前必须复位 —— 否则状态会**跨用例泄漏**
 * （那类「单独跑绿、连着跑红」最难查）。落盘值同理，`__resetSidebarForTest` 一并清。
 */

/** 最小 localStorage 替身：测试跑在 node 环境（没有 localStorage），而"落盘"这条必须能验。 */
function installFakeStorage() {
  const map = new Map<string, string>()
  const fake = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = fake
  return fake
}

describe('sidebarState · 应用壳侧栏', () => {
  const originalStorage = (globalThis as { localStorage?: unknown }).localStorage
  let storage: ReturnType<typeof installFakeStorage>

  beforeEach(() => {
    storage = installFakeStorage()
    __resetSidebarForTest()
  })

  afterAll(() => {
    ;(globalThis as { localStorage?: unknown }).localStorage = originalStorage
  })

  it('★ 没锁过时初始是收起（不替用户决定）', () => {
    expect(getSidebarPinned()).toBe(false)
    expect(getSidebarOpen()).toBe(false)
    expect(sidebarWidth()).toBe(SIDEBAR_COLLAPSED_W)
  })

  it('★ 收起 64px、展开 240px（§5.10 定死两个值）', () => {
    expect(SIDEBAR_COLLAPSED_W).toBe(64)
    expect(SIDEBAR_EXPANDED_W).toBe(240)
    setSidebarHovering(true)
    expect(sidebarWidth()).toBe(SIDEBAR_EXPANDED_W)
    expect(sidebarWidth(false)).toBe(SIDEBAR_COLLAPSED_W)
  })

  it('★★ 悬停展开、移开收回，而且**不留痕**（临时态不落盘）', () => {
    setSidebarHovering(true)
    expect(getSidebarOpen()).toBe(true)
    expect(getSidebarHovering()).toBe(true)
    setSidebarHovering(false)
    expect(getSidebarOpen()).toBe(false)
    expect(storage.getItem(SIDEBAR_PIN_STORAGE_KEY)).toBeNull()
  })

  it('★★ 常驻优先：锁上之后移开鼠标仍然展开', () => {
    toggleSidebarPin()
    expect(getSidebarPinned()).toBe(true)
    setSidebarHovering(true)
    setSidebarHovering(false)
    expect(getSidebarOpen()).toBe(true)
    expect(sidebarWidth()).toBe(SIDEBAR_EXPANDED_W)
  })

  it('★★ 常驻态落盘（跨重启记住）', () => {
    setSidebarPinned(true)
    expect(storage.getItem(SIDEBAR_PIN_STORAGE_KEY)).toBe('1')
    setSidebarPinned(false)
    expect(storage.getItem(SIDEBAR_PIN_STORAGE_KEY)).toBe('0')
    expect(getSidebarOpen()).toBe(false)
  })

  it('★★ 重启后从落盘值读回常驻态（模块重新加载）', async () => {
    storage.setItem(SIDEBAR_PIN_STORAGE_KEY, '1')
    vi.resetModules()
    const fresh = await import('./sidebarState')
    expect(fresh.getSidebarPinned()).toBe(true)
    expect(fresh.getSidebarOpen()).toBe(true)
  })

  it('★ 落盘不可用时不抛（隐私模式 / SSR）：这次照常生效，只是记不住', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(() => setSidebarPinned(true)).not.toThrow()
    expect(getSidebarPinned()).toBe(true)
  })

  it('toggle 两态来回切', () => {
    toggleSidebarPin()
    expect(getSidebarPinned()).toBe(true)
    toggleSidebarPin()
    expect(getSidebarPinned()).toBe(false)
  })

  it('状态没变时不通知订阅者（避免白重渲）', () => {
    let hits = 0
    const off = subscribeSidebar(() => {
      hits += 1
    })
    setSidebarHovering(false) // 本来就是 false
    expect(hits).toBe(0)
    setSidebarHovering(true)
    expect(hits).toBe(1)
    setSidebarPinned(false) // 本来就是 false
    expect(hits).toBe(1)
    off()
    setSidebarPinned(true)
    expect(hits).toBe(1)
  })

  it('__resetSidebarForTest 连落盘值一起清掉', () => {
    setSidebarPinned(true)
    setSidebarHovering(true)
    __resetSidebarForTest()
    expect(storage.getItem(SIDEBAR_PIN_STORAGE_KEY)).toBeNull()
    expect(getSidebarPinned()).toBe(false)
    expect(getSidebarHovering()).toBe(false)
    expect(getSidebarOpen()).toBe(false)
  })
})
