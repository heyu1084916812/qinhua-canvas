import { describe, it, expect } from 'vitest'
import { assetNodeSize, ASSET_NODE_MAX_SIDE } from './assetNodeSize'
import { NODE_MINIMUMS } from './constants'

const MIN = NODE_MINIMUMS.generation

describe('assetNodeSize（导入素材的节点尺寸）', () => {
  it('没有尺寸信息 → 直接用最小尺寸（不猜比例）', () => {
    expect(assetNodeSize(null)).toEqual(MIN)
    expect(assetNodeSize({})).toEqual(MIN)
    expect(assetNodeSize({ width: 0, height: 100 })).toEqual(MIN)
  })

  it('方图缩到长边上限，仍是方的', () => {
    const s = assetNodeSize({ width: 4000, height: 4000 })
    expect(s.w).toBe(ASSET_NODE_MAX_SIDE)
    expect(s.h).toBe(ASSET_NODE_MAX_SIDE)
  })

  it('横图：保持原始比例，且宽高都不小于最小尺寸', () => {
    const s = assetNodeSize({ width: 1600, height: 900 })
    expect(s.w / s.h).toBeCloseTo(1600 / 900, 1)
    expect(s.h).toBeGreaterThanOrEqual(MIN.h)
    expect(s.w).toBeGreaterThanOrEqual(MIN.w)
  })

  it('小图不会被拉大到超过上限（只放大到能放下最小尺寸）', () => {
    const s = assetNodeSize({ width: 64, height: 64 })
    expect(s.w).toBe(MIN.w)
    expect(s.h).toBe(MIN.h)
  })

  it('极端细长图不会算出一个比画布还宽的巨物（退回最小方框，由节点 cover 裁切）', () => {
    const s = assetNodeSize({ width: 2000, height: 40 })
    expect(s).toEqual(MIN)
  })

  it('返回值是整数（像素取整，避免落库后再取整的二次漂移）', () => {
    const s = assetNodeSize({ width: 1234, height: 777 })
    expect(Number.isInteger(s.w)).toBe(true)
    expect(Number.isInteger(s.h)).toBe(true)
  })

  it('不改传入的最小尺寸对象（返回副本）', () => {
    assetNodeSize({ width: 800, height: 600 })
    expect(NODE_MINIMUMS.generation).toEqual({ w: 240, h: 240 })
  })
})
