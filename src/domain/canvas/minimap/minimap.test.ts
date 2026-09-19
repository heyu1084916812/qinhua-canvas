import { describe, it, expect } from 'vitest'
import { rectCenter, type Rect } from '../geometry/rect'
import {
  MINIMAP_BOX,
  MINIMAP_PADDING,
  MINIMAP_RADIUS,
  buildMinimapModel,
  centerViewportOn,
  minimapToWorld,
  minimapViewRadius,
  viewWorldRect,
  type MinimapSource,
} from './minimap'

const BOX = MINIMAP_BOX
const PAD = MINIMAP_PADDING

/** 两个节点：A 在左上、B 在右下，包围盒 1300 × 1200 */
const SOURCES: MinimapSource[] = [
  { id: 'A', rect: { x: 0, y: 0, w: 1000, h: 500 } },
  { id: 'B', rect: { x: 200, y: 900, w: 300, h: 300 } },
]

const CONTAINER = { w: 1280, h: 800 }
/** 视口正好落在内容里（不会触发钉回） */
const VIEW_IN: Rect = { x: 100, y: 100, w: 1280, h: 800 }

function build(sources: readonly MinimapSource[] = SOURCES, view: Rect = VIEW_IN) {
  return buildMinimapModel({ sources, view, box: BOX, padding: PAD })
}

describe('viewWorldRect', () => {
  it('宽高由容器尺寸与缩放反算（缩得越小看得越远）', () => {
    expect(viewWorldRect({ x: 0, y: 0, zoom: 1 }, CONTAINER)).toEqual({ x: 0, y: 0, w: 1280, h: 800 })
    expect(viewWorldRect({ x: 0, y: 0, zoom: 2 }, CONTAINER)).toEqual({ x: 0, y: 0, w: 640, h: 400 })
  })
})

describe('buildMinimapModel', () => {
  it('范围只由内容决定：视口跑到远处也不会把内容缩小', () => {
    const near = build(SOURCES, VIEW_IN)
    const far = build(SOURCES, { x: 99999, y: 99999, w: 1280, h: 800 })
    expect(far.bounds).toEqual(near.bounds)
    expect(far.scale).toBeCloseTo(near.scale, 10)
    // 内容矩形一个像素都不动 —— 否则拖拽会自我放大（见模块头不变量 1）
    expect(far.items).toEqual(near.items)
  })

  it('等比缩放：小地图里的节点保持原始宽高比', () => {
    const m = build([{ id: 'wide', rect: { x: 0, y: 0, w: 400, h: 200 } }])
    const it = m.items[0].rect
    expect(it.w / it.h).toBeCloseTo(2, 6)
  })

  it('节点矩形落在小地图框内', () => {
    const m = build()
    for (const item of m.items) {
      expect(item.rect.x).toBeGreaterThanOrEqual(0)
      expect(item.rect.y).toBeGreaterThanOrEqual(0)
      expect(item.rect.x + item.rect.w).toBeLessThanOrEqual(BOX.w + 0.001)
      expect(item.rect.y + item.rect.h).toBeLessThanOrEqual(BOX.h + 0.001)
    }
  })

  it('留白生效：内容不贴边（最左 / 最上至少距边 padding）', () => {
    const m = build()
    const minX = Math.min(...m.items.map((i) => i.rect.x))
    const minY = Math.min(...m.items.map((i) => i.rect.y))
    expect(minX).toBeGreaterThanOrEqual(PAD - 0.001)
    expect(minY).toBeGreaterThanOrEqual(PAD - 0.001)
  })

  it('极小的节点也有最小可见边长（算出来不到 1px 等于没画）', () => {
    const m = build([
      { id: 'tiny', rect: { x: 0, y: 0, w: 2, h: 2 } },
      { id: 'big', rect: { x: 0, y: 0, w: 4000, h: 4000 } },
    ])
    const tiny = m.items.find((i) => i.id === 'tiny')!
    expect(tiny.rect.w).toBeGreaterThanOrEqual(2)
    expect(tiny.rect.h).toBeGreaterThanOrEqual(2)
  })

  it('视口在内容范围内时按真实位置绘制，不做偏移', () => {
    const m = build()
    const expectedX = m.origin.x + (VIEW_IN.x - m.bounds.x) * m.scale
    expect(m.view.x).toBeCloseTo(expectedX, 6)
    expect(m.view.w).toBeCloseTo(VIEW_IN.w * m.scale, 6)
  })

  it('视口偏出右侧：钉到右边缘且**保留尺寸**（不是求交变小）', () => {
    const view: Rect = { x: 99999, y: 100, w: 300, h: 200 }
    const m = build(SOURCES, view)
    const expectedW = view.w * m.scale
    expect(m.view.w).toBeCloseTo(expectedW, 6)
    expect(m.view.x + m.view.w).toBeCloseTo(BOX.w, 6)
  })

  it('视口偏出左上：钉到左上原点', () => {
    const m = build(SOURCES, { x: -99999, y: -99999, w: 300, h: 200 })
    expect(m.view.x).toBeCloseTo(0, 6)
    expect(m.view.y).toBeCloseTo(0, 6)
  })

  it('视口比内容还大（缩得很小、全图都在视野里）：铺满整框', () => {
    const m = build(SOURCES, { x: -5000, y: -5000, w: 20000, h: 20000 })
    expect(m.view).toEqual({ x: 0, y: 0, w: BOX.w, h: BOX.h })
  })

  it('没有内容时退化为「只画视口」，不抛异常', () => {
    const view: Rect = { x: 0, y: 0, w: 1280, h: 800 }
    const m = build([], view)
    expect(m.items).toEqual([])
    expect(m.bounds).toEqual(view)
    expect(m.view.w).toBeCloseTo(BOX.w - PAD * 2, 6)
  })

  it('不修改入参', () => {
    const sources: MinimapSource[] = [{ id: 'A', rect: { x: 0, y: 0, w: 100, h: 100 } }]
    const view: Rect = { x: 0, y: 0, w: 100, h: 100 }
    const snapshotSources = structuredClone(sources)
    const snapshotView = { ...view }
    build(sources, view)
    expect(sources).toEqual(snapshotSources)
    expect(view).toEqual(snapshotView)
  })
})

