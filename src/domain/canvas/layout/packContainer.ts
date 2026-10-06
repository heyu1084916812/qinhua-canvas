import type { Size } from '../geometry/rect'
import {
  CONTAINER_GAP,
  CONTAINER_PADDING,
  PACKED_CELL,
  PACKED_MAX_COLUMNS,
  NODE_MINIMUMS,
} from './constants'

export interface PackResult {
  columns: number
  rows: number
  cellSize: Size
  /** 外部容器尺寸 = 内容 + 四边等距内边距（空容器 = 类型最小尺寸） */
  containerMin: Size
  /** 每个单元的 local 坐标，行优先 */
  positions: { x: number; y: number }[]
}

/**
 * 分组 / 批量的 3×3 行优先打包（产品文档 §6.11）。
 * 单元固定 200×160（5:4），间距 16，内边距 20；
 * **外部容器尺寸 = 内容包围盒 + 四边等距的 20px**。
 *
 * ⚠️ 这里曾经"归一为 5:4"（把容器撑到 5:4，内容挂在左上角）。用户 2026-10-06
 * 第 13 批第 7 条报掉的就是它：「节点素材进入批量节点的时候批量节点没有自适应，
 * **下方空出很多位置**」——2 个单元（2×200+16 = 416 宽、160 高）被撑成 456×365，
 * 下方实测空 **183px**。容器是"装东西的框"，就该**贴住内容**；
 * 单元自身的 5:4 不受影响（那才是文档要的"单元 5:4"）。
 */
export function packContainerChildren(childCount: number, minContainer?: Size): PackResult {
  const count = Math.max(0, Math.floor(childCount))
  const columns = count === 0 ? 0 : Math.min(count, PACKED_MAX_COLUMNS)
  const rows = count === 0 ? 0 : Math.ceil(count / PACKED_MAX_COLUMNS)

  const positions: { x: number; y: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const col = i % PACKED_MAX_COLUMNS
    const row = Math.floor(i / PACKED_MAX_COLUMNS)
    positions.push({
      x: CONTAINER_PADDING + col * (PACKED_CELL.w + CONTAINER_GAP),
      y: CONTAINER_PADDING + row * (PACKED_CELL.h + CONTAINER_GAP),
    })
  }

  const contentW = columns === 0 ? 0 : columns * PACKED_CELL.w + (columns - 1) * CONTAINER_GAP
  const contentH = rows === 0 ? 0 : rows * PACKED_CELL.h + (rows - 1) * CONTAINER_GAP
  const needed: Size = {
    w: contentW + CONTAINER_PADDING * 2,
    h: contentH + CONTAINER_PADDING * 2,
  }

  const base = minContainer ?? (count === 0 ? NODE_MINIMUMS.group : { w: 0, h: 0 })
  /**
   * 贴住内容：四边各留 `CONTAINER_PADDING`，不额外撑高、不额外撑宽。
   * 空容器仍用类型最小尺寸（240×192）——那是"空态文案"的落位尺寸。
   */
  const containerMin: Size = {
    w: Math.max(needed.w, base.w),
    h: Math.max(needed.h, base.h),
  }

  return { columns, rows, cellSize: { ...PACKED_CELL }, containerMin, positions }
}

/** 第 index 个单元在容器内的 local 坐标（3×3 行优先）；与 packContainerChildren 同一套数学 */
export function packedCellAt(index: number): { x: number; y: number } {
  const i = Math.max(0, Math.floor(index))
  const col = i % PACKED_MAX_COLUMNS
  const row = Math.floor(i / PACKED_MAX_COLUMNS)
  return {
    x: CONTAINER_PADDING + col * (PACKED_CELL.w + CONTAINER_GAP),
    y: CONTAINER_PADDING + row * (PACKED_CELL.h + CONTAINER_GAP),
  }
}

/**
 * 容器的动态最小尺寸（§6.11「尺寸」）：**= 内容 + 四边等距内边距**。
 *
 * 拖缩小手柄时停在这里（拖不动为止）——用户 2026-10-06 第 13 批第 7 条要的
 * 「保持四周的边距」就是它：再往里拖就会**遮住子节点**（子节点坐标以容器左上角
 * 为原点，右 / 下缩过去必然压住它们）。
 */
export function packedMinSize(childCount: number): Size {
  return packContainerChildren(childCount).containerMin
}

/** 外部容器尺寸（空容器 = 类型最小尺寸，有内容 = 内容 + 四边等距） */
export function containerMinSize(type: 'group' | 'batch', childCount: number): Size {
  const { containerMin } = packContainerChildren(childCount, NODE_MINIMUMS[type])
  return containerMin
}
