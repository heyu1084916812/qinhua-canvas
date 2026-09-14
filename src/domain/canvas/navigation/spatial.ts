import type { Rect } from '../geometry/rect'

/**
 * 画布键盘空间导航（§6.20：Tab 进入画布、方向键按空间邻近切换、Home/End 首末）。
 * 纯函数：只吃节点矩形，不吃 React / store，便于单测与在视图层复用。
 *
 * 调用方负责筛选「可导航节点」（目前为 top-level 节点，无 parentId——与 M3-4
 * 「框选只命中顶层节点」保持一致，容器内子节点由容器自身管理）。
 */

export type NavDir = 'left' | 'right' | 'up' | 'down'

export interface NavNode {
  id: string
  rect: Rect
}

function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/**
 * 按视觉阅读顺序排序：先 y（上 → 下），再 x（左 → 右）。
 * 用于 Home/End、Tab 循环顺序。1px 内的 y 视为同一行，避免浮点误差导致乱序。
 */
export function sortByPosition(nodes: readonly NavNode[]): NavNode[] {
  return [...nodes].sort((a, b) => {
    const ca = center(a.rect)
    const cb = center(b.rect)
    if (Math.abs(ca.y - cb.y) > 1) return ca.y - cb.y
    return ca.x - cb.x
  })
}

export function firstNodeId(nodes: readonly NavNode[]): string | null {
  if (nodes.length === 0) return null
  return sortByPosition(nodes)[0].id
}

export function lastNodeId(nodes: readonly NavNode[]): string | null {
  if (nodes.length === 0) return null
  const sorted = sortByPosition(nodes)
  return sorted[sorted.length - 1].id
}

/**
 * 取 Tab 顺序的下一个节点：排序后当前项之后的第一个；到末尾回环到首个。
 * currentId 为 null（尚无选择）时返回排序首个——即「Tab 进入画布选中首节点」。
 */
export function nextNodeId(nodes: readonly NavNode[], currentId: string | null): string | null {
  if (nodes.length === 0) return null
  const sorted = sortByPosition(nodes)
  if (currentId == null) return sorted[0].id
  const idx = sorted.findIndex((n) => n.id === currentId)
  if (idx === -1) return sorted[0].id
  return sorted[(idx + 1) % sorted.length].id
}

/**
 * 在指定方向上离 from 最近的节点。
 * 候选必须严格落在方向半平面内（右：cx>fromCx；左：<；下：cy>fromCy；上：<）。
 * 评分 = 主轴行程 + 2 × 垂直偏移，偏好「更同轴对齐」的节点；无解返回 null。
 */
export function nearestInDirection(
  nodes: readonly NavNode[],
  fromId: string,
  dir: NavDir,
): string | null {
  const from = nodes.find((n) => n.id === fromId)
  if (!from) return null
  const fc = center(from.rect)
  let best: { id: string; score: number } | null = null
  for (const n of nodes) {
    if (n.id === fromId) continue
    const c = center(n.rect)
    const dx = c.x - fc.x
    const dy = c.y - fc.y
    let inDir = false
    let primary = 0
    let perp = 0
    switch (dir) {
      case 'right':
        inDir = dx > 0
        primary = dx
        perp = Math.abs(dy)
        break
      case 'left':
        inDir = dx < 0
        primary = -dx
        perp = Math.abs(dy)
        break
      case 'down':
        inDir = dy > 0
        primary = dy
        perp = Math.abs(dx)
        break
      case 'up':
        inDir = dy < 0
        primary = -dy
        perp = Math.abs(dx)
        break
    }
    if (!inDir) continue
    const score = primary + perp * 2
    if (best === null || score < best.score) best = { id: n.id, score }
  }
  return best ? best.id : null
}
