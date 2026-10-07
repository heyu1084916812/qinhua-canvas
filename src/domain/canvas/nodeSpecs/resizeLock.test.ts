import { describe, it, expect } from 'vitest'
import { resizeLockOf, lockedResize } from './resizeLock'
import { aspectLockedResize, freeResize } from './resizeLock'
import type { NodeSnapshot, GenerationData } from '../model/node'
import type { Rect } from '../geometry/rect'

/**
 * 只声明被测字段：缩放锁的解析与换算都只看 type / data 里的几个字段，
 * 其余用 as 补齐（与 store 测试里「最小平台桩」同一思路——不为了类型撒多余的数据）。
 */
function node(type: NodeSnapshot['type'], data: unknown): NodeSnapshot {
  return {
    id: 'n1',
    type,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    title: '',
    data,
  } as unknown as NodeSnapshot
}

const gen = (over: Partial<GenerationData>): GenerationData =>
  ({
    mode: 'image',
    prompt: '',
    linkedPromptNodeIds: [],
    channelId: 'c1',
    model: 'm1',
    ...over,
  }) as GenerationData

const min = { w: 120, h: 96 }

describe('resizeLockOf / 锁比解析（§6.16）', () => {
  it('有产物的生成节点锁产物真实比例', () => {
    const n = node('generation', gen({ assetHash: 'h1', naturalSize: { width: 1024, height: 512 } }))
    expect(resizeLockOf(n)).toBe(2)
  })

  it('空态生成节点自由缩放', () => {
    expect(resizeLockOf(node('generation', gen({})))).toBe('free')
  })

  it('有内容但缺 naturalSize：退回当前比例（不猜像素）', () => {
    expect(resizeLockOf(node('generation', gen({ assetHash: 'h1' })))).toBe('current')
  })

  it('分组 / 批量自由缩放（容器贴住内容，尺寸由动态最小尺寸守）', () => {
    expect(resizeLockOf(node('group', {}))).toBe('free')
    expect(resizeLockOf(node('batch', {}))).toBe('free')
  })

  it('对比节点锁按下时比例；提示词自由', () => {
    expect(resizeLockOf(node('compare', {}))).toBe('current')
    expect(resizeLockOf(node('prompt', {}))).toBe('free')
  })
})

describe('lockedResize / 等比换算', () => {
  const base = { x: 10, y: 20, w: 200, h: 160 } // 5:4

  it('横向拖动为主导时，高按 5:4 跟随', () => {
    const r = lockedResize(base, 100, 20, min, 5 / 4)
    expect(r.w).toBe(300)
    expect(r.h).toBe(240)
  })

  it('纵向拖动为主导时，宽按 5:4 跟随', () => {
    const r = lockedResize(base, 20, 80, min, 5 / 4)
    expect(r).toMatchObject({ h: 240, w: 300 })
  })

  it('锚点不动：x/y 恒等于起点', () => {
    const r = lockedResize(base, -60, -60, min, 5 / 4)
    expect(r.x).toBe(10)
    expect(r.y).toBe(20)
  })

  it('缩到最小尺寸以下按比例抬升，且不被逐轴 max 掰歪比例', () => {
    const r = lockedResize(base, -1000, 0, min, 5 / 4)
    expect(r.w).toBeGreaterThanOrEqual(min.w)
    expect(r.h).toBeGreaterThanOrEqual(min.h)
    expect(r.w / r.h).toBeCloseTo(5 / 4, 6)
  })

  it('拖到越过左上角（主导轴为负）也不会出负尺寸', () => {
    const r = lockedResize(base, -9999, -9999, min, 5 / 4)
    expect(r.w).toBeGreaterThan(0)
    expect(r.h).toBeGreaterThan(0)
    expect(r.w / r.h).toBeCloseTo(5 / 4, 6)
  })

  it('起手矩形偏离锁定比时，第一帧就归位到锁定比', () => {
    const square = { x: 0, y: 0, w: 200, h: 200 }
    const r = lockedResize(square, 0, 0, min, 5 / 4)
    expect(r.w / r.h).toBeCloseTo(5 / 4, 6)
  })
})

/**
 * 四角自由缩放（用户 2026-10-06 第 13 批第 5 条：「组给…四角可缩放」）。
 *
 * 判据的核心是**对角固定**：拖 `nw` 时右下角一个像素都不许动 —— 这条错了，
 * 用户看到的就是"拖左上角、整块跟着跑"。
 */
