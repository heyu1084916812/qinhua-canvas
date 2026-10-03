import { describe, expect, it } from 'vitest'
import { takesWheel, wheelBelongsToChain, type WheelChainNode } from './wheelTarget'

const node = (over: Partial<WheelChainNode> = {}): WheelChainNode => ({
  overflowY: 'visible',
  scrollHeight: 100,
  clientHeight: 100,
  ...over,
})

/**
 * 用户 2026-10-03 报的 bug：「面板如果有多余的地方的话用滚轮无法下拉，而是缩放画布了」。
 *
 * 这组用例钉的是**让路的边界**：让给谁、什么时候不让 ——
 * 判错任一边的后果都是用户能一眼看到的（要么浮层滚不动，要么画布缩放失灵）。
 */
describe('滚轮归属 · 可滚动区域优先于画布缩放', () => {
  it('★ 能滚的容器（auto + 内容超出）自己吃滚轮', () => {
    expect(takesWheel(node({ overflowY: 'auto', scrollHeight: 593, clientHeight: 437 }))).toBe(true)
    expect(takesWheel(node({ overflowY: 'scroll', scrollHeight: 200, clientHeight: 100 }))).toBe(true)
  })

  it('★ 声明了「我吃滚轮」的菜单，即使没得滚也拦下', () => {
    expect(takesWheel(node({ overflowY: 'visible', wheelOwner: true }))).toBe(true)
  })

  it('★ 内容装得下的 `auto` 容器不拦（没必要让画布缩放失灵）', () => {
    expect(takesWheel(node({ overflowY: 'auto', scrollHeight: 100, clientHeight: 100 }))).toBe(false)
    /** 子像素：差不到 1px 不算「有得滚」 */
    expect(takesWheel(node({ overflowY: 'auto', scrollHeight: 100.4, clientHeight: 100 }))).toBe(false)
  })

  it('★ 普通容器（visible / hidden / clip）不拦', () => {
    for (const oy of ['visible', 'hidden', 'clip']) {
      expect(takesWheel(node({ overflowY: oy })), oy).toBe(false)
    }
  })

  it('★★ 祖先链上任何一处能滚，滚轮就不归画布', () => {
    const chain = [
      node({ overflowY: 'visible' }),
      node({ overflowY: 'visible' }),
      node({ overflowY: 'auto', scrollHeight: 900, clientHeight: 400 }),
    ]
    expect(wheelBelongsToChain(chain)).toBe(true)
  })

  it('★ 整条链都不能滚 → 滚轮归画布（缩放照常）', () => {
    expect(wheelBelongsToChain([node(), node({ overflowY: 'hidden' })])).toBe(false)
    expect(wheelBelongsToChain([])).toBe(false)
  })
})
