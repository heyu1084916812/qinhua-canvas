import { fitViewport } from '../../../domain/canvas/geometry/transform'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'

/**
 * 适配视图时留出的屏幕边距。
 *
 * 顶栏（`top:12` + `height:44`）与左侧竖向工具栏都是**悬浮**在画布之上的浮层，
 * 不额外留边距的话，「缩放至全部节点可见」会把节点压到浮层底下——节点标题浮在节点外，
 * 被压住的就是标题本身。72 = 56（顶栏下沿）+ 一点余量。
 */
export const FIT_PADDING = 72

/** 画布可视区（屏幕矩形）；画布尚未挂载时返回 null */
export function canvasSurfaceRect(): Rect | null {
  const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/**
 * 重置视图（产品文档 §6.3「`Z` 键或工具栏按钮，缩放至全部节点可见」）。
 *
 * 三处入口（Z 键 / 工具栏按钮 / 空白右键「重置视图」）与模板播种后的首次适配共用这一份，
 * 避免出现三套「重置」语义。`fitViewport` 是 domain 纯函数（缩放上限 100%，只缩不放）。
 *
 * 只统计**顶层节点**：容器子节点的 x/y 是容器内的局部坐标，混进来会把视口拉偏。
 */
export function fitCanvasView(store: CanvasStore): void {
  const rect = canvasSurfaceRect()
  if (!rect) return
  const rects = store
    .getSnapshot()
    .nodes.filter((n) => !n.parentId)
    .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
  store.setViewport(fitViewport(rects, rect, FIT_PADDING))
}
