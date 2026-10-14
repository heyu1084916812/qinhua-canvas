import { useEffect, useRef, useState } from 'react'
import type { InspirationCase } from '../../domain/inspiration/cases'
import styles from './InspirationPage.module.css'

/**
 * 案例详情灯箱。
 *
 * **抄素材页那套**（用户 2026-10-14：「我的灵感库有什么可以抄我的素材页的」）：
 * 左边大图、右边详情、Esc 或点空白关闭。差别只有一处 —— 灵感案例是**外部只读内容**，
 * 所以这里给的是「复制提示词」和「看原图出处」，没有下载、没有打标签。
 */
export function InspirationDetail({
  item,
  onClose,
}: {
  item: InspirationCase
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [onClose])

  const copy = () => {
    if (!item.prompt) return
    void navigator.clipboard
      ?.writeText(item.prompt)
      .then(() => {
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div
      className={styles.scrim}
      data-inspiration-detail
      onPointerDown={(e) => {
        /** 只有点在**背板本身**上才关（点内容区不关） */
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.detail}>
        <div className={styles.detailStage}>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.title} data-inspiration-detail-image />
          ) : (
            <span className={styles.shotEmpty}>这个案例没有预览图</span>
          )}
        </div>

        <aside className={styles.detailSide}>
          <header className={styles.detailHead}>
            <h2 className={styles.detailTitle} data-inspiration-detail-title>
              {item.title}
            </h2>
            <button
              ref={closeRef}
              type="button"
              className={styles.close}
              data-inspiration-detail-close
              onClick={onClose}
            >
              关闭 (Esc)
            </button>
          </header>

          <p className={styles.detailMeta} data-inspiration-detail-meta>
            {item.sourceName}
            {item.credit ? ` · ${item.credit}` : ''}
          </p>

          {item.tags.length > 0 && (
            <p className={styles.tags}>
              {item.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </p>
          )}

          <p className={styles.detailLabel}>提示词</p>
          <pre className={styles.promptBox} data-inspiration-detail-prompt>
            {item.prompt || '这个案例没有留下提示词'}
          </pre>

          <div className={styles.detailActions}>
            <button
              type="button"
              className={styles.copy}
              data-inspiration-detail-copy
              onClick={copy}
            >
              {copied ? '已复制' : '复制提示词'}
            </button>
            {item.creditUrl && (
              <a
                className={styles.link}
                href={item.creditUrl}
                target="_blank"
                rel="noreferrer"
                data-inspiration-detail-origin
              >
                看原图出处
              </a>
            )}
            {item.docUrl && (
              <a
                className={styles.link}
                href={item.docUrl}
                target="_blank"
                rel="noreferrer"
              >
                仓库内位置
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
