import { describe, expect, it } from 'vitest'
import { LONG_IMAGE_WIDTH, planLongImage } from './longImage'

/**
 * 详情页长图排版（对账 #420）。
 *
 * 这一层守的是"拼出来的图与产物对得上"：宽度一律 1920、每张等比、首尾相接、
 * 尺寸未知的跳过并如实报数 —— 错一点在几百万像素的画布上肉眼看不出来。
 */
describe('planLongImage', () => {
  it('★ 宽度固定 1920，每张按宽度等比缩放（不留横向空隙）', () => {
    const plan = planLongImage([
      { id: 'a', width: 1200, height: 800 },
      { id: 'b', width: 800, height: 1600 },
    ])
    expect(plan.width).toBe(LONG_IMAGE_WIDTH)
    expect(plan.tiles[0]).toEqual({ id: 'a', x: 0, y: 0, w: 1920, h: 1280 })
    expect(plan.tiles[1]).toEqual({ id: 'b', x: 0, y: 1280, w: 1920, h: 3840 })
    expect(plan.height).toBe(5120)
    expect(plan.skipped).toEqual([])
  })

  it('★ 竖向首尾相接：y 依次累加，总高 = 最后一张的底边', () => {
    const plan = planLongImage(
      [1, 2, 3].map((i) => ({ id: `s${i}`, width: 1920, height: 500 })),
    )
    expect(plan.tiles.map((t) => t.y)).toEqual([0, 500, 1000])
    expect(plan.height).toBe(1500)
  })

  it('gap 可配（详情页默认 0）；给了 gap 就加在两张之间，末尾不加', () => {
    const sources = [1, 2].map((i) => ({ id: `s${i}`, width: 100, height: 100 }))
    const tight = planLongImage(sources)
    expect(tight.height).toBe(2 * 1920)
    const spaced = planLongImage(sources, { gap: 40 })
    expect(spaced.tiles.map((t) => t.y)).toEqual([0, 1920 + 40])
    expect(spaced.height).toBe(1920 * 2 + 40)
  })

  it('★★ 尺寸未知 / 非法的一律跳过并如实报出来（不按"大概比例"塞占位高度）', () => {
    const plan = planLongImage([
      { id: 'ok', width: 1920, height: 400 },
      { id: 'zero', width: 0, height: 400 },
      { id: 'nag', width: 100, height: -1 },
      { id: 'nan', width: Number.NaN, height: 100 },
      { id: 'inf', width: Number.POSITIVE_INFINITY, height: 100 },
    ])
    expect(plan.tiles.map((t) => t.id)).toEqual(['ok'])
    expect(plan.skipped).toEqual(['zero', 'nag', 'nan', 'inf'])
    expect(plan.height).toBe(400)
  })

  it('空输入 ⇒ 高度 0、没有图块（界面据此显示空态，而不是画一张 1px 的图）', () => {
    expect(planLongImage([])).toEqual({ width: LONG_IMAGE_WIDTH, height: 0, tiles: [], skipped: [] })
  })

  it('宽度可覆盖（比如 750 的移动端详情页）；非法宽度回落下限 200', () => {
    const plan = planLongImage([{ id: 'a', width: 1000, height: 1000 }], { width: 750 })
    expect(plan.width).toBe(750)
    expect(plan.tiles[0]!.h).toBe(750)
    const tiny = planLongImage([{ id: 'a', width: 1000, height: 1000 }], { width: 10 })
    expect(tiny.width).toBe(200)
  })

  it('精度：奇数比例四舍五入到整像素，累计高度用整像素（画布不接受小数）', () => {
    const plan = planLongImage([
      { id: 'a', width: 3, height: 4 },
      { id: 'b', width: 7, height: 3 },
    ])
    expect(plan.tiles[0]!.h).toBe(Math.round((4 * 1920) / 3))
    expect(plan.tiles[1]!.h).toBe(Math.round((3 * 1920) / 7))
    expect(plan.height).toBe(plan.tiles[0]!.h + plan.tiles[1]!.h)
  })
})
