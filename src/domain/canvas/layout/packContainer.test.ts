import { describe, it, expect } from 'vitest'
import { packContainerChildren, packedCellAt, packedMinSize, containerMinSize } from './packContainer'
import { PACKED_CELL, NODE_MINIMUMS } from './constants'

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

  it('容器最小尺寸装得下全部单元，且保持 5:4', () => {
    for (let n = 1; n <= 12; n += 1) {
      const r = packContainerChildren(n)
      const maxX = Math.max(...r.positions.map((p) => p.x + PACKED_CELL.w))
      const maxY = Math.max(...r.positions.map((p) => p.y + PACKED_CELL.h))
      expect(r.containerMin.w).toBeGreaterThanOrEqual(maxX)
      expect(r.containerMin.h).toBeGreaterThanOrEqual(maxY)
      expect(r.containerMin.w / r.containerMin.h).toBeCloseTo(5 / 4, 2)
    }
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

  it('packedMinSize 增长时吃下内容、收缩时停在最小，且始终 5:4', () => {
    // 内容比容器大：最小尺寸放大
    const grew = packedMinSize({ w: 240, h: 192 }, 4)
    expect(grew.w).toBeGreaterThan(240)
    // 已被拉得很大后再缩：停在能容纳内容的动态最小值
    const shrank = packedMinSize({ w: 2000, h: 1600 }, 2)
    const target = containerMinSize('group', 2)
    expect(shrank.w).toBeCloseTo(target.w, 0)
    expect(shrank.h).toBeCloseTo(target.h, 0)
    for (const s of [grew, shrank]) expect(s.w / s.h).toBeCloseTo(5 / 4, 2)
  })
})
