import type { Point, Rect } from './rect'
import { rectUnion } from './rect'
import type { Viewport } from './coords'
import { screenToWorld } from './coords'

/** 2D 仿射矩阵 [a, b, c, d, e, f]，与 CSS matrix(a,b,c,d,e,f) 同序 */
export type Mat2D = readonly [number, number, number, number, number, number]

/** 缩放范围 10% – 500%（产品文档 §6.3） */
export const ZOOM_LIMITS = { min: 0.1, max: 5 } as const

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, ZOOM_LIMITS.min), ZOOM_LIMITS.max)
}

/** world → screen */
export function viewportMatrix(vp: Viewport, containerRect: Rect): Mat2D {
  return [vp.zoom, 0, 0, vp.zoom, containerRect.x - vp.x * vp.zoom, containerRect.y - vp.y * vp.zoom]
}

export function applyMatrix(m: Mat2D, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

export function invertMatrix(m: Mat2D): Mat2D {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/** 以某个屏幕点为锚点缩放：该点下的世界坐标保持不动（滚轮缩放） */
export function zoomAt(
  vp: Viewport,
  anchorScreen: Point,
  containerRect: Rect,
  nextZoom: number,
): Viewport {
  const zoom = clampZoom(nextZoom)
  const world = screenToWorld(anchorScreen, vp, containerRect)
  return {
    zoom,
    x: world.x - (anchorScreen.x - containerRect.x) / zoom,
    y: world.y - (anchorScreen.y - containerRect.y) / zoom,
  }
}

export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...vp, x: vp.x - dxScreen / vp.zoom, y: vp.y - dyScreen / vp.zoom }
}

/** 重置视图（快捷键 Z）：缩放到全部节点可见并居中 */
export function fitViewport(
  rects: readonly Rect[],
  containerRect: Rect,
  padding = 48,
): Viewport {
  const bounds = rectUnion(rects)
  if (!bounds || containerRect.w === 0 || containerRect.h === 0) {
    return { x: 0, y: 0, zoom: 1 }
  }
  const zoom = clampZoom(
    Math.min(
      (containerRect.w - padding * 2) / Math.max(bounds.w, 1),
      (containerRect.h - padding * 2) / Math.max(bounds.h, 1),
      1,
    ),
  )
  return {
    zoom,
    x: bounds.x + bounds.w / 2 - containerRect.w / (2 * zoom),
    y: bounds.y + bounds.h / 2 - containerRect.h / (2 * zoom),
  }
}
