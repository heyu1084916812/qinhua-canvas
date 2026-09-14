import { describe, it, expect } from 'vitest'
import {
  layoutLeaves,
  layoutPanelIds,
  countLayoutPanels,
  readingOrderOf,
  panelsInReadingOrder,
  orphanPanelIds,
} from './readingOrder'
import type { ComicPage, ComicPanel, LayoutNode } from '../model/comicProject'

/** 叶子（只持 panelId） */
const leaf = (panelId: string): LayoutNode => ({ kind: 'panel', panelId })
/** 切割（等分子节点，便于构造） */
const cut = (direction: 'h' | 'v', children: LayoutNode[]): LayoutNode => ({
  kind: 'cut',
  direction,
  position: 'equal',
  count: children.length,
  children,
})
const panel = (id: string): ComicPanel => ({
  id,
  scene: '',
  shot: { framing: 'medium', angle: 'eye-level' },
  characterIds: [],
  balloons: [],
  runs: [],
})
const page = (layout: LayoutNode[], poolIds: string[] = []): ComicPage => ({
  id: 'page-1',
  index: 0,
  title: '',
  layout,
  panels: poolIds.map(panel),
})

describe('readingOrder / 几何遍历', () => {
  it('layoutLeaves 深度优先收集叶子（几何顺序）', () => {
    const layout = [cut('h', [cut('v', [leaf('a'), leaf('b')]), leaf('c')])]
    expect(layoutLeaves(layout).map((l) => l.panelId)).toEqual(['a', 'b', 'c'])
    expect(layoutPanelIds(layout)).toEqual(['a', 'b', 'c'])
  })

  it('countLayoutPanels 等于叶子数', () => {
    expect(countLayoutPanels([])).toBe(0)
    expect(countLayoutPanels([leaf('a')])).toBe(1)
    expect(countLayoutPanels([cut('h', [cut('v', [leaf('a'), leaf('b')]), leaf('c')])])).toBe(3)
  })

  it('空版式 = 尚未排版，阅读顺序为空数组（不是「满页单格」）', () => {
    expect(readingOrderOf(page([]), 'ltr')).toEqual([])
    expect(readingOrderOf(page([]), 'rtl')).toEqual([])
  })
})

describe('readingOrder / 阅读方向', () => {
  it('h 切（上下分行）恒为「上 → 下」，不随方向翻转', () => {
    const layout = [cut('h', [leaf('top'), leaf('bottom')])]
    expect(readingOrderOf(page(layout), 'ltr')).toEqual(['top', 'bottom'])
    expect(readingOrderOf(page(layout), 'rtl')).toEqual(['top', 'bottom'])
  })

  it('v 切（左右分列）ltr 左→右、rtl 右→左', () => {
    const layout = [cut('v', [leaf('left'), leaf('right')])]
    expect(readingOrderOf(page(layout), 'ltr')).toEqual(['left', 'right'])
    expect(readingOrderOf(page(layout), 'rtl')).toEqual(['right', 'left'])
  })

  it('嵌套：行(h) 包 列(v)，仅列序翻转，行序不动', () => {
    // 两行，每行两列
    const layout = [
      cut('h', [
        cut('v', [leaf('r0c0'), leaf('r0c1')]),
        cut('v', [leaf('r1c0'), leaf('r1c1')]),
      ]),
    ]
    expect(readingOrderOf(page(layout), 'ltr')).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1'])
    expect(readingOrderOf(page(layout), 'rtl')).toEqual(['r0c1', 'r0c0', 'r1c1', 'r1c0'])
  })

  it('嵌套两层 v：rtl 下每层都翻转（整体镜像）', () => {
    const layout = [cut('v', [cut('v', [leaf('a'), leaf('b')]), leaf('c')])]
    expect(readingOrderOf(page(layout), 'ltr')).toEqual(['a', 'b', 'c'])
    expect(readingOrderOf(page(layout), 'rtl')).toEqual(['c', 'b', 'a'])
  })

  it('单叶版式两种方向结果一致', () => {
    const layout = [leaf('only')]
    expect(readingOrderOf(page(layout), 'ltr')).toEqual(['only'])
    expect(readingOrderOf(page(layout), 'rtl')).toEqual(['only'])
  })
})

describe('readingOrder / 池查找与孤儿', () => {
  it('panelsInReadingOrder 按阅读顺序取出池中内容', () => {
    const layout = [cut('v', [leaf('a'), leaf('b')])]
    const p = page(layout, ['a', 'b'])
    expect(panelsInReadingOrder(p, 'ltr').map((x) => x.id)).toEqual(['a', 'b'])
    expect(panelsInReadingOrder(p, 'rtl').map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('版式引用了池中不存在的 id 时跳过，不让整页渲染失败', () => {
    const layout = [cut('v', [leaf('a'), leaf('missing'), leaf('b')])]
    const p = page(layout, ['a', 'b'])
    expect(panelsInReadingOrder(p, 'ltr').map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('orphanPanelIds 列出池中未被版式引用的格（删格不丢内容的可验证面）', () => {
    const layout = [leaf('a')]
    const p = page(layout, ['a', 'b', 'c'])
    expect(orphanPanelIds(p)).toEqual(['b', 'c'])
  })

  it('全部引用时无孤儿', () => {
    const layout = [cut('h', [leaf('a'), leaf('b')])]
    expect(orphanPanelIds(page(layout, ['a', 'b']))).toEqual([])
  })
})
