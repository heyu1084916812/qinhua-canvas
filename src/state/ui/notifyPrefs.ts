import {
  DEFAULT_NOTIFY_PREFS,
  NOTIFY_STORAGE_KEY,
  notifyPrefsFrom,
  type NotifyKind,
  type NotifyPrefs,
} from '../../domain/ui/notify'

/**
 * 通知偏好（对账 #386 的 E5 —— 设置 → 数据 → 通知）。
 *
 * 与外观偏好同一族：**本机偏好**，落 `localStorage` 的 `flow:*`，同步读（刷新不闪），
 * 不进业务库、不随项目导出。
 *
 * 为什么是模块级 store 而不是 React context：写它的地方是设置面板，
 * 而读它的地方是**执行链路**（`CanvasExecutionProvider` 的 onFinish / onTaskUpdate）——
 * 后者不是组件树里的消费者，用 context 会把执行层拖进 UI 树，还会漏掉"面板没开着"的场景。
 */
let state: NotifyPrefs = read()
const listeners = new Set<() => void>()

function read(): NotifyPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(NOTIFY_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_NOTIFY_PREFS }
    return notifyPrefsFrom(JSON.parse(raw))
  } catch {
    /* 隐私模式禁止访问 / 内容损坏：回默认（默认是"完成与失败出声"，比静默好） */
    return { ...DEFAULT_NOTIFY_PREFS }
  }
}

function notify(): void {
  for (const fn of listeners) fn()
}

export function getNotifyPrefs(): NotifyPrefs {
  return state
}

export function subscribeNotifyPrefs(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 改一档：落盘 + 通知订阅者。
 *
 * 写失败**不影响本次生效**（只在内存里改，下次启动回落默认）——
 * 与外观偏好同一条处理：隐私模式下也要能用。
 */
export function setNotifyPref(kind: NotifyKind, on: boolean): void {
  state = { ...state, [kind]: on }
  try {
    globalThis.localStorage?.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 同上 */
  }
  notify()
}

/** 仅供测试：重新读盘并通知（清掉上一个用例留下的模块级状态） */
export function __reloadNotifyPrefsForTest(): void {
  state = read()
  notify()
}
