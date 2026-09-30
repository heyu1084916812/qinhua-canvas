import type { Point, Rect, Size } from '../geometry/rect'
import { rectUnion } from '../geometry/rect'
import type { Viewport } from '../geometry/coords'

/**
 * 小地图（产品文档 §6.4）：把「世界坐标里的节点 + 当前视口」等比投到一块固定尺寸的小画布上。
 *
 * 纯函数：不吃 React / store / DOM，便于单测，也便于别的宿主复用。
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

/**
 * 只描述「世界 → 小地图」这一套映射，不含具体内容。
 *
 * 与 `MinimapModel` 分开是**性能需要**：`bounds/scale/origin` 只由内容决定
 * （不变量 1），与视口无关。于是平移时（视口每帧变、内容一个不动）投影可以整份复用，
 * 300 个节点小方块不必每帧重算重渲——实测小地图占拖动帧预算约 15ms，
 * 其中绝大部分就是这轮白跑（M6-29）。
 */
export interface MinimapProjection {
  scale: number
  origin: Point
  bounds: Rect
}

/** 内容为空时的兜底范围：不与视口耦合，保证投影在无内容时仍然恒定 */
const EMPTY_BOUNDS: Rect = { x: 0, y: 0, w: 1, h: 1 }

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
 * 只算投影（不含内容）。`fallback` 是无内容时的兜底范围，由调用方给
 * （通常是当前视口——空画布上小地图跟着视口走，点击跳转才有正确落点）。
 */
export function minimapProjection(
  sources: readonly MinimapSource[],
  box: Size = MINIMAP_BOX,
  padding: number = MINIMAP_PADDING,
  fallback: Rect = EMPTY_BOUNDS,
): MinimapProjection {
  const bounds = rectUnion(sources.map((s) => s.rect)) ?? fallback
  const innerW = Math.max(box.w - padding * 2, 1)
  const innerH = Math.max(box.h - padding * 2, 1)
  const scale = Math.min(innerW / Math.max(bounds.w, 1), innerH / Math.max(bounds.h, 1))
  // 内容在小地图里居中（否则矮胖的图会贴在左上角，右下角空一大块）
  const origin: Point = {
    x: padding + (innerW - bounds.w * scale) / 2,
    y: padding + (innerH - bounds.h * scale) / 2,
  }
  return { scale, origin, bounds }
}

/** 世界矩形 → 小地图矩形（极小节点保留 `minPx` 的可见边长） */
export function projectRect(p: MinimapProjection, r: Rect, minPx = 0): Rect {
  return {
    x: p.origin.x + (r.x - p.bounds.x) * p.scale,
    y: p.origin.y + (r.y - p.bounds.y) * p.scale,
    w: Math.max(r.w * p.scale, minPx),
    h: Math.max(r.h * p.scale, minPx),
  }
}

/** 内容在小地图上的方块（与视口无关，平移时可整份复用） */
export function minimapItems(
  p: MinimapProjection,
  sources: readonly MinimapSource[],
): { id: string; rect: Rect }[] {
  return sources.map((s) => ({ id: s.id, rect: projectRect(p, s.rect, MIN_ITEM_PX) }))
}

/** 视口框（钉回小地图内）；视口每帧都变，故与 items 分开算 */
export function minimapViewRect(
  p: MinimapProjection,
  view: Rect,
  box: Size = MINIMAP_BOX,
): Rect {
  return pinRectToBox(projectRect(p, view), box)
}

/**
 * 小地图外框圆角（`--radius-control`）。与 CSS 保持同一个数：
 * 视觉同心是**两条弧共圆心**，内框半径必须由它推出来，故在这里也留一份。
 */
export const MINIMAP_RADIUS = 10

/**
 * 视口框的圆角半径：**与外框同心**。
 *
 * 用户 2026-09-19 反馈「描边不是同一个圆角、有东西被遮住」：外框 10px 圆角，
 * 而视口框一直写死 `rx=2`。视口比内容大时它会**铺满整框**（贴到 0..200 / 0..140），
 * 于是 2px 的近似直角正好顶在 10px 的圆弧上——两条弧圆心不同、曲率不同，角上就
 * 出现「里面的方框戳出圆角」的错觉。
 *
 * 同心规则：内框半径 = 外半径 − 内框到外边界的最小距离。贴着边（inset=0）时
 * 内半径 = 外半径，两条弧完全重合；内框离边越远，半径越小，直到退化为止。
 * 直边上的 inset 取 0（那边没有弧要跟随），这样只有真正靠近圆角的那条边参与计算。
 */
export function minimapViewRadius(view: Rect, box: Size = MINIMAP_BOX, outerRadius = MINIMAP_RADIUS): number {
  const inset = Math.max(Math.min(view.x, view.y, box.w - (view.x + view.w), box.h - (view.y + view.h)), 0)
  return Math.max(outerRadius - inset, 0)
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
  const p = minimapProjection(input.sources, box, input.padding, input.view)
  return {
    scale: p.scale,
    origin: p.origin,
    bounds: p.bounds,
    items: minimapItems(p, input.sources),
    view: minimapViewRect(p, input.view, box),
  }
}

/**
 * 小地图坐标 → 世界坐标（`minimapProjection` 的逆运算，点击 / 拖拽跳转用）。
 * 只吃投影那三个数，故收 `MinimapProjection`（`MinimapModel` 也满足它）。
 */
export function minimapToWorld(p: Point, projection: MinimapProjection): Point {
  const scale = projection.scale > 0 ? projection.scale : 1
  return {
    x: projection.bounds.x + (p.x - projection.origin.x) / scale,
    y: projection.bounds.y + (p.y - projection.origin.y) / scale,
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