describe('minimapViewRadius（同心圆角）', () => {
  it('视口铺满整框（贴到四边）时，内框半径 = 外框半径', () => {
    // 用户 2026-09-19「描边不是同一个圆角、有东西被遮住」的回归：
    // 视口比内容大时会铺满 0..200 / 0..140，写死 rx=2 的方角正好戳进 10px 圆角。
    expect(minimapViewRadius({ x: 0, y: 0, w: BOX.w, h: BOX.h })).toBe(MINIMAP_RADIUS)
  })

  it('内框离边越远，半径越小（保持与外框同心）', () => {
    const r0 = minimapViewRadius({ x: 0, y: 0, w: BOX.w, h: BOX.h })
    const r4 = minimapViewRadius({ x: 4, y: 4, w: BOX.w - 8, h: BOX.h - 8 })
    const r6 = minimapViewRadius({ x: 6, y: 6, w: BOX.w - 12, h: BOX.h - 12 })
    expect(r0).toBe(MINIMAP_RADIUS)
    expect(r4).toBe(MINIMAP_RADIUS - 4)
    expect(r6).toBe(MINIMAP_RADIUS - 6)
    // 单调：离边越远半径越小，绝不反弹
    expect(r0).toBeGreaterThan(r4)
    expect(r4).toBeGreaterThan(r6)
  })

  it('内框足够小时半径退化为 0（不出现负半径）', () => {
    expect(minimapViewRadius({ x: 40, y: 40, w: 20, h: 20 })).toBe(0)
    expect(minimapViewRadius({ x: 100, y: 100, w: 5, h: 5 })).toBe(0)
  })

  it('只有一条边靠近圆角时也按那条边算（取四边最小留白）', () => {
    // 上边贴边（inset=0），其余三边离得远 —— 贴上边圆角的那条边决定半径
    expect(minimapViewRadius({ x: 50, y: 0, w: 40, h: 60 }, BOX)).toBe(MINIMAP_RADIUS)
  })

  it('视口越出盒外时也不出现负半径 / NaN', () => {
    const r = minimapViewRadius({ x: 12, y: 12, w: 200, h: 140 })
    expect(Number.isFinite(r)).toBe(true)
    expect(r).toBeGreaterThanOrEqual(0)
  })
})

describe('minimapToWorld', () => {
  it('与投影互逆：节点中心往返回到原处', () => {
    const m = build()
    for (const item of m.items) {
      const back = minimapToWorld(rectCenter(item.rect), m)
      const src = SOURCES.find((s) => s.id === item.id)!
      expect(back.x).toBeCloseTo(rectCenter(src.rect).x, 4)
      expect(back.y).toBeCloseTo(rectCenter(src.rect).y, 4)
    }
  })

  it('小地图 origin 处对应世界包围盒左上角', () => {
    const m = build()
    const p = minimapToWorld(m.origin, m)
    expect(p.x).toBeCloseTo(m.bounds.x, 6)
    expect(p.y).toBeCloseTo(m.bounds.y, 6)
  })
})

describe('centerViewportOn', () => {
  it('跳过去之后，视口中心正是目标世界点', () => {
    const vp = { x: 0, y: 0, zoom: 1 }
    const target = { x: 4321, y: 1234 }
    const next = centerViewportOn(vp, CONTAINER, target)
    expect(rectCenter(viewWorldRect(next, CONTAINER))).toEqual(target)
  })

  it('缩放不改变这个结论（视口中心仍是目标点）', () => {
    const target = { x: -800, y: 640 }
    for (const zoom of [0.25, 1, 3]) {
      const next = centerViewportOn({ x: 0, y: 0, zoom }, CONTAINER, target)
      const c = rectCenter(viewWorldRect(next, CONTAINER))
      expect(c.x).toBeCloseTo(target.x, 6)
      expect(c.y).toBeCloseTo(target.y, 6)
      expect(next.zoom).toBe(zoom)
    }
  })
})
