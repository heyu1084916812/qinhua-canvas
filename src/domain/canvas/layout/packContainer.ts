import type { Size } from '../geometry/rect'
import { clampSize } from '../geometry/rect'
import {
  CONTAINER_GAP,
  CONTAINER_PADDING,
  CONTAINER_ASPECT,
  PACKED_CELL,
  PACKED_MAX_COLUMNS,
  NODE_MINIMUMS,
} from './constants'

export interface PackResult {
  columns: number
  rows: number
  cellSize: Size
  /** 外部容器动态最小尺寸，已归一为 5:4 */
  containerMin: Size
  /** 每个单元的 local 坐标，行优先 */
  positions: { x: number; y: number }[]
}

/** 向外取大：得到「能装下 size 且符合比例」的最小尺寸 */
function growToAspect(size: Size, ratioW: number, ratioH: number): Size {
  const target = ratioW / ratioH
  if (size.w / size.h > target) return { w: size.w, h: Math.ceil(size.w / target) }
  return { w: Math.ceil(size.h * target), h: size.h }
}

/**
 * 分组 / 批量的 3×3 行优先打包（产品文档 §6.11）。
 * 单元固定 200×160（5:4），间距 16，内边距 20；
 * 外部容器最小尺寸由当前列数、行数动态算出并归一为 5:4。
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
  const target: Size = {
    w: Math.max(needed.w, base.w),
    h: Math.max(needed.h, base.h),
  }
  // 空容器用类型最小尺寸（240×192）；有内容时归一为 5:4 且必须装得下内容
  const containerMin =
    count === 0
      ? clampSize(target, base)
      : growToAspect(target, CONTAINER_ASPECT[0], CONTAINER_ASPECT[1])

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
 * 容器有内容时的动态最小尺寸（§6.11「尺寸」）。
 * 参数是**当前容器尺寸**：增长时放大到装得下内容并归一 5:4；
 * 缩小到最小网格时停在能容纳当前内容的尺寸（即拖不动为止）。
 * 视图层只能算尺寸、不能改数据——喂同一个函数即可与 domain 保持一致。
 */
export function packedMinSize(current: Size, childCount: number): Size {
  const { containerMin } = packContainerChildren(childCount)
  const grown = growToAspect(
    { w: Math.max(current.w, containerMin.w), h: Math.max(current.h, containerMin.h) },
    CONTAINER_ASPECT[0],
    CONTAINER_ASPECT[1],
  )
  return {
    w: Math.min(grown.w, containerMin.w),
    h: Math.min(grown.h, containerMin.h),
  }
}

/** 外部容器最小尺寸（空容器 = 类型最小尺寸，有内容 = 动态网格尺寸） */
export function containerMinSize(type: 'group' | 'batch', childCount: number): Size {
  const { containerMin } = packContainerChildren(childCount, NODE_MINIMUMS[type])
  return containerMin
}
