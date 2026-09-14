import { describe, it, expect } from 'vitest'
import {
  viewportMatrix,
  applyMatrix,
  invertMatrix,
  zoomAt,
  panBy,
  fitViewport,
  clampZoom,
  ZOOM_LIMITS,
} from './transform'
import { screenToWorld } from './coords'
import type { Rect } from './rect'

const container: Rect = { x: 0, y: 0, w: 1000, h: 800 }

describe('矩阵', () => {
  it('world → screen 与 worldToScreen 一致', () => {
    const vp = { x: 30, y: 40, zoom: 1.25 }
    const m = viewportMatrix(vp, container)
    const p = { x: 123, y: 456 }
    expect(applyMatrix(m, p)).toEqual({ x: (p.x - vp.x) * vp.zoom, y: (p.y - vp.y) * vp.zoom })
  })

  it('矩阵与其逆矩阵复合后回到原点', () => {
    const vp = { x: 12, y: -8, zoom: 0.7 }
    const m = viewportMatrix(vp, container)
    const inv = invertMatrix(m)
    const p = { x: 321, y: 654 }
    const round = applyMatrix(inv, applyMatrix(m, p))
    expect(round.x).toBeCloseTo(p.x, 8)
    expect(round.y).toBeCloseTo(p.y, 8)
  })
})

describe('锚点缩放', () => {
  it('锚点下的世界坐标保持不动', () => {
    const vp = { x: 0, y: 0, zoom: 1 }
    const anchor = { x: 300, y: 200 }
    const before = screenToWorld(anchor, vp, container)
    const next = zoomAt(vp, anchor, container, 2.5)
    const after = screenToWorld(anchor, next, container)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('缩放被限制在 10% ~ 500%（产品文档 §6.3）', () => {
    expect(ZOOM_LIMITS.min).toBe(0.1)
    expect(ZOOM_LIMITS.max).toBe(5)
    expect(clampZoom(0.001)).toBe(0.1)
    expect(clampZoom(99)).toBe(5)
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, container, 99).zoom).toBe(5)
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, container, 0.0001).zoom).toBe(0.1)
  })
})

describe('平移', () => {
  it('屏幕位移换算为世界位移', () => {
    const vp = { x: 0, y: 0, zoom: 2 }
    expect(panBy(vp, 100, 50)).toEqual({ x: -50, y: -25, zoom: 2 })
  })
})

describe('重置视图', () => {
  const rects: Rect[] = [
    { x: -500, y: -200, w: 200, h: 200 },
    { x: 800, y: 600, w: 240, h: 240 },
  ]

  it('全部节点落在视口内', () => {
    const vp = fitViewport(rects, container)
    const scale = vp.zoom
    const viewW = container.w / scale
    const viewH = container.h / scale
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(vp.x - 1)
      expect(r.y).toBeGreaterThanOrEqual(vp.y - 1)
      expect(r.x + r.w).toBeLessThanOrEqual(vp.x + viewW + 1)
      expect(r.y + r.h).toBeLessThanOrEqual(vp.y + viewH + 1)
    }
  })

  it('空画布退回默认视口', () => {
    expect(fitViewport([], container)).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})
