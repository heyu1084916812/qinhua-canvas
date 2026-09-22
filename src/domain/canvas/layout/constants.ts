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

/**
 * 批量节点比例面板的**特殊档**：跟随素材（用户 2026-09-17）。
 *
 * 选它时，每张结果的出图比例 = 它对应那张素材的原始比例；
 * 选任何固定档（16:9 等）则这一批统一用那个比例。
 *
 * 放在 domain 而不是 UI：执行计划（buildRunPlan）也要认这个值来决定
 * 「这次调用发什么比例」，两处各写一份字符串必然漂移。
 */
export const RATIO_FOLLOW_SOURCE = '跟随素材'

/** 展示用文案（面板里这一档的说明） */
export const RATIO_FOLLOW_SOURCE_HINT = '每张结果用它对应素材的原始比例'

/** 各节点类型最小尺寸（产品文档 §6.6 / §6.10 / §6.11） */
export const NODE_MINIMUMS: Record<NodeType, Size> = {
  prompt: { w: 240, h: 160 },
  generation: { w: 240, h: 240 },
  compare: { w: 240, h: 180 },
  group: { w: 240, h: 192 },
  batch: { w: 240, h: 192 },
  board: { w: 400, h: 300 },
  /**
   * 循环节点默认 240×260：比其它节点高——它默认开着提示词面板，
   * 192 会把第一条提示词行压扁（实测截图里只露出半截）。
   * 高度仍可自由缩放，这只是开箱可用值。
   */
  loop: { w: 240, h: 260 },
}

export const ZOOM_HIDE_GRID_BELOW = 0.4
export const ZOOM_FADE_GRID_ABOVE = 2
