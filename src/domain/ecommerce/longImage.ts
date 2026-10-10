/**
 * **详情页长图排版**（对账 #420；调研稿 #380b 的"长图结果区"第一块）。
 *
 * 详情页的交付形态不是"一排单图"，而是**一张竖着拼起来的长图**：
 * 宽度固定（默认 1920，与主流详情页一致），每一张按宽度等比缩放、自上而下无缝相接。
 *
 * 为什么这一层是纯函数：拼图错位、比例拉伸、少拼一张这类问题，
 * 在几百万像素的画布上**肉眼很难发现**，但用数字断言一眼就能钉死。
 *
 * 三条口径：
 * 1. **宽度优先**：每一张都按目标宽度等比缩放（`h = 原高 × 目标宽 / 原宽`，四舍五入到整像素）；
 * 2. **尺寸未知的不硬编**：宽或高 ≤ 0 / 非有限的（素材还没落库、视频、破图）**跳过并如实报出来**，
 *    绝不按"大概 3:4"塞一个占位高度 —— 那会让长图与真实产物对不上；
 * 3. **间距可配、默认 0**：详情页各段通常无缝；要留白时由调用方给 `gap`。
 */

/** 详情页长图的目标宽度（1920 = 主流详情页宽度） */
export const LONG_IMAGE_WIDTH = 1920

export interface LongImageSource {
  id: string
  width: number
  height: number
}

export interface LongImageTile {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface LongImagePlan {
  width: number
  height: number
  tiles: LongImageTile[]
  /** 因为尺寸未知 / 非法而被跳过的（界面要如实说"有 N 张没拼进去"） */
  skipped: string[]
}

export function planLongImage(
  sources: readonly LongImageSource[],
  opts: { width?: number; gap?: number } = {},
): LongImagePlan {
  const width = Math.max(200, Math.round(opts.width ?? LONG_IMAGE_WIDTH))
  const gap = Math.max(0, Math.round(opts.gap ?? 0))
  const tiles: LongImageTile[] = []
  const skipped: string[] = []
  let y = 0
  for (const source of sources) {
    const ok =
      Number.isFinite(source.width) &&
      Number.isFinite(source.height) &&
      source.width > 0 &&
      source.height > 0
    if (!ok) {
      skipped.push(source.id)
      continue
    }
    const h = Math.max(1, Math.round((source.height * width) / source.width))
    if (tiles.length > 0) y += gap
    tiles.push({ id: source.id, x: 0, y, w: width, h })
    y += h
  }
  return { width, height: y, tiles, skipped }
}
