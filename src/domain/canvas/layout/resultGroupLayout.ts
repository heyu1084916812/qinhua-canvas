import type { Rect, Size } from '../geometry/rect'
import { RESULT_GROUP_GAP, RESULT_GROUP_OFFSET, RESULT_GROUP_PADDING } from './constants'

export interface ResultGroupLayout {
  containerRect: Rect
  /** 每个结果槽位的世界坐标矩形，从左到右、从上到下 */
  cells: Rect[]
}

function columnsFor(count: number, maxWidth: number, cell: Size): number {
  const fit = (cols: number): boolean =>
    RESULT_GROUP_PADDING * 2 + cols * cell.w + (cols - 1) * RESULT_GROUP_GAP <= maxWidth

  let desired: number
  if (count <= 3) desired = count
  else if (count === 4) desired = 2
  else desired = Math.min(4, count)

  while (desired > 1 && !fit(desired)) desired -= 1
  return Math.max(1, desired)
}

/**
 * 结果组落位（产品文档 §6.9）：整体位于生成节点右侧 32px，组内间距 16、内边距 16。
 * N=1 与生成节点垂直居中对齐；N=2 单行；N=3 单行；N=4 2×2；5–8 每排最多 4；>8 每排 4 自动扩展。
 * maxWidth 传入可用宽度后，空间不足时自动减少每排个数。
 */
export function layoutResultGroup(opts: {
  sourceRect: Rect
  count: number
  cell: Size
  maxWidth?: number
}): ResultGroupLayout {
  const { sourceRect, cell } = opts
  const count = Math.max(1, Math.floor(opts.count))
  const columns = columnsFor(count, opts.maxWidth ?? Infinity, cell)
  const rows = Math.ceil(count / columns)

  const w = RESULT_GROUP_PADDING * 2 + columns * cell.w + (columns - 1) * RESULT_GROUP_GAP
  const h = RESULT_GROUP_PADDING * 2 + rows * cell.h + (rows - 1) * RESULT_GROUP_GAP

  const containerRect: Rect = {
    x: sourceRect.x + sourceRect.w + RESULT_GROUP_OFFSET,
    y: sourceRect.y + sourceRect.h / 2 - h / 2,
    w,
    h,
  }

  const cells = resultGroupCells({ containerRect, count, cell, maxWidth: opts.maxWidth })

  return { containerRect, cells }
}

/**
 * 组内格位：给定**容器矩形**直接算，不再从「来源节点」绕一圈。
 *
 * 结果组层必须走这里：它的容器就是 rg 自己（x/y/w/h 是落库时的容器矩形）。
 * 若把 rg 当 `sourceRect` 再喂给 `layoutResultGroup`，格位会被**二次偏移**
 * （容器里再算一次「容器 = source + 32」），缩略图整片画到框外——
 * 而「数一数 img 有几个」这类断言完全看不出来（G50 第一条断言即为此而写）。
 *
 * `maxWidth` 缺省取容器自身宽度：容器当初就是按这个列数撑开的，故能自洽放下；
 * 万一遇到更窄的旧数据，列数会自动退让而不是溢出框外。
 */
export function resultGroupCells(opts: {
  containerRect: Rect
  count: number
  cell: Size
  maxWidth?: number
}): Rect[] {
  const { containerRect, cell } = opts
  const count = Math.max(1, Math.floor(opts.count))
  const columns = columnsFor(count, opts.maxWidth ?? containerRect.w, cell)

  const cells: Rect[] = []
  for (let i = 0; i < count; i += 1) {
    const col = i % columns
    const row = Math.floor(i / columns)
    cells.push({
      x: containerRect.x + RESULT_GROUP_PADDING + col * (cell.w + RESULT_GROUP_GAP),
      y: containerRect.y + RESULT_GROUP_PADDING + row * (cell.h + RESULT_GROUP_GAP),
      w: cell.w,
      h: cell.h,
    })
  }
  return cells
}

/** 折叠态容器尺寸（产品文档 §6.9「折叠后只显示封面、数量与状态汇总」） */
export const COLLAPSED_SIZE: Size = { w: 160, h: 120 }

/** 折叠后只显示封面与汇总：返回折叠态容器尺寸 */
export function collapsedRect(sourceRect: Rect): Rect {
  return {
    x: sourceRect.x + sourceRect.w + RESULT_GROUP_OFFSET,
    y: sourceRect.y,
    w: COLLAPSED_SIZE.w,
    h: COLLAPSED_SIZE.h,
  }
}

/**
 * 结果组的**呈现矩形**：展开用持久几何（rg 的 x/y/w/h），折叠用 `collapsedRect` 现算。
 *
 * 折叠几何**刻意不写回** rg：展开态几何是唯一持久量，于是折叠 / 展开天然无损往返
 * ——若每次切换都重算并落库，误差会在反复折叠中累积漂移（且来源节点一旦被删就无从重算）。
 * 来源节点已删时退回「原地缩到折叠尺寸」，不猜它原本在哪。
 */
export function resultGroupViewRect(
  rg: { x: number; y: number; w: number; h: number; collapsed: boolean },
  sourceRect: Rect | null,
): Rect {
  if (!rg.collapsed) return { x: rg.x, y: rg.y, w: rg.w, h: rg.h }
  if (sourceRect) return collapsedRect(sourceRect)
  return { x: rg.x, y: rg.y, w: COLLAPSED_SIZE.w, h: COLLAPSED_SIZE.h }
}
