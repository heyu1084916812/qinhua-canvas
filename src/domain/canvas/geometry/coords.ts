import type { Point, Rect } from './rect'
import type { NodeLike } from '../model/graph'

/**
 * 三套坐标（架构 §5.3）：
 * - world：画布全局坐标，parentId 为空的节点持久化值
 * - local：容器内相对坐标，有 parentId 的节点持久化值
 * - screen：屏幕像素，随视口变换，不持久化
 *
 * vp.x / vp.y 的语义是「视口左上角对应的世界坐标」。
 */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

export function screenToWorld(p: Point, vp: Viewport, containerRect: Rect): Point {
  return {
    x: (p.x - containerRect.x) / vp.zoom + vp.x,
    y: (p.y - containerRect.y) / vp.zoom + vp.y,
  }
}

export function worldToScreen(p: Point, vp: Viewport, containerRect: Rect): Point {
  return {
    x: (p.x - vp.x) * vp.zoom + containerRect.x,
    y: (p.y - vp.y) * vp.zoom + containerRect.y,
  }
}

export function worldToLocal(world: Point, parent: NodeLike): Point {
  return { x: world.x - parent.x, y: world.y - parent.y }
}

export function localToWorld(local: Point, parent: NodeLike): Point {
  return { x: local.x + parent.x, y: local.y + parent.y }
}

/** 节点在 world 下的矩形：无父级即自身，有父级则加上父级世界坐标 */
export function toWorldRect(node: NodeLike, parent?: NodeLike | null): Rect {
  return parent
    ? { x: parent.x + node.x, y: parent.y + node.y, w: node.w, h: node.h }
    : { x: node.x, y: node.y, w: node.w, h: node.h }
}

/**
 * 图内节点的世界矩形（父级可能是**结果组**）。
 *
 * `toWorldRect` 的父级必须是节点，而结果组住在 `resultGroups` 表、不在 `nodes` 里——
 * 只查节点索引会得到 `null`，子节点的 **local 坐标被当成世界坐标**，命中判定整片
 * 偏到画布左上角（拖出结果组时判定点算错，落点归属跟着错）。
 * 用例：拖拽落点判定（`dropPointOf`）。
 */
export function toWorldRectInGraph(
  node: NodeLike,
  graph: {
    nodes: readonly NodeLike[]
    resultGroups: readonly { id: string; x: number; y: number }[]
  },
): Rect {
  const parent = node.parentId ? graph.nodes.find((n) => n.id === node.parentId) ?? null : null
  if (parent) return toWorldRect(node, parent)
  const rg =
    node.parentId !== null
      ? graph.resultGroups.find((g) => g.id === node.parentId) ?? null
      : null
  return rg ? { x: rg.x + node.x, y: rg.y + node.y, w: node.w, h: node.h } : toWorldRect(node, null)
}

/**
 * 跨容器边界时一次性换算（架构 §5.3）。
 * 进入容器：world → 相对新父级的 local；离开容器：local → 加上旧父级偏移变回 world。
 * 往返换算不漂移是硬性要求（产品文档 §14.2 属性测试）。
 */
export function convertOnReparent(
  node: NodeLike,
  from: NodeLike | null,
  to: NodeLike | null,
): NodeLike {
  const world = from ? localToWorld({ x: node.x, y: node.y }, from) : { x: node.x, y: node.y }
  const next = to ? worldToLocal(world, to) : world
  return { ...node, x: next.x, y: next.y, parentId: to ? to.id : null }
}

/** 视口裁剪：判断世界矩形是否落在当前视口内（NodeLayer 虚拟化用） */
export function isRectVisible(rect: Rect, vp: Viewport, containerRect: Rect): boolean {
  const viewWorld: Rect = {
    x: vp.x,
    y: vp.y,
    w: containerRect.w / vp.zoom,
    h: containerRect.h / vp.zoom,
  }
  return (
    rect.x < viewWorld.x + viewWorld.w &&
    rect.x + rect.w > viewWorld.x &&
    rect.y < viewWorld.y + viewWorld.h &&
    rect.y + rect.h > viewWorld.y
  )
}
