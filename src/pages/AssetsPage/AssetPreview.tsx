import { useEffect, useRef } from 'react'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'
import { formatAssetSize, formatBytes } from '../../domain/shared/assetLibrary'
import { formatRelative } from '../../domain/shared/time'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import styles from './AssetsPage.module.css'

/**
 * 素材库的大图预览（浮层）。
 *
 * **刻意复刻画布灯箱那套观感**：居中大面板、四周留白看得见底下的页面、
 * 不能拖动、`Esc` / 点空白关闭。素材库与画布看的是同一个素材，
 * 两处开图的手感若不一致，用户会以为进了另一个应用。
 *
 * **不做缩放 / 平移**：这里是「认出这是不是我要的那张」，不是「检查细节」。
 * 检查细节在画布里双击同一个素材会开真正的灯箱（那套有缩放）。
 * 放两套缩放数学是本项目的明确教训，故这里只做「等比铺满面板」。
 */
export function AssetPreview({
  asset,
  projectName,
  onClose,
  onDownload,
}: {
  asset: LibraryAsset
  projectName: string
  onClose: () => void
  onDownload: () => void
}) {
  const { url, mime } = useAssetMeta(asset.hash)
  const isVideo = (mime ?? asset.mime).startsWith('video/')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, asset.hash])

  const size = formatAssetSize(asset)
  const time = asset.createdAt > 0 ? formatRelative(asset.createdAt) : '时间未知'

  return (
    <div
      className={styles.overlay}
      data-asset-preview
      data-asset-preview-hash={asset.hash}
      role="dialog"
      aria-modal="true"
      aria-label="素材预览"
      onClick={onClose}
    >
      <div className={styles.previewPanel} data-asset-preview-panel onClick={(e) => e.stopPropagation()}>
        <div className={styles.previewStage} data-asset-preview-stage>
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
              src={url ?? ''}
              alt=""
              draggable={false}
            />
          )}
        </div>
        <div className={styles.previewBar}>
          <span className={styles.previewChip} data-asset-preview-size>
            {size ?? '尺寸未知'}
          </span>
          <span className={styles.previewChip}>{formatBytes(asset.bytes)}</span>
          <span className={styles.previewChip} data-asset-preview-source>
            {projectName}
          </span>
          <span className={styles.previewChip}>{time}</span>
          <span className={styles.previewSpacer} />
          <button
            type="button"
            className={styles.ghost}
            data-asset-preview-download
            onClick={onDownload}
          >
            下载
          </button>
          <button
            ref={closeRef}
            type="button"
            className={styles.primary}
            data-asset-preview-close
            onClick={onClose}
          >
            关闭 (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
