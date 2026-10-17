import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_HEARTBEAT_MS, startUiHeartbeat } from './uiHeartbeat'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  isTauri: vi.fn(() => true),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}))

describe('桌面壳心跳', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.invoke.mockClear()
    mocks.isTauri.mockReturnValue(true)
  })

  it('挂载后立即报活，并每 5 秒继续报活', () => {
    const stop = startUiHeartbeat()
    expect(mocks.invoke).toHaveBeenCalledWith('ui_heartbeat')
    vi.advanceTimersByTime(UI_HEARTBEAT_MS)
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    stop()
  })

  it('停止后不再发心跳；浏览器环境完全不调用桌面命令', () => {
    const stop = startUiHeartbeat()
    stop()
    vi.advanceTimersByTime(UI_HEARTBEAT_MS * 3)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)

    mocks.invoke.mockClear()
    mocks.isTauri.mockReturnValue(false)
    const browserStop = startUiHeartbeat()
    vi.advanceTimersByTime(UI_HEARTBEAT_MS * 2)
    expect(mocks.invoke).not.toHaveBeenCalled()
    browserStop()
  })
})
