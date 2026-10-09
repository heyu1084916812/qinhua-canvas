/**
 * 系统级通知（对账 #386 的 E5 里「桌面通知走壳权限」那一条）。
 *
 * **先说清楚现在能做什么、不能做什么**（界面必须如实照说）：
 * - 只有运行时真的提供 `Notification`、而且用户**已经允许**过，才会弹系统通知；
 * - 打包版（Tauri 壳）目前**没有接通知插件**，所以壳里通常是 `unsupported` ——
 *   页内提示照常工作，界面写明"只有页内提示"，**不假装能弹**；
 * - 一律不主动申请权限：申请会弹系统对话框，那必须由用户在设置页按按钮触发。
 */
export type DesktopNotifyState = 'granted' | 'denied' | 'default' | 'unsupported'

/** 当前运行时的能力状态（每次现读，不缓存 —— 用户可能刚在浏览器里改了权限） */
export function desktopNotifyState(): DesktopNotifyState {
  try {
    if (typeof globalThis.Notification === 'undefined') return 'unsupported'
    const p = globalThis.Notification.permission
    return p === 'granted' || p === 'denied' || p === 'default' ? p : 'unsupported'
  } catch {
    return 'unsupported'
  }
}

/**
 * 申请系统通知权限 —— **只能由用户手势触发**。
 * 返回申请之后重新读到的真实状态（用户拒绝就是 denied，不重试、不纠缠）。
 */
export async function requestDesktopNotify(): Promise<DesktopNotifyState> {
  try {
    if (typeof globalThis.Notification === 'undefined') return 'unsupported'
    await globalThis.Notification.requestPermission()
  } catch {
    /* 运行时没有这个能力 / 用户直接关掉对话框：下面照常读一次真实状态 */
  }
  return desktopNotifyState()
}

/**
 * 真的弹一条。返回 false = 这次没有系统通知（不支持 / 没允许 / 抛了）——
 * 调用方**不要**拿它决定要不要给页内提示：那两件事互不依赖。
 */
export function desktopNotify(title: string, body: string): boolean {
  if (desktopNotifyState() !== 'granted') return false
  try {
    new globalThis.Notification(title, { body })
    return true
  } catch {
    return false
  }
}
