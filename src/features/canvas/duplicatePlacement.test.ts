import { describe, expect, it } from 'vitest'
import { DUPLICATE_GAP, noOverlapDelta, type PlacedRect } from './duplicatePlacement'

/**
 * 复制落位（用户 2026-10-05 第 3 批：「创建副本……不要遮住画布上的节点」）。
 *
 * 原来所有入口写死 `+24/+24`：240×240 的生成节点会重叠 **216×216 = 46656 px²**，
 * 用户看到的是「点完复制好像什么都没发生」。这个纯函数给出的位移必须满足
 * 「移完之后，被复制的每个矩形都不与集合外的任何矩形相交」。
 */

const rect = (x: number, y: number, w = 240, h = 240): PlacedRect => ({ x, y, w, h })

function anyOverlap(moved: readonly PlacedRect[], others: readonly PlacedRect[]): boolean {
  return moved.some((a) =>
    others.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
  )
}

function apply(src: readonly PlacedRect[], delta: { dx: number; dy: number }): PlacedRect[] {
  return src.map((r) => ({ ...r, x: r.x + delta.dx, y: r.y + delta.dy }))
}

describe('noOverlapDelta', () => {
  it('★ 旁边没东西：往右挪一格（宽 + 缝），不是原来那个 24px 的斜角', () => {
    const src = [rect(0, 0)]
    const d = noOverlapDelta(src, [])
    expect(d).toEqual({ dx: 240 + DUPLICATE_GAP, dy: 0 })
  })

  it('★★ 右边被占：落到下面，仍然不相交', () => {
    const src = [rect(0, 0)]
    const right = rect(0 + 240 + DUPLICATE_GAP, 0)
    const d = noOverlapDelta(src, [right])
    const moved = apply(src, d)
    expect(anyOverlap(moved, [right])).toBe(false)
    expect(d.dx).toBe(0)
    expect(d.dy).toBeGreaterThan(0)
  })

  it('★★ 右边和下面都被占：继续往右下找空位', () => {
    const src = [rect(0, 0)]
    const right = rect(280, 0)
    const below = rect(0, 280)
    const d = noOverlapDelta(src, [right, below])
    expect(anyOverlap(apply(src, d), [right, below])).toBe(false)
  })

  it('★★ 一组节点：整组保持相对位置，且不与集合外的节点相交', () => {
    const src = [rect(0, 0), rect(300, 0)]
    const other = rect(0, 600)
    const d = noOverlapDelta(src, [other])
    const moved = apply(src, d)
    expect(moved[1]!.x - moved[0]!.x).toBe(300)
    expect(moved[1]!.y - moved[0]!.y).toBe(0)
    expect(anyOverlap(moved, [other])).toBe(false)
  })

  it('★ 空输入：退回一个默认间距（不崩、不返回 0 位移）', () => {
    expect(noOverlapDelta([], [rect(0, 0)])).toEqual({ dx: DUPLICATE_GAP, dy: 0 })
  })

  it('★ 位置被围死时也给一个确定结果（不返回 0 位移，免得又压回原件上）', () => {
    const src = [rect(0, 0)]
    const others: PlacedRect[] = []
    for (let i = 0; i < 40; i += 1) others.push(rect(280 * i, 0))
    const d = noOverlapDelta(src, others)
    expect(d.dx !== 0 || d.dy !== 0).toBe(true)
  })
})
