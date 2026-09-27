import { beforeEach, describe, expect, it } from 'vitest'
import {
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_EXPANDED_W,
  __resetSidebarForTest,
  getSidebarOpen,
  setSidebarOpen,
  sidebarWidth,
  subscribeSidebar,
  toggleSidebar,
} from './sidebarState'

/**
 * 应用壳侧栏状态（产品文档 §2.2）。
 *
 * 它是模块级单例，所以每个用例前必须复位 —— 否则「展开」会**跨用例泄漏**，
 * 后面的用例起手就不是收起态（那类「单独跑绿、连着跑红」最难查）。
 */
describe('sidebarState · 应用壳侧栏', () => {
  beforeEach(() => {
    __resetSidebarForTest()
  })

  it('★ 初始为收起（产品口径：刷新回到收起态）', () => {
    expect(getSidebarOpen()).toBe(false)
    expect(sidebarWidth()).toBe(SIDEBAR_COLLAPSED_W)
  })

  it('★ 收起 64px、展开 240px（§5.10 定死两个值）', () => {
    expect(SIDEBAR_COLLAPSED_W).toBe(64)
    expect(SIDEBAR_EXPANDED_W).toBe(240)
    setSidebarOpen(true)
    expect(sidebarWidth()).toBe(SIDEBAR_EXPANDED_W)
  })

  it('toggle 两态来回切', () => {
    toggleSidebar()
    expect(getSidebarOpen()).toBe(true)
    toggleSidebar()
    expect(getSidebarOpen()).toBe(false)
  })

  it('订阅者收到变更通知', () => {
    let calls = 0
    const unsub = subscribeSidebar(() => {
      calls += 1
    })
    setSidebarOpen(true)
    expect(calls).toBe(1)
    // 取消订阅后不再收到
    unsub()
    setSidebarOpen(false)
    expect(calls).toBe(1)
  })

  it('★ 设成同一个值不通知（否则 useSyncExternalStore 会重复渲染）', () => {
    let calls = 0
    subscribeSidebar(() => {
      calls += 1
    })
    setSidebarOpen(false) // 本来就是 false
    expect(calls).toBe(0)
  })

  /**
   * ★ 状态**不进 localStorage / sessionStorage**。
   *
   * 这一条是产品口径的护栏（§2.2「不记忆上次状态」）：将来有人「顺手」
   * 加一行持久化，用例立刻红 —— 那正是不该发生的事。
   */
  it('★ 不持久化（刷新必须回到收起）', () => {
    setSidebarOpen(true)
    const dumped = JSON.stringify({
      local: typeof localStorage === 'undefined' ? {} : localStorage,
      session: typeof sessionStorage === 'undefined' ? {} : sessionStorage,
    })
    expect(dumped).not.toContain('sidebar')
  })
})
