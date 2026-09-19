import { describe, it, expect } from 'vitest'
import { NO_MAGNET, portMagnet } from './portMagnet'

/** 与 NodeFrame 的 MAGNET_OPTS 同值（半径 68 = 命中区 30 的两倍多，用户 2026-09-19 放大） */
const OPTS = { radius: 68, maxPull: 8 }
const CENTER = { x: 100, y: 100 }

describe('端点磁吸（§6.14）', () => {
  it('指针远离感应圈 → 不感应、零位移', () => {
    const r = portMagnet(CENTER, { x: 300, y: 300 }, OPTS)
    expect(r).toEqual(NO_MAGNET)
    expect(r.hot).toBe(false)
  })

  it('★ 指针在感应圈外一点点 → 仍不感应（边界不提前触发）', () => {
    expect(portMagnet(CENTER, { x: 100 + 68.001, y: 100 }, OPTS).hot).toBe(false)
    expect(portMagnet(CENTER, { x: 100 + 90, y: 100 }, OPTS).hot).toBe(false)
  })

  it('★ 正好落在感应圈上 → 算感应到（闭区间，避免边界漂移）', () => {
    const r = portMagnet(CENTER, { x: 100 + 68, y: 100 }, OPTS)
    expect(r.hot).toBe(true)
    expect(r.dx).toBeCloseTo(0, 5)
  })

  it('★ 吸附方向 = 从圆心指向指针（取反会变成「躲开指针」）', () => {
    const right = portMagnet(CENTER, { x: 140, y: 100 }, OPTS)
    expect(right.dx).toBeGreaterThan(0)
    expect(right.dy).toBeCloseTo(0, 6)

    const left = portMagnet(CENTER, { x: 60, y: 100 }, OPTS)
    expect(left.dx).toBeLessThan(0)
  })

  it('★ 吸附量随距离衰减：越靠近圆心吸得越多', () => {
    const near = portMagnet(CENTER, { x: 105, y: 100 }, OPTS)
    const mid = portMagnet(CENTER, { x: 134, y: 100 }, OPTS)
    const far = portMagnet(CENTER, { x: 160, y: 100 }, OPTS)
    expect(near.dx).toBeGreaterThan(mid.dx)
    expect(mid.dx).toBeGreaterThan(far.dx)
    expect(far.dx).toBeGreaterThanOrEqual(0)
  })

  it('★ 位移不超过上限（否则端点会离节点边框太远、读不出归属）', () => {
    for (const x of [100, 101, 105, 110, 140, 167]) {
      const r = portMagnet(CENTER, { x, y: 100 }, OPTS)
      expect(Math.hypot(r.dx, r.dy)).toBeLessThanOrEqual(OPTS.maxPull + 1e-9)
    }
  })

  it('圆心重合 → 算感应到但不位移（无方向可言）', () => {
    const r = portMagnet(CENTER, { x: 100, y: 100 }, OPTS)
    expect(r).toEqual({ hot: true, dx: 0, dy: 0 })
  })

  it('斜向靠近也按真实距离判定，不是分轴各算各的', () => {
    // 斜向距离 ≈ 67.9 < 68 → 感应到；若误用 |dx|+|dy| 会得到 96 判成没感应
    const diag = portMagnet(CENTER, { x: 148, y: 148 }, OPTS)
    expect(diag.hot).toBe(true)
    expect(diag.dx).toBeGreaterThan(0)
    expect(diag.dy).toBeGreaterThan(0)
  })

  it('半径外的斜向点不感应（与轴向同一口径）', () => {
    expect(portMagnet(CENTER, { x: 170, y: 170 }, OPTS).hot).toBe(false)
  })
})
