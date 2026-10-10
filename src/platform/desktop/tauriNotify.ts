import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import type { NotifyPermission, NotifyPort } from '../ports'

/**
 * **系统通知的壳实现**（对账 #392）：转发到 `tauri-plugin-notification`。
 *
 * 为什么不复用页面自带的 `Notification`：壳里跑的是 WebView2，它的权限状态不可靠，
 * 「生成完成」经常**静默不弹**，而界面上还得如实说"支持"—— 那种"说支持却弹不出来"
 * 比直接说不支持更糟。走插件之后，"能不能弹"由壳回答。
 *
 * 一条如实记下的能力边界：插件的 API 只给"是否已授权"，**读不到"被拒绝过"**这个中间态
 * （Windows 上也没有系统级授权弹窗）。所以 `state()` 只会返回 `granted` / `default`；
 * `denied` 只在**用户刚点了申请**、而插件明确回了 denied 时才出现 —— 不猜。
 */
export function createTauriNotify(): NotifyPort {
  return {
    async state(): Promise<NotifyPermission> {
      try {
        return (await isPermissionGranted()) ? 'granted' : 'default'
      } catch {
        /** 插件没接上 / 平台不支持：如实说"没有这一档"，不假装能弹 */
        return 'unsupported'
      }
    },

    async request(): Promise<NotifyPermission> {
      try {
        const result = await requestPermission()
        return result === 'granted' ? 'granted' : 'denied'
      } catch {
        return 'unsupported'
      }
    },

    async send(title: string, body: string): Promise<boolean> {
      try {
        if (!(await isPermissionGranted())) return false
        sendNotification({ title, body })
        return true
      } catch {
        return false
      }
    },
  }
}
