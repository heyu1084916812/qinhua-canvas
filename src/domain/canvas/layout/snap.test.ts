import { describe, expect, it } from 'vitest'
import { computeSnap, SNAP_THRESHOLD_SCREEN_PX } from './snap'

/**
 * 节点吸附对齐（对账 #257）。用户定下的口径：**边缘吸附**（不吸中心 / 不吸网格）、
 * **参考线 + 间距数字都要**、触发距离**默认 8px**。
 *
 * 这里全是"差 1px 就吸不上 / 吸过头"这类只有真拖动才看得见的事 —— 正是纯函数该钉的地方。
 */
const box = (x: number, y: number, w = 240, h = 240) => ({ x, y, w, h })

describe('computeSnap · 边缘吸附', () => {
  it('★★ 左边缘差 5px（阈值内）⇒ 吸成完全对齐，并给出一条竖参考线', () => {
    const r = computeSnap({
      moving: [box(205, 600)],
      others: [box(200, 100)],
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r.dx).toBe(-5)
    expect(r.dy).toBe(0)
    expect(r.guides).toHaveLength(1)
    expect(r.guides[0]).toMatchObject({ axis: 'x', at: 200 })
  })

  it('★★ 差 9px（超出阈值）⇒ **不吸**（"不吸"也是正确结果，别为了看起来智能就放宽）', () => {
    const r = computeSnap({
      moving: [box(209, 600)],
      others: [box(200, 100)],
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r).toEqual({ dx: 0, dy: 0, guides: [], gaps: [] })
  })

  it('★★ 右边缘对左边缘（首尾相接）也算边缘对齐：差 4px ⇒ 吸上', () => {
    const r = computeSnap({
      moving: [box(444, 100)], // 右沿 684，目标左沿 680
      others: [box(680, 100)],
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r.dx).toBe(-4)
    expect(r.guides[0]!.at).toBe(680)
  })

  it('★ 只吸边缘、**不吸中心**：中心对齐但边缘差很远时不吸', () => {
    const r = computeSnap({
      moving: [box(320, 100)], // 中心 440
      others: [box(200, 600)], // 中心 320 ⇒ 若支持中心吸附，x 会吸到 320-120=200 附近
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r.dx).toBe(0)
  })

  it('★ 两个方向同时吸（横竖各有一次对齐）', () => {
    const r = computeSnap({
      moving: [box(203, 397)],
      others: [box(200, 400)],
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r.dx).toBe(-3)
    expect(r.dy).toBe(3)
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'y'])
  })

  it('★ 参考线要**穿过参与对齐的那些节点**（不是只画自己那一截）', () => {
    const r = computeSnap({
      moving: [box(203, 600, 240, 240)],
      others: [box(200, 100, 240, 240), box(200, 900, 240, 240)],
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    const guide = r.guides[0]!
    expect(guide.axis).toBe('x')
    // 上面那个从 100 起、下面那个到 1140 止 ⇒ 线要覆盖 100..1140
    expect(guide.from).toBe(100)
    expect(guide.to).toBe(1140)
  })

  it('★ 多选整组一起吸：以最接近的那枚为准', () => {
    const r = computeSnap({
      moving: [box(500, 100), box(206, 400)],
      others: [box(200, 700)],
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r.dx).toBe(-6)
  })

  it('候选为空（画布上只有它一个）⇒ 什么都不做', () => {
    expect(
      computeSnap({ moving: [box(10, 10)], others: [], threshold: 8 }),
    ).toEqual({ dx: 0, dy: 0, guides: [], gaps: [] })
  })
})

describe('computeSnap · 间距数字（参考图里那个"108"）', () => {
  it('★★ 横向相邻：给出两者之间的净距离，徽标落在间隙的横跨中点 + 重叠区上沿', () => {
    const r = computeSnap({
      /**
       * 纵向差 8（正好在阈值上）⇒ 先被吸附对齐（`dy = -8`），这正是参考图里的情形：
       * 两个节点顶边一对齐，中间那个"108"就出来了。
       *
       * ⚠️ 间距数字**只在吸住时出现**（对齐两个节点时才有"间距"这个概念要读）；
       * 所以这一条不能把纵向也拉开——那样两个轴都不吸，读数一个都不会有。
       */
      moving: [box(200, 140, 240, 400)], // 右沿 440
      others: [box(548, 132, 240, 400)], // 左沿 548 ⇒ 间距 108（正是参考图那个数）
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r.dy).toBe(-8) // 顶边对齐
    const gap = r.gaps.find((g) => g.axis === 'x')!
    expect(gap.value).toBe(108)
    expect(gap.x).toBe((440 + 548) / 2)
    expect(gap.y).toBe(132) // 吸附后的重叠区上沿（132..532 与 132..532）
  })

  it('★★ 纵向相邻：给出竖直间隙（节点上下叠放时按同一套算）', () => {
    const r = computeSnap({
      moving: [box(100, 200, 240, 240)], // 下沿 440
      others: [box(100, 512, 240, 240)], // 上沿 512 ⇒ 间距 72
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    const gap = r.gaps.find((g) => g.axis === 'y')!
    expect(gap.value).toBe(72)
    expect(gap.y).toBe((440 + 512) / 2)
  })

  it('★ 垂直于间距的方向上**没有重叠** ⇒ 不报间距（错开的两个节点之间没有"间距"）', () => {
    const r = computeSnap({
      moving: [box(200, 100)],
      others: [box(200, 900)], // 纵向完全错开
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    expect(r.gaps.find((g) => g.axis === 'x')).toBeUndefined()
  })

  it('★ 数字取**最近的那个**邻居（一次只出一个，避免满屏徽标）', () => {
    const r = computeSnap({
      moving: [box(200, 100, 240, 240)],
      others: [box(500, 100, 240, 240), box(460, 100, 240, 240)],
      threshold: SNAP_THRESHOLD_SCREEN_PX,
    })
    const gap = r.gaps.find((g) => g.axis === 'x')!
    expect(gap.value).toBe(20) // 440 → 460
  })
})
