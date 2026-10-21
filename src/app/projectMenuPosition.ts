export interface ProjectMenuFrame {
  left: number
  top: number
  maxHeight: number
}

export interface ProjectMenuViewport {
  width: number
  height: number
}

/**
 * 项目菜单按真实内容高度找位置。
 *
 * 旧实现把高度写死成 500px，实际只有一两百像素也会被错误翻到上方。这里先量
 * `scrollHeight`，再比较上下可用空间：能放下就优先向下，放不下才选空间更大的一侧，
 * 并把可用高度写回 `maxHeight`，让菜单内部滚动。
 */
export function projectMenuPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  contentHeight: number,
  viewport: ProjectMenuViewport,
): ProjectMenuFrame {
  const width = 216
  const padding = 8
  const gap = 4
  const left = Math.min(
    Math.max(padding, anchor.right - width),
    Math.max(padding, viewport.width - width - padding),
  )
  const belowTop = anchor.bottom + gap
  const aboveBottom = anchor.top - gap
  const belowSpace = Math.max(0, viewport.height - padding - belowTop)
  const aboveSpace = Math.max(0, aboveBottom - padding)
  const desired = Math.max(0, contentHeight)
  /*
   * 向下是默认方向。只有下方连一个紧凑菜单都放不下、或上方明显更宽裕时才上翻；
   * 不因为内容比剩余空间多几十像素就把整张菜单甩到顶部。
   */
  const compactMenuFits = belowSpace >= Math.min(desired, 120)
  const placeBelow = desired <= belowSpace || compactMenuFits
  const available = placeBelow ? belowSpace : aboveSpace
  const maxHeight = Math.max(1, Math.min(desired || available, available))
  const top = placeBelow
    ? belowTop
    : Math.max(padding, aboveBottom - maxHeight)

  return { left, top, maxHeight }
}
