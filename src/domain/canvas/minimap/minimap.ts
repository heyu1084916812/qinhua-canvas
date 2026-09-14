import type { Point, Rect, Size } from '../geometry/rect'
import { rectUnion } from '../geometry/rect'
import type { Viewport } from '../geometry/coords'

/**
 * 小地图（产品文档 §6.4）：把「世界坐标里的节点 + 当前视口」等比投到一块固定尺寸的小画布上。
 *
 * 纯函数：不吃 React / store / DOM，便于单测，也便于将来别的宿主（画板内缩略）复用。
 *
 * 三条不变量：
 *
 * 1. **范围只由内容决定**（无内容时才退化为视口）。千万**别把视口并进范围**：那样
 *    一边拖一边改视口会反过来改 `scale`，同一个光标位置映射到的世界坐标越拖越远——
 *    是个会自我放大的回路。范围与视口无关，映射就恒定，拖拽天然稳定。
 * 2. **等比缩放。** 世界 → 小地图共用一个 `scale`，不分别缩 x/y。分别缩会让图形变形，
 *    「点哪儿跳哪儿」的落点也随之失真。
 * 3. **视口框钉回框内（保留尺寸）。** 视口跑到内容之外时，用「平移」而不是「求交」
 *    把它拉回小地图内：求交会让框变小、读成「看得更少了」，而它真正的含义是
 *    「已经偏出去了」；视口比内容还大（缩得很小、全图都在视野里）则铺满整框。
 */

/** 小地图尺寸（产品文档 §6.4：约 200 × 140） */
export const MINIMAP_BOX: Size = { w: 200, h: 140 }

/** 内容距小地图边缘的留白：不留白的话贴边的节点会被 `overflow: hidden` 切掉半条 */
export const MINIMAP_PADDING = 6

/** 极小节点在小地图上的最小可见边长：算出来不到 1px 就等于没画 */
const MIN_ITEM_PX = 2

/** 小地图上要画的一个东西（顶层节点或结果组），世界坐标 */
export interface MinimapSource {
  id: string
  rect: Rect
}

/** 投影结果：`items` 与 `view` 都已是**小地图坐标**，`bounds` / `scale` / `origin` 描述这套投影 */
export interface MinimapModel {
  /** 世界 → 小地图的等比缩放（每世界单位 = 多少小地图像素） */
  scale: number
  /** `bounds` 左上角在小地图中的位置 */
  origin: Point
  /** 本次投影覆盖的世界范围（内容；无内容时为视口） */
  bounds: Rect
  items: { id: string; rect: Rect }[]
  /** 视口矩形，已钉回小地图内 */
  view: Rect
}

/** 视口覆盖的世界矩形：视口只存「左上角世界坐标 + 缩放」，宽高得用容器尺寸反算 */
export function viewWorldRect(vp: Viewport, container: Size): Rect {
  return { x: vp.x, y: vp.y, w: container.w / vp.zoom, h: container.h / vp.zoom }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max))
}

/**
 * 把矩形钉回框内：**保尺寸、挪位置**（见文件头不变量 3）。
 * 比框还大时铺满整框；越界时贴到对应那条边。
 */
function pinRectToBox(r: Rect, box: Size): Rect {
  const w = Math.min(Math.max(r.w, 0), box.w)
  const h = Math.min(Math.max(r.h, 0), box.h)
  return { x: clamp(r.x, 0, box.w - w), y: clamp(r.y, 0, box.h - h), w, h }
}

/**
 * 建一次投影。
 *
 * `sources` 传**世界矩形**：顶层节点与结果组都算，容器内子节点不算（它们的 x/y 是
 * 容器内的局部坐标，混进来会把范围拉偏——与 `fitCanvasView` 同一口径）。
 */
export function buildMinimapModel(input: {
  sources: readonly MinimapSource[]
  view: Rect
  box?: Size
  padding?: number
}): MinimapModel {
  const box = input.box ?? MINIMAP_BOX
  const padding = input.padding ?? MINIMAP_PADDING
  const bounds = rectUnion(input.sources.map((s) => s.rect)) ?? input.view

  const innerW = Math.max(box.w - padding * 2, 1)
  const innerH = Math.max(box.h - padding * 2, 1)
  const scale = Math.min(innerW / Math.max(bounds.w, 1), innerH / Math.max(bounds.h, 1))

  // 内容在小地图里居中（否则矮胖的图会贴在左上角，右下角空一大块）
  const origin: Point = {
    x: padding + (innerW - bounds.w * scale) / 2,
    y: padding + (innerH - bounds.h * scale) / 2,
  }

  const toMini = (r: Rect, minPx: number): Rect => ({
    x: origin.x + (r.x - bounds.x) * scale,
    y: origin.y + (r.y - bounds.y) * scale,
    w: Math.max(r.w * scale, minPx),
    h: Math.max(r.h * scale, minPx),
  })

  return {
    scale,
    origin,
    bounds,
    items: input.sources.map((s) => ({ id: s.id, rect: toMini(s.rect, MIN_ITEM_PX) })),
    view: pinRectToBox(toMini(input.view, 0), box),
  }
}

/** 小地图坐标 → 世界坐标（`buildMinimapModel` 的逆运算，点击 / 拖拽跳转用） */
export function minimapToWorld(p: Point, model: MinimapModel): Point {
  const scale = model.scale > 0 ? model.scale : 1
  return {
    x: model.bounds.x + (p.x - model.origin.x) / scale,
    y: model.bounds.y + (p.y - model.origin.y) / scale,
  }
}

/** 把视口中心移到指定世界点（点击 / 拖拽「跳到这儿」的落点计算） */
export function centerViewportOn(vp: Viewport, container: Size, world: Point): Viewport {
  return {
    zoom: vp.zoom,
    x: world.x - container.w / (2 * vp.zoom),
    y: world.y - container.h / (2 * vp.zoom),
  }
}
