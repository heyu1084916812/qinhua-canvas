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

/**
 * **长图编排**（对账 #426）：这一张长图由**哪几张、按什么顺序**拼起来。
 *
 * 为什么不直接拿结果顺序当长图顺序：详情页的段落顺序是**要交出去给人看的东西** ——
 * "这一段先不要""把卖点挪到第二段"是这套流程里最常见的两个修改，
 * 而在这一批之前一个都做不到（面板只会把已完成的全部按落库顺序拼一遍）。
 *
 * 三个动作都是**纯函数**，而且越界 / 重复 / 不认识的 id 一律**原样返回入参引用** ——
 * 与项目里其它编辑动作同一条纪律：没变化就不要骗 React 重渲染。
 */

/** 上移 / 下移 `delta` 位。id 不在里面、或移出去界了都原样返回 */
export function moveTile(ids: readonly string[], id: string, delta: number): readonly string[] {
  const from = ids.indexOf(id)
  if (from < 0 || delta === 0) return ids
  const to = from + delta
  if (to < 0 || to >= ids.length) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** 把这一张**移出**长图（不在里面就原样返回） */
export function removeTile(ids: readonly string[], id: string): readonly string[] {
  if (!ids.includes(id)) return ids
  return ids.filter((x) => x !== id)
}

/**
 * 把这一张**加回**长图 —— 按它在结果里的**自然位置**落位，不是一律接到末尾。
 *
 * 为什么：用户点「移出」的意思是"这段先不要"，点「加回来」的意思是"还是要"。
 * 一律接到末尾会把段落顺序悄悄改掉（第 2 段跑到最后一段），那是用户没要求的改动。
 */
export function addTile(
  ids: readonly string[],
  id: string,
  natural: readonly string[],
): readonly string[] {
  if (ids.includes(id)) return ids
  const at = natural.indexOf(id)
  if (at < 0) return ids
  const insertAt = ids.findIndex((x) => natural.indexOf(x) > at)
  const next = [...ids]
  next.splice(insertAt < 0 ? next.length : insertAt, 0, id)
  return next
}
