import { invoke } from '@tauri-apps/api/core'
import type { UpdatePort, UpdateStatus } from '../ports'

/**
 * 自动更新的**桌面壳实现**（《轻画-桌面封装方案.md》§5 / 对账 #223）。
 *
 * 为什么不在前端直接调 updater 的 JS API、而是转一手 Rust：
 * 那样「更新地址还没配」和「网络不通」会糊成同一个异常串，界面就只能含糊地说"检查失败"。
 * Rust 侧（`src-tauri/src/lib.rs` 的 `check_update` / `install_update`）把四档说清楚 ——
 * 前端只认 `state`，不解析错误文本。
 *
 * 与浏览器侧的关系：**这个端口在浏览器里不存在**（`createWebPlatform` 不传 `updater`），
 * 所以界面入口要按"有没有这一项"来决定显不显示。
 */
export function createTauriUpdater(): UpdatePort {
  return {
    async check(): Promise<UpdateStatus> {
      return await invoke<UpdateStatus>('check_update')
    },
    async install(): Promise<void> {
      await invoke('install_update')
    },
  }
}
