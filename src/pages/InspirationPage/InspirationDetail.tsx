import { useEffect, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { InspirationCase } from '../../domain/inspiration/cases'
import styles from './InspirationPage.module.css'

/**
 * 案例详情灯箱。
 *
 * **抄素材页那套**（用户 2026-10-14：「我的灵感库有什么可以抄我的素材页的」）：
 * 左边大图、右边详情、Esc 或点空白关闭。差别只有一处 —— 灵感案例是**外部只读内容**，
 * 所以这里给的是「复制提示词」「下载原图」和「看原图出处」，**不打标签**
 * （标签是本地素材才有的关系，外部内容不往本地库里写）。
 *
 * 下载走平台已有的 `files.saveFromUrl`（素材页 / 画布灯箱同一条入口）：
 * 能取到字节就落盘，取不到就交给浏览器新标签打开 —— 这里不重写第二套回落逻辑。
 */
export function downloadNameOf(item: InspirationCase): string {
  try {
    const url = new URL(item.videoUrl || item.imageUrl)
    const base = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
    if (base) return base
  } catch {
    /* 不是绝对地址就走标题兜底 */
  }
  const safe = item.title.replace(/[\\/:*?"<>|]/g, '_').trim()
  return `${safe || 'inspiration'}.jpg`
}

export function InspirationDetail({
  item,
  onClose,
}: {
  item: InspirationCase
  onClose: () => void
}) {
  const platform = usePlatform()
  const [copied, setCopied] = useState(false)
  const [downloadState, setDownloadState] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const downloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      if (downloadTimer.current) clearTimeout(downloadTimer.current)
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

  const download = () => {
    if (!item.videoUrl && !item.imageUrl) return
    void platform.files
      .saveFromUrl(item.videoUrl || item.imageUrl, downloadNameOf(item))
      .then((result) => {
        setDownloadState(result === 'saved' ? '已下载' : '已在新标签打开')
        if (downloadTimer.current) clearTimeout(downloadTimer.current)
        downloadTimer.current = setTimeout(() => setDownloadState(''), 1800)
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
          {item.videoUrl ? (
            <video
              className={styles.detailVideo}
              src={item.videoUrl}
              poster={item.imageUrl || undefined}
              controls
              autoPlay
              loop
              playsInline
              data-inspiration-detail-video
            />
          ) : item.imageUrl ? (
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
            {item.modelCategory ? ` · ${item.modelCategory}` : ''}
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
            {(item.videoUrl || item.imageUrl) && (
              <button
                type="button"
                className={styles.copy}
                data-inspiration-detail-download
                onClick={download}
              >
                {downloadState || '下载原图'}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
