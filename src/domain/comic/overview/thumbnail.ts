/**
 * 一话总览的**缩略视图模型**（M6-9，纯函数）。
 *
 * M6-6 时总览缩略**刻意「纯几何」**（只画格子方框、不渲染生成底图），理由是
 * ① 与编辑器同源、② 几十页也不触发素材读回。这条取舍在 M6-9 被**部分推翻**：
 * 不显示底图的总览在产品上不成立——用户切到总览最想一眼看出的是
 * 「哪几页画完了、画成什么样了」，而不只是「分了几页、怎么切的」。
 * 于是这里把「缩略要显示什么」收敛成一个可单测的视图模型：
 *
 *   - **几何**仍走 `layoutRects`（与编辑器、阅读器、导出同一口径，不产生第二套版式认知）；
 *   - **底图**只给出 `assetHash`（**没有就是不显示**——未生成的格跳过，不占位、不读回）；
 *   - **顺序**按**阅读顺序**输出（`readingOrderOf`），于是 DOM 顺序 = 阅读顺序：
 *     ① 无障碍上朗读器按阅读序走；② `rtl` 下 DOM 顺序自然镜像，无需 UI 层再排序。
 *
 * **仍不渲染对白贴纸**：缩略只有百来像素宽，贴纸文字缩到不可读，反而是噪声；
 * 对白是格内的精细层，属于编辑态与阅读态，不属于「一眼看全」的总览。
 *
 * 纯函数、无 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

import type { ComicPage, ReadingDirection } from '../model/comicProject'
import { DEFAULT_READING_DIRECTION } from '../model/comicProject'
import { layoutRects } from '../layout/layoutEdit'
import { readingOrderOf } from '../layout/readingOrder'

/**
 * 页码文案**不在此定义**——M6-11 起收口到 `../model/pageNumber`，
 * 缩略角标与导出页脚共用同一份，杜绝「总览看到的页码」与「导出图上写的页码」不一致。
 * 这里 re-export 是为了既有调用点（`EpisodeOverview`）与既有单测不受影响。
 */
export { pageBadgeText } from '../model/pageNumber'

/** 缩略里的一个格 */
export interface ThumbCell {
  panelId: string
  /** 0..1 相对几何（与版式编辑器同一口径） */
  x: number
  y: number
  w: number
  h: number
  /** 阅读序号（1 起，随阅读方向变化；决定 DOM 输出顺序） */
  order: number
  /** 生成画面素材哈希；**缺席 = 该格尚未生成**（不渲染底图、不读回素材） */
  assetHash?: string
}

/**
 * 一页的缩略视图模型；**按阅读顺序**返回。
 *
 * 未排版（空 `layout` / 无叶子）返回空数组——调用方据此显示「未排版」占位，
 * 与模型口径一致（空 `layout` = 尚未排版，而不是「满页单格」）。
 */
export function overviewCells(
  page: ComicPage,
  direction: ReadingDirection = DEFAULT_READING_DIRECTION,
): ThumbCell[] {
  const rects = layoutRects(page.layout)
  if (rects.length === 0) return []

  const order = new Map<string, number>()
  readingOrderOf(page, direction).forEach((id, i) => order.set(id, i + 1))

  const hashById = new Map<string, string | undefined>()
  for (const p of page.panels) hashById.set(p.id, p.assetHash)

  const cells: ThumbCell[] = rects.map((r) => {
    const hash = hashById.get(r.panelId)
    const cell: ThumbCell = {
      panelId: r.panelId,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      order: order.get(r.panelId) ?? 0,
    }
    if (hash) cell.assetHash = hash
    return cell
  })
  cells.sort((a, b) => a.order - b.order)
  return cells
}

/** 该页缩略是否有底图可显示（至少一格已生成） */
export function hasThumbArt(cells: readonly ThumbCell[]): boolean {
  return cells.some((c) => c.assetHash !== undefined)
}
