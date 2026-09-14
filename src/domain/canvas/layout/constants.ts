import type { Size } from '../geometry/rect'
import type { NodeType } from '../model/node'

/** 网格与间距（产品文档 §3.2 / §6.11 / §6.9） */
export const GRID_SIZE = 24
export const GAP = 16
export const CONTAINER_PADDING = 20
export const CONTAINER_GAP = 16
export const RESULT_GROUP_OFFSET = 32
export const RESULT_GROUP_PADDING = 16
export const RESULT_GROUP_GAP = 16

/** 分组 / 批量的固定比例单元（5:4） */
export const PACKED_CELL: Size = { w: 200, h: 160 }
export const PACKED_MAX_COLUMNS = 3
export const CONTAINER_ASPECT: readonly [number, number] = [5, 4]

/** 结果组内结果节点单元 */
export const RESULT_CELL: Size = { w: 200, h: 200 }

/** 各节点类型最小尺寸（产品文档 §6.6 / §6.10 / §6.11） */
export const NODE_MINIMUMS: Record<NodeType, Size> = {
  prompt: { w: 240, h: 160 },
  generation: { w: 240, h: 240 },
  compare: { w: 240, h: 180 },
  group: { w: 240, h: 192 },
  batch: { w: 240, h: 192 },
  board: { w: 400, h: 300 },
}

export const ZOOM_HIDE_GRID_BELOW = 0.4
export const ZOOM_FADE_GRID_ABOVE = 2
