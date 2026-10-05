import type { UpdateStatus } from '../platform/ports'

/** 这次检查是谁发起的（决定"要不要打扰用户"，见 `shouldNotify`） */
export type UpdateSource = 'auto' | 'manual'

/** 界面要用的一句话，外加"要不要给重启按钮" */
export interface UpdateVerdict {
  tone: 'info' | 'ok' | 'warn' | 'error'
  text: string
  action: 'install' | null
}

/**
 * 把 Rust 侧那四档状态翻成**一句人话**（方案 §5 / 对账 #223）。
 *
 * 为什么单独一个纯函数：四档里有三档都是"什么都不做"，
 * 但**说辞完全不同** —— 「已是最新」是安心，「没配地址」是提醒还没接完，「失败」要带原话。
 * 混成一句"检查失败"就等于把"我们还没接完"说成"你网络有问题"。
 */
export function describeUpdate(status: UpdateStatus): UpdateVerdict {
  if (status.state === 'available') {
    return {
      tone: 'info',
      text: `有新版本 ${status.version}（当前 ${status.current}）`,
      action: 'install',
    }
  }
  if (status.state === 'up-to-date') {
    return { tone: 'ok', text: `已是最新版本 ${status.current}`, action: null }
  }
  if (status.state === 'not-configured') {
    return { tone: 'warn', text: '自动更新还没接更新地址（要先定更新包放哪）', action: null }
  }
  return {
    tone: 'error',
    text: `检查更新失败：${status.error ?? '原因未知'}`,
    action: null,
  }
}

/**
 * 这条结果该不该弹出来。
 *
 * - 启动时**静默**查（`auto`）：只有"真有新版"才值得打扰 —— 每次开应用都弹一句
 *   "已是最新"，用户三天就会烦；
 * - 用户**自己点**的（`manual`）：四档都要给说法 —— 点了没反应，人会以为按钮坏了。
 */
export function shouldNotify(verdict: UpdateVerdict, source: UpdateSource): boolean {
  if (source === 'manual') return true
  return verdict.action === 'install'
}
