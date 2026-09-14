import { describe, it, expect } from 'vitest'
import { dragAxis, dragIntent, dragTurnOffset, dragTurnThreshold, dragTurnVerdict } from './dragNav'
import type { DragTurnInput } from './dragNav'

const input = (over: Partial<DragTurnInput> = {}): DragTurnInput => ({
  dx: 0,
  dy: 0,
  width: 720,
  direction: 'ltr',
  hasPrev: true,
  hasNext: true,
  ...over,
})

describe('dragAxis / 手势主轴', () => {
  it('横向为主 → x（接管翻页）', () => {
    expect(dragAxis(-140, 12)).toBe('x')
  })

  it('纵向为主 → y（留给滚动，不翻页）', () => {
    expect(dragAxis(10, 120)).toBe('y')
  })

  it('完全相等判给横向（水平拖动显然是想翻页）', () => {
    expect(dragAxis(30, 30)).toBe('x')
    expect(dragAxis(-30, 30)).toBe('x')
  })

  it('非数值输入按 0 处理，不抛错', () => {
    expect(dragAxis(Number.NaN, Number.NaN)).toBe('x')
  })
})

describe('dragTurnThreshold / 翻页阈值', () => {
  it('宽屏按 28% 但不超过 120', () => {
    expect(dragTurnThreshold(720)).toBe(120)
    expect(dragTurnThreshold(1200)).toBe(120)
  })

  it('窄屏不低于 48（不至于一碰就翻）', () => {
    expect(dragTurnThreshold(100)).toBe(48)
    expect(dragTurnThreshold(0)).toBe(48)
  })

  it('中间档按比例', () => {
    expect(dragTurnThreshold(300)).toBeCloseTo(84)
  })
})

describe('dragIntent / 屏幕方向 → 叙事位移', () => {
  it('LTR：往左拖 = 下一页（+1）', () => {
    expect(dragIntent(input({ dx: -140 }))).toEqual({ delta: 1, blocked: false })
  })

  it('LTR：往右拖 = 上一页（-1）', () => {
    expect(dragIntent(input({ dx: 140 }))).toEqual({ delta: -1, blocked: false })
  })

  it('RTL：往右拖才是下一页（与「rtl 下 ← 前进」同源）', () => {
    expect(dragIntent(input({ dx: 140, direction: 'rtl' }))).toEqual({ delta: 1, blocked: false })
    expect(dragIntent(input({ dx: -140, direction: 'rtl' }))).toEqual({ delta: -1, blocked: false })
  })

  it('没位移 / 纵向手势 → null（不接管）', () => {
    expect(dragIntent(input({ dx: 0 }))).toBeNull()
    expect(dragIntent(input({ dx: 10, dy: 90 }))).toBeNull()
  })

  it('到边界即 blocked：末页还想往后、首页还想往前', () => {
    expect(dragIntent(input({ dx: -140, hasNext: false }))).toEqual({ delta: 1, blocked: true })
    expect(dragIntent(input({ dx: 140, hasPrev: false }))).toEqual({ delta: -1, blocked: true })
  })
})

describe('dragTurnOffset / 跟手位移', () => {
  it('跟手但不是 1:1（留一点「页被拽住」的重量感）', () => {
    expect(dragTurnOffset(input({ dx: -50 }))).toBeCloseTo(-27.5)
  })

  it('拖到天边也只挪 ±72（页不会被拽飞）', () => {
    expect(dragTurnOffset(input({ dx: -400 }))).toBe(-72)
    expect(dragTurnOffset(input({ dx: 400 }))).toBe(72)
  })

  it('越界方向阻尼明显更小（手感上就是「拖不动」）', () => {
    const free = Math.abs(dragTurnOffset(input({ dx: -140 })))
    const blocked = Math.abs(dragTurnOffset(input({ dx: 140, hasPrev: false })))
    expect(blocked).toBeLessThan(free)
    expect(blocked).toBeCloseTo(30.8)
  })

  it('纵向手势 / 没位移 → 0（完全不跟手）', () => {
    expect(dragTurnOffset(input({ dx: 10, dy: 90 }))).toBe(0)
    expect(dragTurnOffset(input({ dx: 0 }))).toBe(0)
  })
})

describe('dragTurnVerdict / 松手判定', () => {
  it('拖过阈值 → 翻一页（返回叙事位移）', () => {
    expect(dragTurnVerdict(input({ dx: -140 }))).toBe(1)
    expect(dragTurnVerdict(input({ dx: 140 }))).toBe(-1)
  })

  it('RTL 下判定同样镜像', () => {
    expect(dragTurnVerdict(input({ dx: 140, direction: 'rtl' }))).toBe(1)
    expect(dragTurnVerdict(input({ dx: -140, direction: 'rtl' }))).toBe(-1)
  })

  it('没拖够 → 回弹（null，不翻）', () => {
    expect(dragTurnVerdict(input({ dx: -20 }))).toBeNull()
  })

  it('到边界 → 拖了也不翻（与按钮禁用同源）', () => {
    expect(dragTurnVerdict(input({ dx: -140, hasNext: false }))).toBeNull()
    expect(dragTurnVerdict(input({ dx: 140, hasPrev: false }))).toBeNull()
  })

  it('纵向手势 → 不接管', () => {
    expect(dragTurnVerdict(input({ dx: 10, dy: 200 }))).toBeNull()
  })

  it('阈值随舞台宽度走：窄舞台上同样的位移可能就够翻了', () => {
    expect(dragTurnVerdict(input({ dx: -60, width: 720 }))).toBeNull()
    expect(dragTurnVerdict(input({ dx: -60, width: 160 }))).toBe(1)
  })
})
