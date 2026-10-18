import { fitViewport } from '../../../domain/canvas/geometry/transform'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'

/**
 * 适配视图时留出的屏幕边距。
 *
 * 画布工具条是**悬浮**在画布底部居中的浮层；不额外留边距的话，
 * 「缩放至全部节点可见」会把节点压到工具栏底下——节点标题浮在节点外，
 * 被压住的就是标题本身。
 *
 * 128 = 底部工具栏 16 + 48（按钮/内距）再留一点余量。工具条以后即使
 * 轻微加大或描边变化，也不会让「重置视图」把节点标题压住。
 */
export const FIT_PADDING = 128

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

/**
 * 把视图对准**某一个节点**（对账 #424）。
 *
 * 与 `fitCanvasView`（全部节点）只差一个自变量：参与适配的矩形只有那一个。
 * 仍然走 `fitViewport` —— 缩放上限 100%、留 `FIT_PADDING` 给底部工具栏，
 * 两条口径与"重置视图"完全一致（各写一份迟早出现"跳过去正好被工具栏压住"）。
 *
 * 容器子节点用 `toWorldRectInGraph` 换到世界坐标：子节点的 x/y 是**容器内**的局部值，
 * 直接拿去适配会把视口甩到别的地方（`fitCanvasView` 只统计顶层节点，正是同一个理由）。
 *
 * 找不到这个节点（已被删 / id 写错）时**什么都不做**并返回 `false` ——
 * 调用方据此如实处理，而不是把视口甩到 (0, 0) 让人以为"图没了"。
 */
export function focusCanvasNode(store: CanvasStore, nodeId: string): boolean {
  const rect = canvasSurfaceRect()
  if (!rect) return false
  const graph = store.getSnapshot()
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return false
  store.setViewport(fitViewport([toWorldRectInGraph(node, graph)], rect, FIT_PADDING))
  return true
}
