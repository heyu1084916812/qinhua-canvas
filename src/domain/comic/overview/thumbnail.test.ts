import { describe, it, expect } from 'vitest'
import { hasThumbArt, overviewCells, pageBadgeText } from './thumbnail'
import type { ComicPage, ComicPanel, LayoutNode } from '../model/comicProject'

const leaf = (panelId: string): LayoutNode => ({ kind: 'panel', panelId })
const cut = (direction: 'h' | 'v', children: LayoutNode[]): LayoutNode => ({
  kind: 'cut',
  direction,
  position: 'equal',
  count: children.length,
  children,
})
const panel = (id: string, assetHash?: string): ComicPanel => ({
  id,
  scene: '',
  shot: { framing: 'medium', angle: 'eye-level' },
  characterIds: [],
  balloons: [],
  runs: [],
  ...(assetHash ? { assetHash } : {}),
})
/** 版式可传单节点或数组（单节点自动包一层，测试里少写一对括号） */
const page = (layout: LayoutNode | LayoutNode[], pool: ComicPanel[] = []): ComicPage => ({
  id: 'page-1',
  index: 0,
  title: '',
  layout: Array.isArray(layout) ? layout : [layout],
  panels: pool,
})

describe('overviewCells / 缩略视图模型', () => {
  it('未排版（空版式）返回空数组——调用方据此显示占位', () => {
    expect(overviewCells(page([], [panel('a')]))).toEqual([])
  })

  it('单格：几何满页 + 阅读序号 1', () => {
    const cells = overviewCells(page([leaf('a')], [panel('a')]))
    expect(cells).toHaveLength(1)
    expect(cells[0].x).toBe(0)
    expect(cells[0].y).toBe(0)
    expect(cells[0].w).toBe(1)
    expect(cells[0].h).toBe(1)
    expect(cells[0].order).toBe(1)
  })

  it('竖切两格：LTR 下按「左 → 右」输出（DOM 顺序 = 阅读顺序）', () => {
    const cells = overviewCells(page(cut('v', [leaf('a'), leaf('b')]), [panel('a'), panel('b')]))
    expect(cells.map((c) => c.panelId)).toEqual(['a', 'b'])
    expect(cells.map((c) => c.order)).toEqual([1, 2])
  })

  it('同一版式切 RTL：输出顺序镜像（几何不动，只改顺序）', () => {
    const cells = overviewCells(
      page(cut('v', [leaf('a'), leaf('b')]), [panel('a'), panel('b')]),
      'rtl',
    )
    expect(cells.map((c) => c.panelId)).toEqual(['b', 'a'])
    expect(cells.map((c) => c.order)).toEqual([1, 2])
  })

  it('横切两格：上下分，与方向无关（`h` 切不镜像）', () => {
    const layout = cut('h', [leaf('a'), leaf('b')])
    const ltr = overviewCells(page(layout, [panel('a'), panel('b')]), 'ltr')
    const rtl = overviewCells(page(layout, [panel('a'), panel('b')]), 'rtl')
    expect(ltr.map((c) => c.panelId)).toEqual(['a', 'b'])
    expect(rtl.map((c) => c.panelId)).toEqual(['a', 'b'])
  })

  it('已生成的格带 assetHash，未生成的缺席（不是空串）', () => {
    const cells = overviewCells(
      page(cut('v', [leaf('a'), leaf('b')]), [panel('a', 'hash-a'), panel('b')]),
    )
    const a = cells.find((c) => c.panelId === 'a')
    const b = cells.find((c) => c.panelId === 'b')
    expect(a?.assetHash).toBe('hash-a')
    expect(b?.assetHash).toBeUndefined()
    expect('assetHash' in (b ?? {})).toBe(false)
  })

  it('版式叶子在池里没有对应内容：不抛错，序号照给、只是没有底图', () => {
    // 序号来自**版式**（`readingOrderOf` 不解析池），底图来自**池**——
    // 单格数据损坏不该让整页渲不出来（与 `panelsInReadingOrder` 同口径：跳过而非抛错）
    const cells = overviewCells(page([leaf('ghost')], [panel('a')]))
    expect(cells).toHaveLength(1)
    expect(cells[0].order).toBe(1)
    expect(cells[0].assetHash).toBeUndefined()
  })

  it('三格混合切割：顺序连续且不重复', () => {
    const layout = cut('h', [cut('v', [leaf('a'), leaf('b')]), leaf('c')])
    const cells = overviewCells(page(layout, [panel('a'), panel('b'), panel('c')]))
    expect(cells.map((c) => c.panelId)).toEqual(['a', 'b', 'c'])
    expect(new Set(cells.map((c) => c.order)).size).toBe(3)
  })
})

describe('pageBadgeText / 页码角标', () => {
  it('页序 0 起 → 页码 1 起', () => {
    expect(pageBadgeText(0)).toBe('1')
    expect(pageBadgeText(4)).toBe('5')
  })

  it('非法 / 负数输入夹回第 1 页（不出现 0 或负数页码）', () => {
    expect(pageBadgeText(-3)).toBe('1')
    expect(pageBadgeText(Number.NaN)).toBe('1')
    expect(pageBadgeText(Number.POSITIVE_INFINITY)).toBe('1')
  })

  it('浮点下标取整（防御索引运算误差）', () => {
    expect(pageBadgeText(1.7)).toBe('2')
    expect(pageBadgeText(2.2)).toBe('3')
  })
})

describe('hasThumbArt', () => {
  it('至少一格已生成即为 true', () => {
    expect(hasThumbArt(overviewCells(page([leaf('a')], [panel('a', 'h')])))).toBe(true)
  })

  it('全未生成 / 未排版为 false', () => {
    expect(hasThumbArt(overviewCells(page([leaf('a')], [panel('a')])))).toBe(false)
    expect(hasThumbArt(overviewCells(page([], [])))).toBe(false)
  })
})
