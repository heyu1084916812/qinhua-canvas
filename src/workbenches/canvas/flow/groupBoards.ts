import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { GroupBgTone, GroupData } from '../../../domain/canvas/model/node'
import { groupBgOf } from '../../../domain/canvas/nodeSpecs/group'

export interface GroupBoard {
  id: string
  /** 世界坐标矩形（层负责世界 → 屏幕） */
  x: number
  y: number
  w: number
  h: number
  bg: GroupBgTone
}

/**
 * 要画成"背景板"的分组（用户 2026-10-06 第 14 批第 1 条：**打组就是一块背景板**）。
 *
 * 为什么底色不画在分组节点自己身上：RF 的**节点层在连线层之上**，
 * 画在节点上就会盖住穿过它的连线（用户实测：「连线混乱」，要求**显示优先级低于连线**）。
 * 所以底色由 `FlowGroupBoardLayer` 画在 RF 面板**之前**，而分组节点本身保持透明。
 *
 * 只画顶层分组：容器不嵌套（`accepts` 里就禁了），子节点里不会有分组。
 */
export function groupBoards(graph: GraphSnapshot): GroupBoard[] {
  return graph.nodes
    .filter((n) => n.type === 'group' && !n.parentId)
    .map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      bg: groupBgOf({ data: n.data as Partial<GroupData> }),
    }))
}
