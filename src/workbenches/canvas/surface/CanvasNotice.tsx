import { useEffect } from 'react'
import { noticeA11y } from '../../../domain/ui/notice'
import { useCanvasStore, useNotice } from '../storeContext'
import styles from './CanvasNotice.module.css'

/**
 * 画布级瞬时提示（弱提示）。
 * 用于 §6.12「另一种类型拖入被拒绝并给出弱提示」、§6.10「超过 2 张弱提示」等
 * 「不打断操作、只说明原因」的反馈。展示 2.4s 后自动消失。
 *
 * 播报分两档（产品文档 §4.5「动态播报：错误 `role=alert`，状态 `role=status`」）：
 * - `tone='error'`（被拒绝 / 被中止，如"没有渠道提供模型"）⇒ `role=alert` + `aria-live=assertive`；
 * - 其余（已保存 / 已解组 / 生成完成…）⇒ `role=status` + `aria-live=polite`。
 *
 * `data-notice-tone` 是给冒烟读的锚点：只改语义时，DOM 计数照样会绿 —— 必须能直接读到"这一条是哪一档"。
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
  /** role / aria-live 由 `noticeA11y` 一处决定（页面级状态行用同一份） */
  const a11y = noticeA11y(notice.tone)
  return (
    <div
      className={styles.notice}
      {...a11y}
      data-canvas-notice
      data-notice-tone={notice.tone}
    >
      {notice.text}
    </div>
  )
}
