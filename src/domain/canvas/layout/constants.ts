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
   * 循环节点默认 240×300（2026-09-23 按实测重定，第三版）。
   *
   * 高度这件事在三版里反复调整，教训值得写下来：
   *  - 500：面板互抢高度把控件撑变形，加高只是掩住症状；
   *  - 480：面板按内容自然高后不再变形，但**留白过半**——实测
   *    「只开提示词、未接图片」时内容自然高度只有 226，而节点给了 480；
   *  - 300：按**最常见的使用状态**（两个通道开、未接上游或只接了一边）定高。
   *
   * 为什么不再追「图片 + 提示词全开」那个最大形态（约 480）：
   * 那会让**大多数时候**都留一大片空白，而空白比「需要滚一下」更伤观感——
   * 前者看起来像加载失败，后者是正常的内容溢出。`.body` 纵向可滚，
   * 内容超出时不会丢；用户也可以随时把节点拉高。
   *
   * 高度仍可自由缩放，这只是开箱可用值。
   */
  loop: { w: 240, h: 300 },
}

export const ZOOM_HIDE_GRID_BELOW = 0.4
export const ZOOM_FADE_GRID_ABOVE = 2
