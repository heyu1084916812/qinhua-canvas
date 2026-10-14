/**
 * 最短列堆砌（瀑布流）的纯布局算法（对账 #502）。
 *
 * 背景：素材页原来用 CSS `columns: 240px`。多列布局是**按列填**的，
 * 卡片又都 `break-inside: avoid` —— 一张卡放不进当前列时就整张挪到下一列，
 * 于是同一组里会出现「左边三列提前结束、右边一列还有卡」的大块空洞
 * （用户 2026-10-14 第 4 条，实测最矮列比最高列少 1795px）。
 *
 * 这里改成**按最短列放**：每张卡放进当前累计高度最小的那一列。
 * 列底差距被压到「最多一张卡的高度」以内，不再出现整段空洞。
 *
 * 纯函数：不碰 DOM、不做测量 —— 测量与 `ResizeObserver` 在 `MasonryGrid` 里，
 * 这里只负责「给定每张卡的高度，算出每张卡放哪」。
 */

export interface MasonryOptions {
  /** 单列最小宽度（与旧 `columns: 240px` 同一口径） */
  minColumnWidth: number
  /** 列间距 / 行间距（与旧 `column-gap: var(--space-5)` 同一口径） */
  gap: number
}

export interface MasonryLayout {
  /** 实际列数（容器太窄时至少 1 列） */
  columns: number
  /** 每列实际宽度（按容器宽均分，保留小数） */
  columnWidth: number
  /** 与传入 `heights` 同序的位移 */
  offsets: { x: number; y: number }[]
  /** 容器总高度（已扣掉最后一行的间距） */
  containerHeight: number
}

/**
 * 给定每张卡的高度与容器宽度，算出最短列堆砌的坐标。
 *
 * 平局时放**最左**那一列（`<` 而不是 `<=`）：这样同一批数据的布局是确定的，
 * 冒烟与单测都能复现，不会因为遍历顺序不同而漂移。
 */
export function layoutMasonry(
  heights: readonly number[],
  containerWidth: number,
  { minColumnWidth, gap }: MasonryOptions,
): MasonryLayout {
  const width = Math.max(0, containerWidth)
  const columns = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)))
  const columnWidth = columns === 1 ? width : (width - gap * (columns - 1)) / columns

  const columnHeights = new Array<number>(columns).fill(0)
  const offsets = heights.map((rawHeight) => {
    let target = 0
    for (let i = 1; i < columns; i += 1) {
      if (columnHeights[i]! < columnHeights[target]!) target = i
    }
    const x = target * (columnWidth + gap)
    const y = columnHeights[target]!
    columnHeights[target] = y + Math.max(0, rawHeight) + gap
    return { x, y }
  })

  const tallest = Math.max(0, ...columnHeights)
  const containerHeight = heights.length === 0 ? 0 : Math.max(0, tallest - gap)
  return { columns, columnWidth, offsets, containerHeight }
}
