import { useEffect, useRef } from 'react'
import { masonryAspectOf } from '../../domain/shared/assetLibrary'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'
import styles from './AssetsPage.module.css'

/**
 * 素材库卡片。
 *
 * 卡片只承担两件事：把完整素材摆出来，以及接收选中 / 双击。
 * 项目、时间、体积等溯源信息全部移入双击后的灯箱，避免封面下方再出现一层
 * 与图片争夺注意力的文字。
 *
 * ## `saved` / `onSave`（对账 #264）
 *
 * 「全部生成历史」里绝大多数卡片**还没收藏**，那时菜单里该出现的是「收藏素材库」而不是
 * 「取消收藏」—— 同一个动作在不同状态下语义相反，菜单必须跟着状态走（否则用户点了
 * "取消收藏"，实际做的是收藏）。所以这两个 prop 由宿主按 `item.saved` 传进来。
 */
export function AssetCard({
  asset,
  saved = true,
  selected,
  onSelect,
  onOpen,
  confirming,
  menuOpen,
  onToggleMenu,
  onSave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
  onDownload,
}: {
  asset: LibraryAsset
  /** 这张收藏了没有（默认 true：素材库里的卡片当然都收藏过） */
  saved?: boolean
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  confirming: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  /** 「收藏素材库」——只有 `saved === false` 时才会被点到 */
  onSave?: () => void
  onRequestRemove: () => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
  onDownload: () => void
}) {
  const { url, mime } = useAssetMeta(asset.hash)
  const isVideo = (mime ?? asset.mime).startsWith('video/')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const paint = () => {
      if (video.currentTime === 0 && video.duration > 0) video.currentTime = 0.01
    }
    video.addEventListener('loadedmetadata', paint)
    return () => video.removeEventListener('loadedmetadata', paint)
  }, [asset.hash])

  const aspect = masonryAspectOf(asset)
  const className = selected ? `${styles.card} ${styles.cardSelected}` : styles.card

  return (
    <div
      className={className}
      data-asset-card={asset.hash}
      data-asset-selected={selected ? 'true' : 'false'}
    >
      <button
        type="button"
        className={styles.cardMain}
        data-asset-open={asset.hash}
        onClick={onSelect}
        onDoubleClick={onOpen}
        aria-label="素材，单击选中，双击查看详情"
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
            <img
              className={styles.media}
              data-asset-media
              src={url ?? undefined}
              alt=""
              draggable={false}
            />
          )}
        </span>
      </button>

      <div className={styles.cardActions}>
        {confirming && saved ? (
          <div className={styles.confirm}>
            <span className={styles.confirmText}>取消收藏？</span>
            <button
              type="button"
              className={styles.confirmYes}
              data-asset-delete-yes
              onClick={(event) => {
                event.stopPropagation()
                onConfirmRemove()
              }}
            >
              确认
            </button>
            <button
              type="button"
              className={styles.confirmNo}
              data-asset-delete-no
              onClick={(event) => {
                event.stopPropagation()
                onCancelRemove()
              }}
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
            onClick={(event) => {
              event.stopPropagation()
              onToggleMenu()
            }}
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
              onClick={(event) => {
                event.stopPropagation()
                onDownload()
              }}
            >
              下载
            </button>
            {saved ? (
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuDanger}`}
                role="menuitem"
                data-asset-remove={asset.hash}
                onClick={(event) => {
                  event.stopPropagation()
                  onRequestRemove()
                }}
              >
                取消收藏
              </button>
            ) : (
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                data-asset-save={asset.hash}
                onClick={(event) => {
                  event.stopPropagation()
                  onSave?.()
                }}
              >
                收藏到素材库
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
