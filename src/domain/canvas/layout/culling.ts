import type { NodeSnapshot } from '../model/node'
import type { Viewport } from '../geometry/coords'
import { screenToWorld } from '../geometry/coords'
import type { Rect } from '../geometry/rect'
import { rectsIntersect } from '../geometry/rect'

/**
 * 视口裁剪（架构 §5.4「网格空间索引做视口裁剪，视口外节点不挂载 DOM」）。
 *
 * 网格空间索引：世界坐标按 CELL 尺寸分格，节点登记进它覆盖的所有格；
 * 查询只遍历视口覆盖的格，平移 / 缩放时复杂度与可见节点数线性相关，
 * 与总节点数无关（产品文档 §1.7 性能预算）。
 */

/** 网格格径（世界单位）：略大于常见节点尺寸，跨格节点登记所有覆盖格 */
const CELL = 512

/** 视口边界外扩（屏幕 px）：提前挂载邻近节点，避免平移时频繁挂卸 */
export const CULL_MARGIN_SCREEN = 280

/** 世界视口矩形（surface 局部屏幕坐标 → 世界，四边外扩 margin） */
export function visibleWorldRect(
  vp: Viewport,
  surfaceW: number,
  surfaceH: number,
  marginScreen = CULL_MARGIN_SCREEN,
): Rect {
  const zoom = Math.max(vp.zoom, 0.01)
  const m = marginScreen / zoom
  const tl = screenToWorld({ x: -m, y: -m }, vp, { x: 0, y: 0, w: surfaceW, h: surfaceH })
  const br = screenToWorld(
    { x: surfaceW + m, y: surfaceH + m },
    vp,
    { x: 0, y: 0, w: surfaceW, h: surfaceH },
  )
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

/**
 * 可见顶层节点 id 集合。
 * surface 尺寸为 0（未挂载 / SSR）时回退全量——宁可多渲染不可白屏。
 */
export function visibleTopLevelIds(
  nodes: readonly NodeSnapshot[],
  vp: Viewport,
  surfaceW: number,
  surfaceH: number,
  marginScreen = CULL_MARGIN_SCREEN,
): Set<string> {
  if (surfaceW <= 0 || surfaceH <= 0) return new Set(nodes.map((n) => n.id))
  const view = visibleWorldRect(vp, surfaceW, surfaceH, marginScreen)

  // 建网格索引（O(N)），查询只走视口覆盖的格（O(可见)）
  const grid = new Map<string, string[]>()
  const key = (cx: number, cy: number) => `${cx},${cy}`
  for (const n of nodes) {
    const cx0 = Math.floor(n.x / CELL)
    const cy0 = Math.floor(n.y / CELL)
    const cx1 = Math.floor((n.x + n.w) / CELL)
    const cy1 = Math.floor((n.y + n.h) / CELL)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy)
        const bucket = grid.get(k)
        if (bucket) bucket.push(n.id)
        else grid.set(k, [n.id])
      }
    }
  }

  const out = new Set<string>()
  const qx0 = Math.floor(view.x / CELL)
  const qy0 = Math.floor(view.y / CELL)
  const qx1 = Math.floor((view.x + view.w) / CELL)
  const qy1 = Math.floor((view.y + view.h) / CELL)
  for (let cx = qx0; cx <= qx1; cx++) {
    for (let cy = qy0; cy <= qy1; cy++) {
      for (const id of grid.get(key(cx, cy)) ?? []) out.add(id)
    }
  }
  // 格查询是超集（节点登记进覆盖格，但可能与视口不相交）——矩形相交精确过滤
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  for (const id of out) {
    const n = byId.get(id)
    if (!n || !rectsIntersect({ x: n.x, y: n.y, w: n.w, h: n.h }, view)) out.delete(id)
  }
  return out
}
