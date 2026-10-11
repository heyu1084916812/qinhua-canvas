import { describe, expect, it } from 'vitest'
import { addTile, LONG_IMAGE_WIDTH, moveTile, planLongImage, removeTile } from './longImage'

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

/**
 * 长图编排（对账 #426）：哪几张、按什么顺序。
 *
 * 三个动作都要求"没变化就返回**同一个引用**" —— 那是 React 不重复渲染的判据，
 * 也是这类编辑动作最容易写漏的一处（返回新数组会让每次点击都重拼一遍长图）。
 */
describe('长图编排', () => {
  /** 自然序（结果落库的顺序）：下面所有"原样返回"都比**第一个参数**那个引用 */
  const ids = ['a', 'b', 'c'] as const

  it('★ 上移 / 下移一位', () => {
    expect(moveTile(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveTile(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('★★ 越界不动、且返回**原引用**（到头了还点，不该重拼长图）', () => {
    expect(moveTile(ids, 'a', -1)).toBe(ids)
    expect(moveTile(ids, 'c', 1)).toBe(ids)
    expect(moveTile(ids, 'a', 0)).toBe(ids)
    expect(moveTile(ids, '不存在', -1)).toBe(ids)
  })

  it('★ 移出 / 加回来', () => {
    expect(removeTile(ids, 'b')).toEqual(['a', 'c'])
    expect(removeTile(ids, '不存在')).toBe(ids)
    expect(addTile(['a', 'c'], 'b', ids)).toEqual(['a', 'b', 'c'])
  })

  it('★★ 加回来按**自然位置**落位：插在"第一个自然序比它靠后"的元素之前', () => {
    /* 移出第 2 段再加回来：它应当回到第 2 位，而不是跑到最后 */
    expect(addTile(['a', 'c'], 'b', ids)).toEqual(['a', 'b', 'c'])
    /*
     * 用户把顺序调成了 c,a 之后再加回 b：按这条规则它插在 c 之前（b 的自然序在 c 前面），
     * 于是 b→c 这对自然相邻关系被保住，而不是被接到末尾（那会变成 c,a,b、把 b→c 拆开）。
     * **如实记下**：这个二阶场景本身没有唯一正确答案，规则只要**明确 + 稳定**即可。
     */
    expect(addTile(['c', 'a'], 'b', ids)).toEqual(['b', 'c', 'a'])
  })

  it('★★ 已经在里面 / 不认识 / 重复点，都原样返回原引用', () => {
    expect(addTile(ids, 'b', ids)).toBe(ids)
    /* ⚠️ "原样返回"返的是**第一个参数**（当前编排），不是自然序那个 —— 第一版这里比错了对象 */
    const current = ['a', 'c']
    expect(addTile(current, '不存在', ids)).toBe(current)
    expect(addTile(current, 'a', ids)).toBe(current)
    expect(removeTile(['a'], 'a')).toEqual([])
  })

  it('★ 编排之后拼出来的长图：高度按留下的那几张算，顺序就是给进去的顺序', () => {
    const all = [
      { id: 'a', width: 1920, height: 1000 },
      { id: 'b', width: 1920, height: 2000 },
      { id: 'c', width: 1920, height: 500 },
    ]
    const order = moveTile(removeTile(['a', 'b', 'c'], 'b'), 'c', -1)
    expect(order).toEqual(['c', 'a'])
    const plan = planLongImage(
      (order as readonly string[]).map((id) => all.find((t) => t.id === id)!),
    )
    expect(plan.tiles.map((t) => t.id)).toEqual(['c', 'a'])
    expect(plan.tiles[0]!.y).toBe(0)
    expect(plan.tiles[1]!.y).toBe(500)
    expect(plan.height).toBe(1500)
  })
})
