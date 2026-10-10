import { describe, expect, it } from 'vitest'
import type { NotifyPort } from '../../../platform/ports'
import {
  desktopNotify,
  desktopNotifyState,
  requestSystemNotify,
  sendSystemNotify,
  systemNotifyState,
} from './desktopNotify'

/**
 * 系统通知的**两条路**（对账 #392）。
 *
 * - 桌面壳：`platform.notify` 存在 ⇒ 走官方通知插件（壳里页面自带的 `Notification`
 *   权限不可靠，实测会"界面说支持、实际不弹"）；
 * - 浏览器：没有端口 ⇒ 退回页面自带的 `Notification`（行为与本次改动前一致）。
 *
 * 这里钉的是"**有端口就一定走端口**"—— 少判这一下，壳里就会又回到那条不可靠的路上。
 */
describe('系统通知：有端口走端口，没端口走浏览器', () => {
  function fakePort(log: string[]): NotifyPort {
    return {
      state: async () => 'granted',
      request: async () => 'denied',
      send: async (title, body) => {
        log.push(`${title}|${body}`)
        return true
      },
    }
  }

  it('★ 有端口：state / request / send 三件都交给端口，不去碰 runtime 的 Notification', async () => {
    const log: string[] = []
    const port = fakePort(log)

    expect(await systemNotifyState(port)).toBe('granted')
    expect(await requestSystemNotify(port)).toBe('denied')
    expect(await sendSystemNotify(port, '轻画', '生成完成：4 张')).toBe(true)
    expect(log).toEqual(['轻画|生成完成：4 张'])
  })

  it('★ 没有端口：退回页面自带那条（node 环境没有 Notification ⇒ 如实说 unsupported）', async () => {
    expect(await systemNotifyState(undefined)).toBe('unsupported')
    expect(await requestSystemNotify(null)).toBe('unsupported')
    expect(await sendSystemNotify(undefined, '轻画', 'x')).toBe(false)
  })

  it('★ 端口抛错时不冒泡：send 返回 false（页内提示照旧，不被通知拖垮）', async () => {
    const port: NotifyPort = {
      state: async () => 'granted',
      request: async () => 'granted',
      send: async () => {
        throw new Error('插件没接上')
      },
    }
    /** 调用方 `void sendSystemNotify(...)` —— 冒出去就是页面上一条未捕获异常，必须吞在这里 */
    await expect(sendSystemNotify(port, '轻画', 'x')).resolves.toBe(false)
  })

  it('★ 浏览器那条路的两个同步函数仍然按"没授权就不弹"行事', () => {
    expect(desktopNotifyState()).toBe('unsupported')
    expect(desktopNotify('轻画', 'x')).toBe(false)
  })
})
