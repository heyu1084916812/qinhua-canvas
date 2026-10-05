import { useEffect, useSyncExternalStore } from 'react'
import { usePlatform } from './providers/PlatformProvider'
import {
  checkForUpdate,
  dismissUpdate,
  getUpdateState,
  startInstallUpdate,
  subscribeUpdate,
} from './updateState'
import { shouldNotify, type UpdateVerdict } from './updateVerdict'
import styles from './update.module.css'

/**
 * 自动更新的两块界面（《轻画-桌面封装方案.md》§5 / 对账 #223）。
 *
 * 分工：
 * - `UpdateNotice`（右下角一条）：**只在有话说的时候出现**。启动时静默查一次，
 *   查到新版才弹；用户自己点的「检查更新」则会如实报四档（含"已是最新""还没接地址"）。
 * - `UpdateButton`（侧栏底部）：随时能点的手动入口，与「主题」同一列。
 *
 * 浏览器里 `platform.updater` 不存在 —— 两块都**自动消失**，不是错误、也不占位。
 */

const TONE_CLASS: Record<UpdateVerdict['tone'], string> = {
  info: styles.toneInfo,
  ok: styles.toneOk,
  warn: styles.toneWarn,
  error: styles.toneError,
}

export function UpdateNotice() {
  const platform = usePlatform()
  const updater = platform.updater
  const state = useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState)

  /** 启动时静默查一次：只查不下载，也不打扰（要不要显示由 `shouldNotify` 决定） */
  useEffect(() => {
    if (!updater) return
    void checkForUpdate(updater, 'auto')
  }, [updater])

  if (!updater || !state.verdict || state.dismissed) return null
  if (!shouldNotify(state.verdict, state.source)) return null

  const verdict = state.verdict
  const installing = state.busy && verdict.action === 'install'

  return (
    <div
      className={`${styles.bar} ${TONE_CLASS[verdict.tone]}`}
      role="status"
      data-update-notice
      data-update-tone={verdict.tone}
    >
      <span className={styles.text}>
        {verdict.text}
        {verdict.action === 'install' && state.busy ? ' · 正在下载并安装…' : ''}
      </span>
      {verdict.action === 'install' && (
        <button
          type="button"
          className={styles.action}
          data-update-install
          disabled={state.busy}
          onClick={() => void startInstallUpdate(updater)}
        >
          {installing ? '安装中…' : '重启并更新'}
        </button>
      )}
      <button
        type="button"
        className={styles.close}
        data-update-dismiss
        aria-label="以后再说"
        title="以后再说"
        onClick={() => dismissUpdate()}
      >
        以后再说
      </button>
    </div>
  )
}

export function UpdateButton({ open }: { open: boolean }) {
  const platform = usePlatform()
  const updater = platform.updater
  const state = useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState)

  if (!updater) return null

  const label = state.busy ? '正在检查…' : '检查更新'
  return (
    <button
      type="button"
      className={open ? styles.sideBtn : `${styles.sideBtn} ${styles.sideBtnCollapsed}`}
      data-update-check
      aria-label={label}
      title={label}
      disabled={state.busy}
      onClick={() => void checkForUpdate(updater, 'manual')}
    >
      <span className={styles.sideIcon} aria-hidden="true">
        <IconUpdate />
      </span>
      {open && <span>{label}</span>}
    </button>
  )
}

/** 循环箭头：与侧栏其它图标同一套画法（细线 + currentColor） */
function IconUpdate({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.2h-4.2" />
    </svg>
  )
}
