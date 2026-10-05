import type { Viewport } from '../../../domain/canvas/geometry/coords'

/**
 * 视口语义换算：轻画 ⇄ React Flow（引擎替换 P0 的关键不变量）。
 *
 * 两边**字段名一样、单位不一样**，直接互相赋值会把画布算错：
 * - 轻画 `Viewport.x/y` = 「**视口左上角对应的世界坐标**」
 *   （见 `domain/canvas/geometry/coords.ts`：`screenToWorld = (screen - rect)/zoom + vp.x`；
 *    老画布的 transform 是 `translate(-vp.x*zoom, -vp.y*zoom) scale(zoom)`）
 * - React Flow `viewport.x/y` = 「**屏幕像素位移**」
 *   （`screen = world * zoom + x`）
 *
 * 1:1 同步的实测后果：工具栏按 store 视口中心新建的节点落到屏幕 (1448,990)，
 * 视口只有 1440×900 —— 新节点直接掉到视野外、点不到也拖不动。
 */

export interface FlowViewport {
  x: number
  y: number
  zoom: number
}

/** 轻画（世界坐标语义）→ React Flow（屏幕像素语义） */
export function storeViewportToFlow(vp: Viewport): FlowViewport {
  return { x: -vp.x * vp.zoom, y: -vp.y * vp.zoom, zoom: vp.zoom }
}

/** React Flow（屏幕像素语义）→ 轻画（世界坐标语义） */
export function flowViewportToStore(vp: FlowViewport): Viewport {
  const zoom = vp.zoom > 0 ? vp.zoom : 1
  return { x: -vp.x / zoom, y: -vp.y / zoom, zoom }
}
