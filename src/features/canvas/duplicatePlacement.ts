/**
 * 「创建副本 / 复制」的落位（用户 2026-10-05 第 3 批：
 * 「创建副本的时候创建的副本不要在原有的位置，或者说不要遮住画布上的节点，
 * 当前复制节点是遮住了的」）。
 *
 * 原先所有入口都写死 `dx: 24, dy: 24` —— 一个 24px 的斜向偏移。
 * 生成节点是 240×240，于是副本 96% 压在原件上（实测重叠 216×216 = 46656 px²），
 * 用户看到的是一张「没反应」的复制：点完仿佛什么都没出现。
 *
 * 现在的规则：**先把副本放到选区右侧**（间隔 `gap`），那个位置若与画布上
 * 别的节点相交，就按「右 → 下 → 右下，越走越远」顺序找第一个干净的位置。
 * 纯几何、无副作用，故可以单测；调用方只拿 `dx/dy` 去发 `node.duplicate`
 * （命令本身仍只认位移，不改语义）。
 */

export interface PlacedRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Delta {
  dx: number
  dy: number
}

/** 副本与「原件 / 别的节点」之间留的缝（世界 px；与画布里其它落位间距同档） */
export const DUPLICATE_GAP = 40

/** 最多试这么多个候选位置；全都被占就退回「右侧一格」（画布无限大，实际到不了） */
const MAX_TRIES = 24

function intersects(a: PlacedRect, b: PlacedRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function boundsOf(rects: readonly PlacedRect[]): PlacedRect | null {
  if (rects.length === 0) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: right - x, h: bottom - y }
}

/**
 * 求一个「不遮住别人」的位移。
 *
 * `moving` = 这次要复制的那些节点的世界矩形；`others` = 画布上**其余**节点。
 * 调用方负责把「集合内部的节点」从 `others` 里排除 —— 否则多选复制时，
 * 集合里相邻的两个节点会把彼此判成「撞上了」。
 */
export function noOverlapDelta(
  moving: readonly PlacedRect[],
  others: readonly PlacedRect[],
  gap = DUPLICATE_GAP,
): Delta {
  const box = boundsOf(moving)
  if (!box) return { dx: gap, dy: 0 }
  const stepX = box.w + gap
  const stepY = box.h + gap
  const candidates: Delta[] = []
  for (let i = 1; i <= MAX_TRIES; i += 1) {
    candidates.push({ dx: i * stepX, dy: 0 })
    candidates.push({ dx: 0, dy: i * stepY })
    candidates.push({ dx: i * stepX, dy: i * stepY })
  }
  for (const c of candidates) {
    const moved = moving.map((r) => ({ ...r, x: r.x + c.dx, y: r.y + c.dy }))
    const clash = moved.some((r) => others.some((o) => intersects(r, o)))
    if (!clash) return c
  }
  return { dx: stepX, dy: 0 }
}
