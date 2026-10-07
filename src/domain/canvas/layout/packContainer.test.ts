import { describe, it, expect } from 'vitest'
import {
  packContainerChildren,
  packedCellAt,
  packedMinSize,
  containerMinSize,
  containerScale,
} from './packContainer'
import { PACKED_CELL, NODE_MINIMUMS, CONTAINER_PADDING, CONTAINER_GAP } from './constants'

describe('分组 / 批量打包', () => {
  it('空容器给出类型最小尺寸', () => {
    const r = packContainerChildren(0)
    expect(r.columns).toBe(0)
    expect(r.containerMin).toEqual(NODE_MINIMUMS.group)
  })

  it('3 列行优先，超过 3 个换行', () => {
    expect(packContainerChildren(2).columns).toBe(2)
    expect(packContainerChildren(3).rows).toBe(1)
    expect(packContainerChildren(4).columns).toBe(3)
    expect(packContainerChildren(4).rows).toBe(2)
    expect(packContainerChildren(9).rows).toBe(3)
    expect(packContainerChildren(10).rows).toBe(4)
  })

  it('单元位置不重叠且保持 16px 间距', () => {
    const r = packContainerChildren(6)
    for (let i = 0; i < r.positions.length; i += 1) {
      for (let j = i + 1; j < r.positions.length; j += 1) {
        const a = r.positions[i]!
        const b = r.positions[j]!
        const overlap =
          a.x < b.x + PACKED_CELL.w &&
          a.x + PACKED_CELL.w > b.x &&
          a.y < b.y + PACKED_CELL.h &&
          a.y + PACKED_CELL.h > b.y
        expect(overlap).toBe(false)
      }
    }
  })

  it('容器尺寸 = 内容 + 四边等距 20px（贴住内容，不再归一 5:4）', () => {
    for (let n = 1; n <= 12; n += 1) {
      const r = packContainerChildren(n)
      const maxX = Math.max(...r.positions.map((p) => p.x + PACKED_CELL.w))
      const maxY = Math.max(...r.positions.map((p) => p.y + PACKED_CELL.h))
      expect(r.containerMin.w).toBeGreaterThanOrEqual(maxX)
      expect(r.containerMin.h).toBeGreaterThanOrEqual(maxY)
      // 四周留白相等 —— 这正是用户第 13 批第 7 条要的"保持四周的边距"
      expect(r.containerMin.w - maxX).toBe(CONTAINER_PADDING)
      expect(r.containerMin.h - maxY).toBe(CONTAINER_PADDING)
      expect(Math.min(...r.positions.map((p) => p.x))).toBe(CONTAINER_PADDING)
      expect(Math.min(...r.positions.map((p) => p.y))).toBe(CONTAINER_PADDING)
    }
  })

  it('两个单元不再被撑成 5:4（用户实测的"下方空 183px"现场）', () => {
    const r = packContainerChildren(2)
    expect(r.containerMin).toEqual({ w: 2 * PACKED_CELL.w + CONTAINER_GAP + CONTAINER_PADDING * 2, h: PACKED_CELL.h + CONTAINER_PADDING * 2 })
    expect(r.containerMin.h).toBe(200)
  })
})

describe('packedCellAt / packedMinSize（§6.11 尺寸）', () => {
  it('packedCellAt 与 packContainerChildren 的位置完全一致', () => {
    const r = packContainerChildren(7)
    for (let i = 0; i < 7; i += 1) expect(packedCellAt(i)).toEqual(r.positions[i])
  })

  it('packedCellAt 行优先：第 4 个回到第 2 行第 1 列', () => {
    const first = packedCellAt(0)
    const fourth = packedCellAt(3)
    expect(fourth.x).toBe(first.x)
    expect(fourth.y).toBeGreaterThan(first.y)
  })

  it('有内容时容器最小尺寸不小于能容纳内容；空容器用类型最小尺寸', () => {
    expect(containerMinSize('group', 0)).toEqual(NODE_MINIMUMS.group)
    const one = containerMinSize('group', 1)
    expect(one.w).toBeGreaterThanOrEqual(PACKED_CELL.w)
    expect(one.h).toBeGreaterThanOrEqual(PACKED_CELL.h)
  })

  it('packedMinSize = 内容 + 四边等距（拖缩小手柄停在这里，再拖会遮住子节点）', () => {
    const four = packedMinSize(4)
    expect(four.w).toBeGreaterThan(240)
    expect(four).toEqual(containerMinSize('group', 4))
    // 2 个单元：456×200（而不是 5:4 归一后的 456×365）
    expect(packedMinSize(2)).toEqual({ w: 456, h: 200 })
  })

  /**
   * ★★ 放大容器 ⇒ **里面同步等比放大**（用户第 15 批 #335-①：
   * 「放大批量节点的话，里面的子节点和素材同步放大，这样才能保持留白规则」）。
   */
  describe('containerScale（放大时单元与素材一起放大）', () => {
    it('★ 正好等于基准网格 ⇒ 1（缩不到更小）', () => {
      const base = containerMinSize('batch', 2)
      expect(containerScale('batch', 2, base)).toBe(1)
      expect(containerScale('batch', 2, { w: base.w - 100, h: base.h - 100 })).toBe(1)
    })

    it('★★ 等比拉大 ⇒ 系数就是那个倍率（两轴同时满足才是等比）', () => {
      const base = containerMinSize('batch', 2)
      expect(containerScale('batch', 2, { w: base.w * 2, h: base.h * 2 })).toBe(2)
    })

    it('★ 只往一轴拉大 ⇒ 取 min（**不变形**：多出来的那一轴表现为更宽的留白）', () => {
      const base = containerMinSize('batch', 2)
      expect(containerScale('batch', 2, { w: base.w * 3, h: base.h })).toBe(1)
      expect(containerScale('batch', 2, { w: base.w * 3, h: base.h * 2 })).toBe(2)
    })
  })
})
