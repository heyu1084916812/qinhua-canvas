import { useEffect, useRef, useState } from 'react'
import {
  MISSING,
  assetKindOf,
  displayMeta,
  formatAssetSize,
} from '../../domain/shared/assetLibrary'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import {
  PALETTE_UNAVAILABLE,
  extractPaletteFromUrl,
  paletteTextFor,
} from '../../domain/shared/colorPalette'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'
import styles from './AssetsPage.module.css'

/**
 * 素材详情灯箱。
 *
 * 左侧展示完整媒体，右侧展示保存时冻结的生成信息。配色从图片像素现取，
 * 只作为当前画面的视觉摘要；视频没有统一的像素取色入口，明确显示“暂不可用”。
 */
export function AssetPreview({
  asset,
  onClose,
  onDownload,
  onRemove,
}: {
  asset: LibraryAsset
  onClose: () => void
  onDownload: () => void
  onRemove: () => void
}) {
  const { url, mime } = useAssetMeta(asset.hash)
  const kind = assetKindOf(mime ?? asset.mime)
  const isVideo = kind === 'video'
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [colors, setColors] = useState<string[]>([])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], video[controls], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, asset.hash])

  useEffect(() => {
    if (isVideo || !url) {
      setColors([])
      return
    }
    let alive = true
    void extractPaletteFromUrl(url).then((next) => {
      if (alive) setColors(next)
    })
    return () => {
      alive = false
    }
  }, [isVideo, url, asset.hash])

  const paletteText = paletteTextFor(kind, colors)
  const sizeText = formatAssetSize(asset) ?? MISSING

  return (
    <div
      className={styles.overlay}
      data-asset-preview
      data-asset-preview-hash={asset.hash}
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-preview-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={styles.previewPanel}
        data-asset-preview-panel
        onClick={(event) => event.stopPropagation()}
      >
        <section className={styles.previewStage} data-asset-preview-stage>
          {isVideo ? (
            <video
              className={styles.previewMedia}
              data-asset-preview-media
              src={url ?? undefined}
              controls
              loop
              playsInline
              autoPlay
            />
          ) : (
            <img
              className={styles.previewMedia}
              data-asset-preview-media
              src={url ?? undefined}
              alt=""
              draggable={false}
            />
          )}
        </section>

        <aside className={styles.previewDetails} data-asset-preview-details>
          <div className={styles.previewHeader}>
            <div className={styles.previewHeading}>
              <h3 id="asset-preview-title" className={styles.previewTitle}>
                素材详情
              </h3>
              <p className={styles.previewSubtitle}>
                {isVideo ? '视频素材' : '图片素材'} · {sizeText}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              className={styles.iconButton}
              data-asset-preview-close
              aria-label="关闭"
              title="关闭"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          <section className={styles.detailSection}>
            <h4 className={styles.detailLabel}>配色方案</h4>
            <div className={styles.paletteBoard} data-asset-preview-palette>
              {paletteText === PALETTE_UNAVAILABLE ? (
                <span className={styles.metaMuted}>{paletteText}</span>
              ) : (
                colors.map((color) => (
                  <span key={color} className={styles.swatchItem}>
                    <span
                      className={styles.swatch}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                    <span className={styles.swatchText}>{color}</span>
                  </span>
                ))
              )}
            </div>
          </section>

          <section className={styles.detailSection}>
            <h4 className={styles.detailLabel}>原提示词</h4>
            <div className={styles.promptBlock} data-asset-preview-prompt>
                {displayMeta(asset.prompt)}
            </div>
          </section>

          <dl className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <dt>像素</dt>
              <dd data-asset-preview-size>{sizeText}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>比例</dt>
              <dd data-asset-preview-ratio>{displayMeta(asset.ratio)}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>画质</dt>
              <dd data-asset-preview-quality>{displayMeta(asset.quality)}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>模型</dt>
              <dd data-asset-preview-model>{displayMeta(asset.model)}</dd>
            </div>
            <div className={`${styles.metaItem} ${styles.metaItemWide}`}>
              <dt>渠道</dt>
              <dd data-asset-preview-channel>{displayMeta(asset.channelId)}</dd>
            </div>
          </dl>

          <div className={styles.previewActions}>
            <button
              type="button"
              className={styles.dangerGhost}
              data-asset-preview-remove
              onClick={onRemove}
            >
              取消收藏
            </button>
            <span className={styles.previewSpacer} />
            <button
              type="button"
              className={styles.ghost}
              data-asset-preview-download
              onClick={onDownload}
            >
              下载
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
