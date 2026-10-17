import { useEffect, useRef } from 'react'
import {
  assetKindOf,
  formatAssetSize,
  masonryAspectOf,
} from '../../domain/shared/assetLibrary'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import type { AssetsView } from '../../state/project/assetLibraryStore'
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
  layout = 'masonry',
  modelLabel,
  channelLabel,
  saved = true,
  selected,
  onSelect,
  onOpen,
  confirming,
  menuOpen,
  onToggleMenu,
  onSave,
  onToggleFavorite,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
  onDownload,
}: {
  asset: LibraryAsset
  layout?: AssetsView
  modelLabel?: string
  channelLabel?: string
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
  onToggleFavorite?: () => void
  onRequestRemove: () => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
  onDownload: () => void
}) {
  const { url, mime } = useAssetMeta(asset.hash, { preferThumb: true })
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
  const className = [
    styles.card,
    layout === 'list' ? styles.cardList : '',
    selected ? styles.cardSelected : '',
  ]
    .filter(Boolean)
    .join(' ')
  const kind = assetKindOf(mime ?? asset.mime)
  const size = formatAssetSize(asset) ?? '—'
  const tags = asset.tags ?? []

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
          style={layout === 'masonry' ? { aspectRatio: `${aspect}` } : undefined}
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

      {layout === 'list' && (
        <div className={styles.listInfo} data-asset-list-info>
          <p className={styles.listPrompt}>{asset.prompt?.trim() || '没有提示词'}</p>
          <dl className={styles.listMeta}>
            <div>
              <dt>模型</dt>
              <dd>{modelLabel || asset.model || '—'}</dd>
            </div>
            <div>
              <dt>比例</dt>
              <dd>{asset.ratio || '—'}</dd>
            </div>
            <div>
              <dt>分类</dt>
              <dd>{kind === 'video' ? '视频' : kind === 'image' ? '图片' : '其他'}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{formatDateTime(asset.savedAt)}</dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>{size}</dd>
            </div>
          </dl>
          {channelLabel ? <p className={styles.listChannel}>渠道：{channelLabel}</p> : null}
          {tags.length > 0 && (
            <p className={styles.listTags}>
              {tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className={saved ? `${styles.favorite} ${styles.favoriteOn}` : styles.favorite}
        data-asset-favorite={asset.hash}
        aria-label={saved ? '取消收藏' : '收藏到素材库'}
        aria-pressed={saved}
        title={saved ? '取消收藏' : '收藏到素材库'}
        onClick={(event) => {
          event.stopPropagation()
          onToggleFavorite?.()
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={saved ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20.5 3.8 12.3a5 5 0 0 1 7.1-7.1l1.1 1.1 1.1-1.1a5 5 0 0 1 7.1 7.1Z" />
        </svg>
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

function formatDateTime(at: number): string {
  if (!at) return '—'
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
