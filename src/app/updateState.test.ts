import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkForUpdate,
  dismissUpdate,
  getUpdateState,
  startInstallUpdate,
  subscribeUpdate,
  __resetUpdateForTest,
} from './updateState'
import type { UpdatePort, UpdateStatus } from '../platform/ports'

function fakeUpdater(over: Partial<UpdatePort> = {}): UpdatePort {
  return {
    async check(): Promise<UpdateStatus> {
      return { state: 'available', current: '0.1.0', version: '0.2.0', notes: null, error: null }
    },
    async install(): Promise<void> {
      /* 默认成功：Windows 上装完应用自己就退了，所以"返回"本身不该被当信号 */
    },
    ...over,
  }
}

beforeEach(() => {
  __resetUpdateForTest()
})

describe('updateState', () => {
  it('查一次：结果翻成人话进状态，并通知订阅者', async () => {
    let notified = 0
    const unsubscribe = subscribeUpdate(() => {
      notified += 1
    })
    await checkForUpdate(fakeUpdater(), 'manual')
    expect(getUpdateState().verdict?.action).toBe('install')
    expect(getUpdateState().source).toBe('manual')
    expect(getUpdateState().busy).toBe(false)
    expect(notified).toBeGreaterThan(0)
    unsubscribe()
  })

  it('★ 端口自己抛异常（壳里命令没注册那种）也要说出来，不能静默当"已是最新"', async () => {
    const updater = fakeUpdater({
      async check(): Promise<UpdateStatus> {
        throw new Error('command check_update not found')
      },
    })
    await checkForUpdate(updater, 'manual')
    const state = getUpdateState()
    expect(state.verdict?.tone).toBe('error')
    expect(state.verdict?.text).toContain('command check_update not found')
    expect(state.busy).toBe(false)
  })

  it('「以后再说」只藏这一条，不改判据（下次查还会重新报）', async () => {
    await checkForUpdate(fakeUpdater(), 'auto')
    dismissUpdate()
    expect(getUpdateState().dismissed).toBe(true)
    expect(getUpdateState().verdict?.action).toBe('install')
  })

  it('★ 安装失败：翻成带原话的错，且 busy 要落回来（否则按钮永远转圈）', async () => {
    const updater = fakeUpdater({
      async install(): Promise<void> {
        throw new Error('signature mismatch')
      },
    })
    await startInstallUpdate(updater)
    expect(getUpdateState().busy).toBe(false)
    expect(getUpdateState().verdict?.text).toContain('signature mismatch')
  })
})
