import { describe, it, expect } from 'vitest'
import {
  divisionRatios,
  layoutRects,
  splitLeaf,
  removeLeaf,
  instantiateFullPage,
} from './layoutEdit'
import { layoutPanelIds } from './readingOrder'
import type { CutDirection, CutPosition, LayoutNode } from '../model/comicProject'

const leaf = (panelId: string): LayoutNode => ({ kind: 'panel', panelId })
const cut = (
  direction: CutDirection,
  children: LayoutNode[],
  position: CutPosition = 'equal',
): LayoutNode => ({ kind: 'cut', direction, position, count: children.length, children })

/** 取某格的矩形（找不到则抛） */
function rectOf(nodes: readonly LayoutNode[], panelId: string) {
  const r = layoutRects(nodes).find((x) => x.panelId === panelId)
  if (!r) throw new Error(`未找到格 ${panelId}`)
  return r
}

describe('layoutEdit / divisionRatios', () => {
  it('equal 等分（子块数优先，与 count 字段无关）', () => {
    expect(divisionRatios(2, 'equal')).toEqual([0.5, 0.5])
    expect(divisionRatios(3, 'equal')).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(divisionRatios(4, 'equal')).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('单刀位置：start / center / end', () => {
    const start = divisionRatios(2, 'start')
    expect(start[0]).toBeCloseTo(1 / 3, 6)
    expect(start[1]).toBeCloseTo(2 / 3, 6)
    expect(divisionRatios(2, 'center')).toEqual([0.5, 0.5])
    const end = divisionRatios(2, 'end')
    expect(end[0]).toBeCloseTo(2 / 3, 6)
    expect(end[1]).toBeCloseTo(1 / 3, 6)
  })

  it('单刀位置但子块数 ≠ 2 → 退化为等分（防御）', () => {
    expect(divisionRatios(3, 'start')).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it('比例为 0 子块数也安全', () => {
    expect(divisionRatios(0, 'equal')).toEqual([1])
  })
})

describe('layoutEdit / layoutRects 几何', () => {
  it('空版式 → 空数组（尚未排版）', () => {
    expect(layoutRects([])).toEqual([])
  })

  it('满页单格 → 整页矩形', () => {
    expect(rectOf([leaf('a')], 'a')).toEqual({ panelId: 'a', x: 0, y: 0, w: 1, h: 1 })
  })

  it('v 切（竖切，左右分列）：x 轴累加，children[0] 在最左', () => {
    const nodes = [cut('v', [leaf('left'), leaf('right')])]
    expect(rectOf(nodes, 'left')).toMatchObject({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(rectOf(nodes, 'right')).toMatchObject({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })

  it('h 切（横切，上下分行）：y 轴累加，children[0] 在最上', () => {
    const nodes = [cut('h', [leaf('top'), leaf('bottom')])]
    expect(rectOf(nodes, 'top')).toMatchObject({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(rectOf(nodes, 'bottom')).toMatchObject({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })

  it('四宫格（h 包两个 v）→ 四个象限', () => {
    const nodes = [cut('h', [cut('v', [leaf('a'), leaf('b')]), cut('v', [leaf('c'), leaf('d')])])]
    expect(rectOf(nodes, 'a')).toMatchObject({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(rectOf(nodes, 'b')).toMatchObject({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    expect(rectOf(nodes, 'c')).toMatchObject({ x: 0, y: 0.5, w: 0.5, h: 0.5 })
    expect(rectOf(nodes, 'd')).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('三行等分（h 切三块）', () => {
    const nodes = [cut('h', [leaf('r0'), leaf('r1'), leaf('r2')])]
    expect(rectOf(nodes, 'r0')).toMatchObject({ y: 0, h: 1 / 3 })
    expect(rectOf(nodes, 'r1')).toMatchObject({ y: 1 / 3, h: 1 / 3 })
    expect(rectOf(nodes, 'r2')).toMatchObject({ y: 2 / 3, h: 1 / 3 })
  })

  it('单刀位置影响比例（左窄右宽）', () => {
    const nodes = [cut('v', [leaf('a'), leaf('b')], 'start')]
    expect(rectOf(nodes, 'a').w).toBeCloseTo(1 / 3, 6)
    expect(rectOf(nodes, 'b').x).toBeCloseTo(1 / 3, 6)
    expect(rectOf(nodes, 'b').w).toBeCloseTo(2 / 3, 6)
  })

  it('嵌套比例：外层窄列内的上下两行', () => {
    const nodes = [cut('v', [cut('h', [leaf('a'), leaf('b')]), leaf('c')], 'start')]
    // 左列宽 1/3，其内上/下各半高
    expect(rectOf(nodes, 'a').x).toBe(0)
    expect(rectOf(nodes, 'a').y).toBe(0)
    expect(rectOf(nodes, 'a').w).toBeCloseTo(1 / 3, 6)
    expect(rectOf(nodes, 'a').h).toBeCloseTo(0.5, 6)
    expect(rectOf(nodes, 'b').x).toBe(0)
    expect(rectOf(nodes, 'b').y).toBeCloseTo(0.5, 6)
    expect(rectOf(nodes, 'b').w).toBeCloseTo(1 / 3, 6)
    expect(rectOf(nodes, 'b').h).toBeCloseTo(0.5, 6)
    expect(rectOf(nodes, 'c').x).toBeCloseTo(1 / 3, 6)
    expect(rectOf(nodes, 'c').y).toBe(0)
    expect(rectOf(nodes, 'c').w).toBeCloseTo(2 / 3, 6)
    expect(rectOf(nodes, 'c').h).toBeCloseTo(1, 6)
  })

  it('矩形顺序与 layoutPanelIds（几何 DFS）同序', () => {
    const nodes = [cut('h', [cut('v', [leaf('a'), leaf('b')]), leaf('c')])]
    expect(layoutRects(nodes).map((r) => r.panelId)).toEqual(layoutPanelIds(nodes))
  })

  it('几何不受阅读方向影响（RTL 只改顺序，不改位置）', () => {
    const nodes = [cut('v', [leaf('left'), leaf('right')])]
    // layoutRects 无方向参数——位置恒为 children[0] 在左
    expect(rectOf(nodes, 'left').x).toBe(0)
    expect(rectOf(nodes, 'right').x).toBe(0.5)
  })
})

describe('layoutEdit / splitLeaf', () => {
  it('把叶子替换成二分切割：原格在 children[0]、新格在 children[1]', () => {
    const next = splitLeaf([leaf('a')], 'a', 'v', 'b')
    expect(next).not.toBeNull()
    expect(next![0]).toMatchObject({
      kind: 'cut',
      direction: 'v',
      position: 'equal',
      count: 2,
      children: [
        { kind: 'panel', panelId: 'a' },
        { kind: 'panel', panelId: 'b' },
      ],
    })
    expect(layoutPanelIds(next!)).toEqual(['a', 'b'])
  })

  it('嵌套切割：切开内层格，外层结构保持', () => {
    const nodes = [cut('v', [leaf('a'), leaf('b')])]
    const next = splitLeaf(nodes, 'a', 'h', 'a2')!
    expect(layoutPanelIds(next)).toEqual(['a', 'a2', 'b'])
    expect(rectOf(next, 'a')).toMatchObject({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(rectOf(next, 'a2')).toMatchObject({ x: 0, y: 0.5, w: 0.5, h: 0.5 })
    expect(rectOf(next, 'b')).toMatchObject({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })

  it('连续切割可拼出四宫格', () => {
    let nodes = splitLeaf([leaf('a')], 'a', 'h', 'b')! // 上下两行
    nodes = splitLeaf(nodes, 'a', 'v', 'c')! // 上行左右
    nodes = splitLeaf(nodes, 'b', 'v', 'd')! // 下行左右
    expect(layoutRects(nodes).map((r) => r.panelId)).toEqual(['a', 'c', 'b', 'd'])
    expect(rectOf(nodes, 'a')).toMatchObject({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(rectOf(nodes, 'd')).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('目标格不在版式里 → null（调用方据此不写库）', () => {
    expect(splitLeaf([leaf('a')], 'nope', 'v', 'x')).toBeNull()
    expect(splitLeaf([], 'a', 'v', 'x')).toBeNull()
  })
})

describe('layoutEdit / removeLeaf', () => {
  it('移除格后剩余部分保持原几何', () => {
    const nodes = [cut('v', [leaf('a'), leaf('b'), leaf('c')])]
    const next = removeLeaf(nodes, 'b')!
    expect(layoutPanelIds(next)).toEqual(['a', 'c'])
    // 三列变两列：各占 1/2
    expect(rectOf(next, 'a')).toMatchObject({ x: 0, w: 0.5 })
    expect(rectOf(next, 'c')).toMatchObject({ x: 0.5, w: 0.5 })
  })

  it('折叠：切割只剩 1 个子块时用该子块替掉切割本身', () => {
    const nodes = [cut('v', [leaf('a'), leaf('b')])]
    const next = removeLeaf(nodes, 'b')!
    // 不应留下 count=1 的退化切割
    expect(next).toEqual([leaf('a')])
    expect(rectOf(next, 'a')).toEqual({ panelId: 'a', x: 0, y: 0, w: 1, h: 1 })
  })

  it('嵌套折叠：内层折叠后外层若只剩 1 块也继续折叠', () => {
    const nodes = [cut('h', [cut('v', [leaf('a'), leaf('b')]), leaf('c')])]
    const next = removeLeaf(nodes, 'c')!
    // 外层只剩内层切割 → 折叠掉外层，直接是那个 v 切割
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ kind: 'cut', direction: 'v' })
    expect(layoutPanelIds(next)).toEqual(['a', 'b'])
  })

  it('移除最后一格 → 空版式（回到「尚未排版」）', () => {
    expect(removeLeaf([leaf('a')], 'a')).toEqual([])
  })

  it('目标格不在版式里 → null', () => {
    expect(removeLeaf([leaf('a')], 'nope')).toBeNull()
  })

  it('删格不破坏其它格的相对位置（只重新分配空间）', () => {
    const nodes = [
      cut('h', [leaf('top'), cut('v', [leaf('l'), leaf('r')])]),
    ]
    const next = removeLeaf(nodes, 'r')!
    expect(rectOf(next, 'top')).toMatchObject({ x: 0, y: 0, w: 1, h: 0.5 })
    expect(rectOf(next, 'l')).toMatchObject({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })
})

describe('layoutEdit / instantiateFullPage', () => {
  it('生成满页单格（编辑器首次排版的行为）', () => {
    const nodes = instantiateFullPage('p1')
    expect(nodes).toEqual([{ kind: 'panel', panelId: 'p1' }])
    expect(layoutRects(nodes)).toEqual([{ panelId: 'p1', x: 0, y: 0, w: 1, h: 1 }])
  })
})
