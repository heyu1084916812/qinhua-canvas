import { describe, it, expect } from 'vitest'
import { resizeLockOf, lockedResize } from './resizeLock'
import type { NodeSnapshot, GenerationData } from '../model/node'

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

  it('分组 / 批量锁 5:4', () => {
    expect(resizeLockOf(node('group', {}))).toBe(5 / 4)
    expect(resizeLockOf(node('batch', {}))).toBe(5 / 4)
  })

  it('对比节点锁按下时比例；提示词 / 画板自由', () => {
    expect(resizeLockOf(node('compare', {}))).toBe('current')
    expect(resizeLockOf(node('prompt', {}))).toBe('free')
    expect(resizeLockOf(node('board', {}))).toBe('free')
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
