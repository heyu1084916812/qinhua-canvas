import { useEffect } from 'react'
import styles from './SourcePreview.module.css'

/**
 * 漫剧原文预览（对账 #547）。
 *
 * 拆集时已经把 `sourceText` 与每集的 `sourceRange` 落库；这里只负责把那一段
 * 放回用户眼前。它是只读浮层，不编辑文档 —— 校对原文应回左侧输入框，
 * 免得用户在预览里改了却以为改动已经进入拆集范围。
 */
export function SourcePreview({
  title,
  range,
  text,
  onClose,
}: {
  title: string
  range?: { from: number; to: number }
  text: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={styles.overlay}
      data-storyboard-source-preview
      role="presentation"
      onClick={onClose}
    >
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`原文：${title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.titleWrap}>
            <h2 className={styles.title}>{title}</h2>
            {range ? (
              <span className={styles.range} data-storyboard-source-range>
                原文第 {range.from + 1}–{range.to} 字
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.close}
            data-storyboard-source-close
            onClick={onClose}
          >
            关闭 (Esc)
          </button>
        </header>
        <div className={styles.body} data-storyboard-source-text>
          {text || '这一集没有可回看的原文片段。'}
        </div>
      </section>
    </div>
  )
}
