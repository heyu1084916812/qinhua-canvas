import { useEffect } from 'react'
import { useCanvasStore, useNotice } from '../storeContext'
import styles from './CanvasNotice.module.css'

/**
 * 画布级瞬时提示（弱提示）。
 * 用于 §6.12「另一种类型拖入被拒绝并给出弱提示」、§6.10「超过 2 张弱提示」等
 * 「不打断操作、只说明原因」的反馈。展示 2.4s 后自动消失。
 *
 * 用 role=status + aria-live=polite 播报（产品文档 §4.5「动态播报」）。
 */
export function CanvasNotice() {
  const store = useCanvasStore()
  const notice = useNotice()

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => store.clearNotice(notice.id), 2400)
    return () => clearTimeout(t)
  }, [notice, store])

  if (!notice) return null
  return (
    <div className={styles.notice} role="status" aria-live="polite" data-canvas-notice>
      {notice.text}
    </div>
  )
}
