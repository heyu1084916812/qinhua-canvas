import { describe, it, expect } from 'vitest'
import {
  KEY_STEP,
  KEY_STEP_FAST,
  keyDelta,
  resizedByKey,
  sameRect,
  type BoxKeyRules,
} from './boxKeys'
import type { Rect } from '../geometry/rect'

/**
 * 键盘改框（§4.5「拖拽替代」/ §6.20）。
 *
 * 这一套的重点**不是**算术好不好看，而是"键盘改出来的尺寸必须与拖出来的尺寸同源"：
 * 最小尺寸、比例锁、高度归内容、批量网格比例四条，任何一条在键盘这条路上漏掉，
 * 都会出现"拖不动、但键盘能改出来"的假状态。
 */

const base: Rect = { x: 100, y: 50, w: 300, h: 200 }
const min = { w: 120, h: 96 }
const free: BoxKeyRules = { minSize: min, resizeLock: 'free' }

describe('keyDelta / 一档位移的方向', () => {
  it('右 / 下为 +，左 / 上为 −，另一轴恒 0', () => {
    expect(keyDelta('right', 1)).toEqual({ dx: 1, dy: 0 })
    expect(keyDelta('left', 1)).toEqual({ dx: -1, dy: 0 })
    expect(keyDelta('down', 1)).toEqual({ dx: 0, dy: 1 })
    expect(keyDelta('up', 1)).toEqual({ dx: 0, dy: -1 })
  })

  it('两档步长就是文档写的 1px / 10px（改了它就得改 §6.20 的表）', () => {
    expect(KEY_STEP).toBe(1)
    expect(KEY_STEP_FAST).toBe(10)
  })
})

describe('resizedByKey / 自由缩放：只有被按的那条边动', () => {
  it('右 = 变宽 1px，左上角不动', () => {
    expect(resizedByKey(base, 'right', 1, free)).toEqual({ x: 100, y: 50, w: 301, h: 200 })
  })

  it('左 = 变窄 1px（锚点仍是左上角，不做"左边往回收"）', () => {
    expect(resizedByKey(base, 'left', 1, free)).toEqual({ x: 100, y: 50, w: 299, h: 200 })
  })

  it('下 = 变高、上 = 变矮', () => {
    expect(resizedByKey(base, 'down', 1, free).h).toBe(201)
    expect(resizedByKey(base, 'up', 1, free).h).toBe(199)
  })

  it('加速档（Shift）= 一次 10px', () => {
    expect(resizedByKey(base, 'right', KEY_STEP_FAST, free).w).toBe(310)
  })
})

describe('resizedByKey / 最小尺寸：缩不下去就停在边界', () => {
  it('宽度撞下限后不再变小，且位置一动没动', () => {
    const atMin: Rect = { x: 100, y: 50, w: min.w, h: 200 }
    const next = resizedByKey(atMin, 'left', 1, free)
    expect(next).toEqual(atMin)
    expect(sameRect(next, atMin)).toBe(true)
  })

  it('高度撞下限同理', () => {
    const atMin: Rect = { x: 100, y: 50, w: 300, h: min.h }
    expect(resizedByKey(atMin, 'up', 1, free)).toEqual(atMin)
  })
})

describe('resizedByKey / 比例锁：与缩放手柄同一条链', () => {
  it('数字锁（产物真实比例）：拉宽时高度按比例跟随', () => {
    const next = resizedByKey(base, 'right', 10, { minSize: min, resizeLock: 1.5 })
    expect(next.w / next.h).toBeCloseTo(1.5, 5)
    expect(next.w).toBeGreaterThan(base.w)
  })

  it("'current' 锁（无像素的产物 / 对比节点）：用当前这一拍的比例", () => {
    const next = resizedByKey(base, 'down', 10, { minSize: min, resizeLock: 'current' })
    expect(next.w / next.h).toBeCloseTo(base.w / base.h, 5)
    expect(next.h).toBeGreaterThan(base.h)
  })
})

describe('resizedByKey / 高度归内容（循环节点）', () => {
  it('上下键什么都不改（高度由内容写回，键盘不许抢）', () => {
    const rect: Rect = { x: 1, y: 2, w: 300, h: 320 }
    const rules: BoxKeyRules = { ...free, heightFromContent: true, liveHeight: 320 }
    expect(resizedByKey(rect, 'down', 1, rules)).toEqual(rect)
    expect(resizedByKey(rect, 'up', 10, rules)).toEqual(rect)
  })

  it('左右键只改宽度；高度取**这一刻的实际值**（不是起手时的旧值）', () => {
    const rect: Rect = { x: 0, y: 0, w: 300, h: 380 }
    const rules: BoxKeyRules = { ...free, heightFromContent: true, liveHeight: 320 }
    const next = resizedByKey(rect, 'right', 10, rules)
    expect(next.w).toBe(310)
    expect(next.h).toBe(320)
  })
})

describe('resizedByKey / 批量网格比例', () => {
  const grid = { w: 640, h: 520 }

  it('拉大时宽高一起放大，且仍是网格的比例（整像素）', () => {
    const rect: Rect = { x: 0, y: 0, w: 640, h: 520 }
    const next = resizedByKey(rect, 'right', 100, {
      minSize: { w: 309, h: 252 },
      resizeLock: 'free',
      lockAspect: grid,
    })
    expect(next.w).toBeGreaterThan(grid.w)
    expect(next.w / next.h).toBeCloseTo(grid.w / grid.h, 2)
    expect(Number.isInteger(next.w)).toBe(true)
    expect(Number.isInteger(next.h)).toBe(true)
  })

  it('缩到网格尺寸就停住（k 的下限 = 1，再缩会遮住子节点）', () => {
    const rect: Rect = { x: 0, y: 0, w: grid.w, h: grid.h }
    const next = resizedByKey(rect, 'left', 50, {
      minSize: { w: 309, h: 252 },
      resizeLock: 'free',
      lockAspect: grid,
    })
    expect(next).toEqual(rect)
  })

  it('★ 单轴按键也要能放大（位移同时给两轴）—— 否则这条路在批量节点上等于失效', () => {
    const rect: Rect = { x: 0, y: 0, w: grid.w, h: grid.h }
    const next = resizedByKey(rect, 'right', 1, {
      minSize: { w: 309, h: 252 },
      resizeLock: 'free',
      lockAspect: grid,
    })
    expect(next.w).toBe(641)
    expect(next.h).toBe(521)
  })
})

describe('sameRect / 空命令判据', () => {
  it('逐字段相等才算同一拍（差 1px 就不是）', () => {
    expect(sameRect(base, { ...base })).toBe(true)
    expect(sameRect(base, { ...base, w: base.w + 1 })).toBe(false)
    expect(sameRect(base, { ...base, x: base.x - 1 })).toBe(false)
  })
})