describe('freeResize / 四角自由缩放', () => {
  const base = { x: 100, y: 100, w: 400, h: 200 }

  it('右下：左上角不动', () => {
    const r = freeResize(base, 'se', 40, 20, min)
    expect(r).toEqual({ x: 100, y: 100, w: 440, h: 220 })
  })

  it('左上：右下角不动（x/y 跟着移，w/h 反向变）', () => {
    const r = freeResize(base, 'nw', 40, 20, min)
    expect(r.x + r.w).toBe(base.x + base.w)
    expect(r.y + r.h).toBe(base.y + base.h)
    expect(r).toEqual({ x: 140, y: 120, w: 360, h: 180 })
  })

  it('右上：左下角不动', () => {
    const r = freeResize(base, 'ne', 40, 20, min)
    expect(r.y + r.h).toBe(base.y + base.h)
    expect(r.x).toBe(base.x)
    expect(r).toEqual({ x: 100, y: 120, w: 440, h: 180 })
  })

  it('左下：右上角不动', () => {
    const r = freeResize(base, 'sw', 40, 20, min)
    expect(r.x + r.w).toBe(base.x + base.w)
    expect(r.y).toBe(base.y)
    expect(r).toEqual({ x: 140, y: 100, w: 360, h: 220 })
  })

  it('缩到最小：夹住尺寸但**对角仍不动**（不是拖到最小之后开始位移）', () => {
    /** 每一角"不动"的那一点：拖 se ⇒ 左上不动；拖 sw ⇒ 右上不动；拖 ne ⇒ 左下；拖 nw ⇒ 右下 */
    const fixed = {
      se: { x: base.x, y: base.y },
      sw: { x: base.x + base.w, y: base.y },
      ne: { x: base.x, y: base.y + base.h },
      nw: { x: base.x + base.w, y: base.y + base.h },
    } as const
    for (const corner of ['se', 'sw', 'ne', 'nw'] as const) {
      const west = corner === 'sw' || corner === 'nw'
      const north = corner === 'ne' || corner === 'nw'
      // "缩到最小"的位移方向逐角不同：往**节点内侧**推的是西/北那两条边
      const r = freeResize(base, corner, west ? 9999 : -9999, north ? 9999 : -9999, min)
      expect(r.w).toBe(min.w)
      expect(r.h).toBe(min.h)
      const anchor = { x: west ? r.x + r.w : r.x, y: north ? r.y + r.h : r.y }
      expect(anchor).toEqual(fixed[corner])
    }
  })
})

/**
 * 等比锁（用户第 17 批 #3：「批量节点还是不是等比例放大的」）：
 * 批量的框**永远等于网格 × 一个等比系数** —— 长的那一轴不再空出一大片。
 */
describe('aspectLockedResize / 批量框的等比锁', () => {
  /** 3 格的网格基准（= `containerMinSize('batch', 3)`）*/
  const grid = { w: 672, h: 200 }
  const start: Rect = { x: 100, y: 100, w: 672, h: 200 }

  it('★★ 只有一轴被拉长时，另一轴按网格比例跟着长（不留死白）', () => {
    /** 往右拉 328、往下拉 400：宽比 1.488、高比 3 ⇒ 取小的那个（宽比） */
    const free = freeResize(start, 'se', 328, 400, grid)
    const r = aspectLockedResize(free, 'se', grid)
    expect(r.w / r.h).toBeCloseTo(grid.w / grid.h, 2)
    expect(r.w).toBe(Math.round(grid.w * (1000 / 672)))
    /** 框的宽高都跟着变大，但比例恒等于网格 */
    expect(r.w).toBeGreaterThan(start.w)
    expect(r.h).toBeGreaterThan(start.h)
  })

  it('★ 锚点 = 被拖角的对角（四角都试一遍）', () => {
    for (const corner of ['se', 'sw', 'ne', 'nw'] as const) {
      const free = freeResize(start, corner, -200, -80, grid)
      const r = aspectLockedResize(free, corner, grid)
      const west = corner === 'sw' || corner === 'nw'
      const north = corner === 'ne' || corner === 'nw'
      const anchor = { x: west ? r.x + r.w : r.x, y: north ? r.y + r.h : r.y }
      const fixed = {
        se: { x: start.x, y: start.y },
        sw: { x: start.x + start.w, y: start.y },
        ne: { x: start.x, y: start.y + start.h },
        nw: { x: start.x + start.w, y: start.y + start.h },
      }[corner]
      /** 取整会带来 <1px 的误差 ⇒ 比"比例相对误差 < 1%" */
      expect(Math.abs(r.w / r.h / (grid.w / grid.h) - 1)).toBeLessThan(0.01)
      expect(anchor.x).toBeCloseTo(fixed.x, 6)
      expect(anchor.y).toBeCloseTo(fixed.y, 6)
    }
  })

  it('★ 缩不到网格以下（下限就是基准，与最小尺寸同源）', () => {
    const free = freeResize(start, 'se', -9999, -9999, grid)
    const r = aspectLockedResize(free, 'se', grid)
    expect(r.w).toBe(grid.w)
    expect(r.h).toBe(grid.h)
  })
})
