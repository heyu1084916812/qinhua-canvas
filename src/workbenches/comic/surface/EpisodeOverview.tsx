import type { ComicEpisode, ReadingDirection } from '../../../domain/comic/model/comicProject'
import { DEFAULT_READING_DIRECTION } from '../../../domain/comic/model/comicProject'
import { hasThumbArt, overviewCells, pageBadgeText } from '../../../domain/comic/overview/thumbnail'
import { useAsset } from '../hooks/useAsset'
import styles from './EpisodeOverview.module.css'

/**
 * 一话总览（M6-6）：把本话**所有页**铺成缩略网格，一眼看全、点选进入该页编辑。
 *
 * **M6-9 起缩略不再是「纯几何」**：每格在方框内叠生成底图，右下角带**页码角标**。
 * 翻掉 M6-6 那条「不渲染底图」取舍的理由写在 `domain/comic/overview/thumbnail.ts` 文件头——
 * 简言之：切到总览最想一眼看出的是「哪几页画完了、画成什么样」，而不只是「怎么切的」。
 * **仍未翻掉的**：对白贴纸不渲染（缩略只有百来像素宽，贴纸文字缩到不可读，是噪声）。
 *
 * 三条与既有口径一致的地方：
 *   1. 几何仍走 `layoutRects`（与编辑器 / 阅读器 / 导出同源，不产生第二套版式认知）；
 *   2. 页序 = **叙事序**（`episode.pages` 数组顺序），**不随阅读方向翻转**——
 *      方向只管「格内顺序」（DOM 输出顺序随之镜像）与「翻页手感」（见 `readerNav` 文件头）；
 *   3. 未排版的页显示占位，而不是「满页单格」（空 `layout` = 尚未排版）。
 *
 * **代价（如实记账）**：显示底图就要读素材，于是每格挂一次 `useAsset`——
 * 几十页时查询次数等于「已生成的格数」。之所以接受：只有**真的生成过**（有 `assetHash`）
 * 的格才会发起查询，未生成的格连查都不查；且 `useAsset` 内部退避重试只发生在
 * 「有 hash 但素材还没落库」的窗口里。
 */
interface EpisodeOverviewProps {
  episode: ComicEpisode
  /** 阅读方向（项目级）：只影响缩略**格**的 DOM 顺序，不影响页序（见文件头） */
  direction?: ReadingDirection
  selectedPageId: string | null
  onSelectPage: (pageId: string) => void
}

export function EpisodeOverview({
  episode,
  direction = DEFAULT_READING_DIRECTION,
  selectedPageId,
  onSelectPage,
}: EpisodeOverviewProps) {
  if (episode.pages.length === 0) {
    return (
      <p className={styles.empty} data-comic-overview-empty>
        本话还没有页。点「＋ 页」添加后，这里会列出所有页的版式缩略。
      </p>
    )
  }

  return (
    <div className={styles.grid} data-comic-overview data-comic-overview-count={episode.pages.length}>
      {episode.pages.map((pg, i) => {
        const cells = overviewCells(pg, direction)
        const selected = pg.id === selectedPageId
        const stateHint = cells.length === 0 ? '（未排版）' : hasThumbArt(cells) ? '' : '（尚未生成）'
        return (
          <button
            key={pg.id}
            type="button"
            className={selected ? `${styles.card} ${styles.cardActive}` : styles.card}
            data-comic-overview-page
            data-comic-overview-page-id={pg.id}
            data-comic-overview-page-index={i + 1}
            aria-pressed={selected}
            aria-label={`第 ${i + 1} 页`}
            title={`第 ${i + 1} 页${stateHint}`}
            onClick={() => onSelectPage(pg.id)}
          >
            <PageThumb cells={cells} pageNumber={pageBadgeText(i)} />
          </button>
        )
      })}
    </div>
  )
}

/**
 * 页缩略：按 `overviewCells` 给的视图模型画格子方框 + 底图，右下角叠页码角标。
 * 未排版的页显示占位（角标照旧——页码与是否排版无关）。
 */
function PageThumb({
  cells,
  pageNumber,
}: {
  cells: ReturnType<typeof overviewCells>
  pageNumber: string
}) {
  return (
    <span className={styles.thumbFrame} data-comic-thumb-frame>
      {cells.length === 0 ? (
        <span className={styles.thumbEmpty} data-comic-thumb-empty>
          未排版
        </span>
      ) : (
        <span
          className={styles.thumbPage}
          data-comic-page-thumb
          data-comic-thumb-panel-count={cells.length}
        >
          {cells.map((c) => (
            <span
              key={c.panelId}
              className={styles.thumbCell}
              data-comic-thumb-cell
              data-comic-thumb-cell-panel={c.panelId}
              style={{
                left: `calc(${c.x * 100}% + 1px)`,
                top: `calc(${c.y * 100}% + 1px)`,
                width: `calc(${c.w * 100}% - 2px)`,
                height: `calc(${c.h * 100}% - 2px)`,
              }}
            >
              <ThumbArt hash={c.assetHash} />
            </span>
          ))}
        </span>
      )}
      <span className={styles.badge} data-comic-thumb-badge>
        {pageNumber}
      </span>
    </span>
  )
}

/**
 * 格内生成画面（缩略版）：与版式编辑器的 `PanelArt` 同一条读回路径（`useAsset`），
 * 只是尺寸小、用 `object-fit: cover` 填满格子（缩略不需要保留原始比例）。
 */
function ThumbArt({ hash }: { hash: string | undefined }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img className={styles.thumbArt} src={url} alt="" data-comic-thumb-art />
}
