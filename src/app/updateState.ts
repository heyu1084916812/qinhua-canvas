import type { UpdatePort, UpdateStatus } from '../platform/ports'
import { describeUpdate, type UpdateSource, type UpdateVerdict } from './updateVerdict'

/**
 * 「检查更新」这块的**模块级 UI 态**（与 `sidebarState` 同一条路子：外部 store + 订阅，
 * 不进业务 store，也不落盘 —— 版本状态是**观察到的现实**，不该被缓存成"上次查过"）。
 *
 * 两个界面（侧栏按钮 / 底部提示条）读同一份状态：各存一份必然会出现
 * 「按钮说已是最新、条子还说有新版本」这种自相矛盾。
 */
export interface UpdateUiState {
  verdict: UpdateVerdict | null
  source: UpdateSource
  /** 正在查 / 正在下载安装 */
  busy: boolean
  /** 用户点了"以后再说"：这条不再显示（下次检查再出现） */
  dismissed: boolean
}

const initial: UpdateUiState = { verdict: null, source: 'auto', busy: false, dismissed: false }

let state: UpdateUiState = initial
const listeners = new Set<() => void>()

function set(patch: Partial<UpdateUiState>): void {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

export function subscribeUpdate(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 必须返回**稳定引用**（没变就返回同一个对象），否则 `useSyncExternalStore` 会死循环 */
export function getUpdateState(): UpdateUiState {
  return state
}

/**
 * 查一次。
 *
 * 端口自己不抛（Rust 侧把失败也翻成 `failed` 一档）；这里的 `catch` 兜的是**调用链本身**
 * 断掉（比如壳里命令没注册）—— 那种情况必须说出来，不能静默当"已是最新"。
 */
export async function checkForUpdate(
  updater: UpdatePort,
  source: UpdateSource = 'manual',
): Promise<UpdateStatus | null> {
  set({ busy: true })
  try {
    const status = await updater.check()
    set({ verdict: describeUpdate(status), source, busy: false, dismissed: false })
    return status
  } catch (err) {
    set({
      verdict: {
        tone: 'error',
        text: `检查更新失败：${err instanceof Error ? err.message : String(err)}`,
        action: null,
      },
      source,
      busy: false,
      dismissed: false,
    })
    return null
  }
}

/** 点「重启并更新」。成功后应用会自己退出（Windows），所以这里**不设 busy=false 的兜底成功分支** */
export async function startInstallUpdate(updater: UpdatePort): Promise<void> {
  set({ busy: true })
  try {
    await updater.install()
    set({ busy: false })
  } catch (err) {
    set({
      verdict: {
        tone: 'error',
        text: `更新失败：${err instanceof Error ? err.message : String(err)}`,
        action: null,
      },
      source: 'manual',
      busy: false,
      dismissed: false,
    })
  }
}

/** 「以后再说」：藏起来，但**不改** verdict（下次查还会重新报） */
export function dismissUpdate(): void {
  set({ dismissed: true })
}

/** 仅测试：模块级状态会跨用例存活，不重置会出现"单跑绿、连着跑红" */
export function __resetUpdateForTest(): void {
  state = initial
  for (const fn of listeners) fn()
}
