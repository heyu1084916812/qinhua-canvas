import { useEffect, useRef, useState } from 'react'
import {
  MAX_TAGS,
  MAX_TAG_LEN,
  MISSING,
  addTags,
  assetKindOf,
  displayMeta,
  formatAssetSize,
  removeTag,
} from '../../domain/shared/assetLibrary'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { toLogicalName } from '../../domain/project/modelCatalog'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import {
  PALETTE_UNAVAILABLE,
  extractPaletteFromUrl,
  paletteTextFor,
} from '../../domain/shared/colorPalette'
import { useAssetMeta } from '../../features/shared/assets/index'
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
  onTagsChange,
  canSendToCanvas = false,
  onSendToCanvas,
  onPrevious,
  onNext,
  positionLabel,
}: {
  asset: LibraryAsset
  onClose: () => void
  onDownload: () => void
  onTagsChange?: (tags: string[]) => void
  canSendToCanvas?: boolean
  onSendToCanvas?: () => void
  onPrevious?: () => void
  onNext?: () => void
  positionLabel?: string
}) {
  const { url, mime } = useAssetMeta(asset.hash)
  const channelStore = useChannels()
  const channels = channelStore.getState().channels
  const kind = assetKindOf(mime ?? asset.mime)
  const isVideo = kind === 'video'
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [colors, setColors] = useState<string[]>([])
  /** 标签输入框的草稿与那句"为什么没加上"（对账 #303） */
  const [tagDraft, setTagDraft] = useState('')
  const [tagHint, setTagHint] = useState('')
  const tags = asset.tags ?? []

  /** `；` / `;` 分隔一次可加多个；已有 / 超限仍然如实提示。 */
  const commitTag = () => {
    const result = addTags(tags, tagDraft)
    if (!result.ok) {
      setTagHint(
        result.reason === 'empty'
          ? '先输入标签再回车'
          : result.reason === 'duplicate'
            ? '这个标签已经有了'
            : `最多 ${MAX_TAGS} 个标签`,
      )
      return
    }
    setTagHint('')
    setTagDraft('')
    onTagsChange?.(result.tags)
  }

  /**
   * 复制反馈（用户 2026-10-06 第 8 条）：色值点击即复制、提示词点击即复制，
   * 提示词框右上角另给一枚复制按钮。
   *
   * 反馈用**同一个瞬态键**（`copiedKey`）而不是每个色块各存一个布尔：
   * 用户一次只会复制一样东西，多点几次也只是把高亮挪过去；
   * 每个色块各留一个 state 会在关闭灯箱后留下一串没人清理的计时器。
   */
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyText = (text: string, key: string) => {
    if (!text) return
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedKey(key)
        if (copiedTimer.current) clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopiedKey(null), 1200)
      })
      .catch(() => setCopiedKey(null))
  }
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      const target = event.target as HTMLElement | null
      const inEditable =
        target?.closest('input, textarea, select, [contenteditable="true"]') != null
      const inVideo = target?.closest('video') != null
      if (!inEditable && !inVideo && event.key === 'ArrowLeft' && onPrevious) {
        event.preventDefault()
        onPrevious()
        return
      }
      if (!inEditable && !inVideo && event.key === 'ArrowRight' && onNext) {
        event.preventDefault()
        onNext()
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
  }, [asset.hash, onClose, onNext, onPrevious])

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
  const modelLabel = asset.model ? toLogicalName(channels, asset.model) : ''
  const channel = asset.channelId
    ? channels.find((item) => item.id === asset.channelId)
    : undefined
  const channelLabel = channel?.name ?? asset.channelId
  const capturedAt = formatDateTime(asset.savedAt)

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
          <button
            type="button"
            className={`${styles.previewNav} ${styles.previewNavPrev}`}
            data-asset-preview-prev
            aria-label="上一张素材"
            title="上一张（←）"
            disabled={!onPrevious}
            onClick={onPrevious}
          >
            ‹
          </button>
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
          <button
            type="button"
            className={`${styles.previewNav} ${styles.previewNavNext}`}
            data-asset-preview-next
            aria-label="下一张素材"
            title="下一张（→）"
            disabled={!onNext}
            onClick={onNext}
          >
            ›
          </button>
          {positionLabel ? (
            <span className={styles.previewPosition} data-asset-preview-position>
              {positionLabel}
            </span>
          ) : null}
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

          <div className={styles.previewBody}>
            <section className={styles.detailSection}>
            <h4 className={styles.detailLabel}>配色方案</h4>
            <div className={styles.paletteBoard} data-asset-preview-palette>
              {paletteText === PALETTE_UNAVAILABLE ? (
                <span className={styles.metaMuted}>{paletteText}</span>
              ) : (
                colors.map((color) => (
                  /* 点一下就复制色值（用户 2026-10-06 第 8 条：「颜色色值需要能点击复制」） */
                  <button
                    key={color}
                    type="button"
                    className={styles.swatchItem}
                    data-asset-copy-color={color}
                    title={`点击复制 ${color}`}
                    aria-label={`复制色值 ${color}`}
                    onClick={() => copyText(color, `color:${color}`)}
                  >
                    {/*
                      ⚠️ 反馈**不占排版**（用户 2026-10-06 第 10 条，对账 #290）：
                      原来把色值文字换成"已复制"，宽度一变就把后面的色块挤动。
                      现在文字**始终是色值**，反馈改成"色块上浮一枚对勾"——
                      那枚对勾是绝对定位的（不参与排版），所以整行纹丝不动。
                    */}
                    <span className={styles.swatchWrap}>
                      <span
                        className={styles.swatch}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                      {copiedKey === `color:${color}` && (
                        <span
                          className={styles.swatchCheck}
                          data-asset-color-copied={color}
                          aria-hidden="true"
                        >
                          <IconCheck />
                        </span>
                      )}
                    </span>
                    <span className={styles.swatchText}>{color}</span>
                  </button>
                ))
              )}
            </div>
            </section>

            <section className={styles.detailSection}>
            <h4 className={styles.detailLabel}>原提示词</h4>
            {/*
              提示词**整块可点即复制**，右上角另给一枚按钮（用户原话：「提示词也是一样能点击复制
              + 提示词框右上角有一个复制按钮」）—— 点整块是老手的手感，按钮是新手的路标，两者都要。
            */}
            <div className={styles.promptWrap}>
              <button
                type="button"
                className={styles.copyBtn}
                data-asset-copy-prompt-btn
                onClick={() => copyText(asset.prompt ?? '', 'prompt')}
                disabled={!asset.prompt}
                aria-label="复制提示词"
                title="复制提示词"
              >
                {copiedKey === 'prompt' ? '已复制' : '复制'}
              </button>
              <div
                className={
                  copiedKey === 'prompt'
                    ? `${styles.promptBlock} ${styles.promptBlockCopied}`
                    : styles.promptBlock
                }
                data-asset-preview-prompt
                data-asset-copy-prompt
                role="button"
                tabIndex={0}
                title={asset.prompt ? '点击复制提示词' : undefined}
                onClick={() => copyText(asset.prompt ?? '', 'prompt')}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  copyText(asset.prompt ?? '', 'prompt')
                }}
              >
                {/*
                  正文**始终是提示词本身**（对账 #290）：原来复制后整块变成"已复制到剪贴板"，
                  高度一缩、整页往上跳。反馈挪到「右上角那枚按钮」+ 这一圈描边高亮上。
                */}
                {displayMeta(asset.prompt)}
              </div>
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
                <dd data-asset-preview-model>
                  {displayMeta(modelLabel || asset.model)}
                  {modelLabel && modelLabel !== asset.model ? (
                    <span className={styles.metaRaw}>上游 ID：{asset.model}</span>
                  ) : null}
                </dd>
              </div>
              <div className={`${styles.metaItem} ${styles.metaItemWide}`}>
                <dt>渠道</dt>
                <dd data-asset-preview-channel>
                  {displayMeta(channelLabel)}
                  {channel && asset.channelId ? (
                    <span className={styles.metaRaw}>ID：{asset.channelId}</span>
                  ) : null}
                </dd>
              </div>
              <div className={`${styles.metaItem} ${styles.metaItemWide}`}>
                <dt>时间</dt>
                <dd data-asset-preview-time>{capturedAt || MISSING}</dd>
              </div>
            </dl>

            {/*
              标签（对账 #303）：只有**收藏过**的素材能打 —— 标签是"我的整理"，
              挂在收藏关系（`assetLibrary` 行）上。没收藏时如实指出去收藏，不摆一个存不下去的输入框。
            */}
            <div className={styles.tagBlock} data-asset-tags>
              <div className={styles.tagHead}>
                <span className={styles.tagLabel}>标签</span>
              </div>
              <div className={styles.tagRow}>
                {tags.length === 0 ? (
                  <span className={styles.metaMuted}>还没有标签</span>
                ) : null}
                {tags.map((tag) => (
                  <span key={tag} className={styles.tagChip} data-asset-tag={tag}>
                    {tag}
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label={`删除标签 ${tag}`}
                      data-asset-tag-remove={tag}
                      onClick={() => onTagsChange?.(removeTag(tags, tag))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <form
                className={styles.tagForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  commitTag()
                }}
              >
                <input
                  className={styles.tagInput}
                  value={tagDraft}
                  maxLength={MAX_TAG_LEN * 6}
                  placeholder="输入标签，多个用；分开，回车确认"
                  aria-label="新标签"
                  data-asset-tag-input
                  onChange={(event) => {
                    setTagDraft(event.target.value)
                    if (tagHint) setTagHint('')
                  }}
                />
              </form>
              {tagHint ? (
                <p className={styles.tagHint} data-asset-tag-hint>
                  {tagHint}
                </p>
              ) : null}
            </div>
          </div>

          <div className={styles.previewActions}>
            <span className={styles.previewSpacer} />
            <button
              type="button"
              className={styles.ghost}
              data-asset-preview-send
              disabled={!canSendToCanvas}
              title={canSendToCanvas ? '发送到当前画布' : '先打开一个画布'}
              onClick={onSendToCanvas}
            >
              发送到画布
            </button>
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

/**
 * 复制成功的对勾（对账 #290）。
 *
 * 单独画一枚矢量图，而不是用 `✓` 字形：字形在不同字体下的基线 / 宽度都不一样，
 * 而它要**居中压在一个 28px 的色块上** —— 那是几何要求，字形给不了确定的中心
 * （同 §3.3「图标一律用矢量图」那条口径）。
 */
function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 8.3 3.1 3.1L13 4.7" />
    </svg>
  )
}

function formatDateTime(at: number): string {
  if (!at) return ''
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
