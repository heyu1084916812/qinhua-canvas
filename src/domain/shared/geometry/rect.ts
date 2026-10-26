export interface Point {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function makeRect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h }
}

export function rectOf(pos: Point, size: Size): Rect {
  return { x: pos.x, y: pos.y, w: size.w, h: size.h }
}

export function rectRight(r: Rect): number {
  return r.x + r.w
}

export function rectBottom(r: Rect): number {
  return r.y + r.h
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= rectRight(r) && p.y >= r.y && p.y <= rectBottom(r)
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y
}

export function expandRect(r: Rect, padding: number): Rect {
  return { x: r.x - padding, y: r.y - padding, w: r.w + padding * 2, h: r.h + padding * 2 }
}

export function rectUnion(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, rectRight(r))
    maxY = Math.max(maxY, rectBottom(r))
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function clampSize(size: Size, min: Size): Size {
  return { w: Math.max(size.w, min.w), h: Math.max(size.h, min.h) }
}

/** 把 size 归一到指定比例（分组 / 批量容器保持 5:4，向内取小） */
export function fitAspect(size: Size, ratioW: number, ratioH: number): Size {
  const target = ratioW / ratioH
  if (size.w / size.h > target) return { w: Math.round(size.h * target), h: size.h }
  return { w: size.w, h: Math.round(size.w / target) }
}

export function sizeEquals(a: Size, b: Size): boolean {
  return a.w === b.w && a.h === b.h
}
