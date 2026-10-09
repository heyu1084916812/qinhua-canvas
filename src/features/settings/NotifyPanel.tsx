import { useState, useSyncExternalStore } from 'react'
import type { NotifyKind } from '../../domain/ui/notify'
import { getNotifyPrefs, setNotifyPref, subscribeNotifyPrefs } from '../../state/ui/notifyPrefs'
import {
  desktopNotifyState,
  requestDesktopNotify,
  type DesktopNotifyState,
} from '../shared/notify/desktopNotify'
import styles from './NotifyPanel.module.css'

/**
 * 「通知」面板（对账 #386 的 E5 —— 设置 → 数据 → 通知）。
 *
 * 三档提示 + 一块系统通知说明。三条口径写死在界面上，免得日后被改回去：
 * - 三档只管**弹不弹**，不改生成行为（全关也照常出图）；
 * - 批量进度**默认关**（一次 20 张会弹 20 条，比不弹还吵），想要的人自己开；
 * - 系统通知**不假装**：运行时没有能力就如实说"只有页内提示"，
 *   而且绝不自动申请权限 —— 那会弹系统对话框，只能由用户点按钮触发。
 */
const ROWS: readonly { kind: NotifyKind; label: string; hint: string }[] = [
  { kind: 'success', label: '生成完成', hint: '这一趟真的出图了（按出图的张数报）' },
  { kind: 'failure', label: '生成失败', hint: '有任务没出图；部分失败也报，并指路日志看原因' },
  { kind: 'progress', label: '批量进度', hint: '一次跑多个任务时逐条报进度。默认关：跑 20 张会弹 20 条' },
]

const DESKTOP_TEXT: Record<DesktopNotifyState, string> = {
  granted: '已允许 —— 生成完成 / 失败时，除了页内提示还会弹一条系统通知。',
  default: '这个运行时支持系统通知，但还没允许。点下面的按钮申请（只有你点了才会弹系统对话框）。',
  denied: '系统通知被拒绝过：现在只有页内提示。要改的话去系统 / 浏览器设置里放行，再回来刷新。',
  unsupported:
    '当前运行时没有系统通知能力（打包版还没接通知插件）—— 页内提示照常工作。',
}

export function NotifyPanel() {
  const prefs = useSyncExternalStore(subscribeNotifyPrefs, getNotifyPrefs)
  const [desktop, setDesktop] = useState<DesktopNotifyState>(() => desktopNotifyState())

  return (
    <div className={styles.panel} data-notify-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>提示时机</h3>
        <p className={styles.caption}>
          本机偏好：换一台机器要重设。三档只管弹不弹 —— 全关也照常出图，只是不弹提示。
        </p>

        {ROWS.map((row) => (
          <label className={styles.switchRow} key={row.kind}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{row.label}</span>
              <span className={styles.hint}>{row.hint}</span>
            </span>
            <span className={styles.switchBox}>
              <input
                type="checkbox"
                className={styles.switchInput}
                checked={prefs[row.kind]}
                data-notify-toggle={row.kind}
                onChange={(e) => setNotifyPref(row.kind, e.target.checked)}
              />
              <span className={styles.track} aria-hidden="true" />
            </span>
          </label>
        ))}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>系统通知</h3>
        <p className={styles.caption} data-desktop-notify-state={desktop}>
          {DESKTOP_TEXT[desktop]}
        </p>
        {desktop === 'default' && (
          <button
            type="button"
            className={styles.action}
            data-desktop-notify-request
            onClick={() => {
              void requestDesktopNotify().then(setDesktop)
            }}
          >
            允许系统通知
          </button>
        )}
      </section>
    </div>
  )
}
