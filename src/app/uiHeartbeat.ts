import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * 桌面壳存活心跳。
 *
 * 白屏时 React 根本没挂载，普通前端计时器也不会启动；因此这里只负责“正常挂载后
 * 持续报活”。Rust 侧在窗口可见却长时间收不到心跳时重载 WebView，避免永久白屏。
 */
export const UI_HEARTBEAT_MS = 5_000

export function startUiHeartbeat(): () => void {
  if (!isTauri()) return () => {}
  let stopped = false
  const beat = () => {
    if (stopped) return
    void invoke('ui_heartbeat').catch(() => {
      /* 心跳失败由 Rust 超时兜底；前端不弹提示，避免打扰 */
    })
  }
  beat()
  const timer = globalThis.setInterval(beat, UI_HEARTBEAT_MS)
  return () => {
    stopped = true
    globalThis.clearInterval(timer)
  }
}
