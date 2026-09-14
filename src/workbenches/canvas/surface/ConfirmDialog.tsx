import { useEffect, useRef } from 'react'
import styles from './ConfirmDialog.module.css'

/**
 * 二次确认对话框（§6.19.1：全图重跑「需二次确认弹窗，确认前不进入执行引擎」）。
 *
 * 通用浮层，不绑定任何业务：调用方给文案与两个回调即可。
 * 关闭途径：遮罩点击 / `Esc` / 「取消」；打开时焦点落在确认键（键盘可达，无障碍 §4.5）。
 * 居中卡片，遮罩与 LogPanel 同口径（rgba(0,0,0,0.18)）。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className={styles.overlay} data-confirm-dialog onClick={onCancel}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>{title}</div>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} data-confirm-cancel onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={styles.confirm}
            data-confirm-ok
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
