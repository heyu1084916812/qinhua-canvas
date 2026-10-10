import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { NotifyKind } from '../../domain/ui/notify'
import { getNotifyPrefs, setNotifyPref, subscribeNotifyPrefs } from '../../state/ui/notifyPrefs'
import {
  requestSystemNotify,
  sendSystemNotify,
  systemNotifyState,
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
  unsupported: '当前运行时没有系统通知能力 —— 页内提示照常工作。',
}

export function NotifyPanel() {
  const platform = usePlatform()
  const prefs = useSyncExternalStore(subscribeNotifyPrefs, getNotifyPrefs)
  /**
   * 桌面壳里有 `platform.notify`（官方通知插件）⇒ 走它；浏览器里没有 ⇒ 退回页面自带的
   * `Notification`。**初始值给 default 而不是现读**：现读那条在壳里是异步的（对账 #392）。
   */
  const [desktop, setDesktop] = useState<DesktopNotifyState>('default')
  const [sendResult, setSendResult] = useState('')

  useEffect(() => {
    let alive = true
    void systemNotifyState(platform.notify).then((state) => {
      if (alive) setDesktop(state)
    })
    return () => {
      alive = false
    }
  }, [platform])

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
              void requestSystemNotify(platform.notify).then(setDesktop)
            }}
          >
            允许系统通知
          </button>
        )}
        {/*
          「发一条测试通知」（对账 #392）：权限拿到之后给一个**当场可验证**的出口 ——
          系统弹不弹是操作系统的事，但"我们真的把这条发给系统了"必须能自己证明。
        */}
        {desktop === 'granted' && (
          <button
            type="button"
            className={styles.action}
            data-desktop-notify-test
            onClick={() => {
              void sendSystemNotify(
                platform.notify,
                '轻画',
                '这是一条测试通知 —— 看到它就说明系统通知是通的。',
              ).then((ok) =>
                setSendResult(
                  ok
                    ? '已发给系统（如果没看到，去系统「通知」里看轻画是不是被静音了）'
                    : '这次没发出去：系统那边没允许',
                ),
              )
            }}
          >
            发一条测试通知
          </button>
        )}
        {sendResult ? (
          <p className={styles.hint} data-desktop-notify-test-result>
            {sendResult}
          </p>
        ) : null}
      </section>
    </div>
  )
}
