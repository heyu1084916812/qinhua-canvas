import { useEffect, useRef } from 'react'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'
import { formatAssetSize, formatBytes, masonryAspectOf } from '../../domain/shared/assetLibrary'
import { formatRelative } from '../../domain/shared/time'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import styles from './AssetsPage.module.css'

/**
 * 素材库里的一张卡片（产品文档 §2.1 #6）。
 *
 * 三块信息，按视觉权重从上到下：图 → 来源项目 → 尺寸 / 体积 / 时间。
 * 名称排第二而不是第一，因为素材**没有名字**——它只有「哪个项目的、多大的、
 * 什么时候的」。硬造一个名字（如 hash 前八位）对用户毫无意义。
 *
 * **瀑布流排版（用户 2026-09-29）**：卡片高度随素材自己的比例走，
 * 横图矮、竖图高，列与列之间自然错落。封面用 `object-fit: cover`：
 * 比例已经被夹在 2:1 ~ 1:2 之间，裁掉的那点边缘不影响辨认，
 * 而 `contain` 留出的白边会让瀑布流看着散。
 */
export function AssetCard({
  asset,
  projectName,
  onOpen,
  confirming,
  menuOpen,
  onToggleMenu,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onDownload,
}: {
  asset: LibraryAsset
  projectName: string
  onOpen: () => void
  confirming: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onDownload: () => void
}) {
  const { url, mime } = useAssetMeta(asset.hash)
  const isVideo = (mime ?? asset.mime).startsWith('video/')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  /**
   * 视频封面：`<video preload="metadata">` 在部分浏览器里不会自动画第 0 帧，
   * 卡片就成了一个黑方块 —— 与「素材没加载出来」长得一模一样。
   * 元数据到位后把时间轴推到一个极小值强制出一帧（不是播放它）。
   */
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const paint = () => {
      if (v.currentTime === 0 && v.duration > 0) v.currentTime = 0.01
    }
    v.addEventListener('loadedmetadata', paint)
    return () => v.removeEventListener('loadedmetadata', paint)
  }, [asset.hash])

  const size = formatAssetSize(asset)
  const time = asset.createdAt > 0 ? formatRelative(asset.createdAt) : '时间未知'
  /** 卡片高度比例由素材真实比例决定（瀑布流的关键） */
  const aspect = masonryAspectOf(asset)

  return (
    <div className={styles.card} data-asset-card={asset.hash}>
      <button
        type="button"
        className={styles.cardMain}
        data-asset-open={asset.hash}
        onClick={onOpen}
        aria-label={`查看素材，来自 ${projectName}，${time}`}
      >
        <span
          className={styles.thumb}
          data-asset-thumb
          data-asset-aspect={aspect.toFixed(3)}
          style={{ aspectRatio: `${aspect}` }}
        >
          {isVideo ? (
            <video
              ref={videoRef}
              className={styles.media}
              data-asset-media
              src={url ?? undefined}
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img className={styles.media} data-asset-media src={url ?? ''} alt="" draggable={false} />
          )}
          {isVideo && (
            <span className={styles.kindBadge} data-asset-kind="video" aria-hidden>
              视频
            </span>
          )}
        </span>
        <span className={styles.cardBody}>
          <span className={styles.cardName} data-asset-source>
            {projectName}
          </span>
          <span className={styles.cardMeta} data-asset-meta>
            {[size ?? '尺寸未知', formatBytes(asset.bytes), time].join(' · ')}
          </span>
        </span>
      </button>

      {/*
        操作按钮：默认隐在卡内，hover / 聚焦时出现（与项目卡片同一口径）。

        菜单**向上展开**：封面容器为了裁切用了 `overflow: hidden`，
        向下展开会被卡片自己裁掉 —— 按钮能点、菜单看不见，
        正是本项目反复踩到的静默失败。
      */}
      <div className={styles.cardActions}>
        {confirming ? (
          <div className={styles.confirm}>
            <span className={styles.confirmText}>删除？</span>
            <button
              type="button"
              className={styles.confirmYes}
              data-asset-delete-yes
              onClick={onConfirmDelete}
            >
              确认
            </button>
            <button
              type="button"
              className={styles.confirmNo}
              data-asset-delete-no
              onClick={onCancelDelete}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.menuBtn}
            data-asset-menu={asset.hash}
            aria-label="素材操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="更多"
            onClick={onToggleMenu}
          >
            ⋯
          </button>
        )}

        {menuOpen && !confirming && (
          <div className={styles.menu} role="menu">
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              data-asset-download={asset.hash}
              onClick={(e) => {
                e.stopPropagation()
                onDownload()
              }}
            >
              下载
            </button>
            <button
              type="button"
              className={`${styles.menuItem} ${styles.menuDanger}`}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onRequestDelete()
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
