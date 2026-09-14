import { describe, it, expect } from 'vitest'
import {
  clampPageIndex,
  nextSide,
  pageNeighbor,
  pageStepForKey,
  spreadGroups,
  spreadNeighbor,
  spreadOfPage,
  spreadSlots,
} from './readerNav'

describe('readerNav / clampPageIndex', () => {
  it('无页可翻返回 null', () => {
    expect(clampPageIndex(0, 0)).toBeNull()
    expect(clampPageIndex(2, -1)).toBeNull()
  })

  it('夹回合法范围', () => {
    expect(clampPageIndex(-3, 5)).toBe(0)
    expect(clampPageIndex(9, 5)).toBe(4)
    expect(clampPageIndex(2, 5)).toBe(2)
    expect(clampPageIndex(4, 5)).toBe(4)
  })

  it('非整数先取整（防御浮点误差）', () => {
    expect(clampPageIndex(1.9, 5)).toBe(1)
    expect(clampPageIndex(-0.4, 5)).toBe(0)
  })
})

describe('readerNav / pageNeighbor', () => {
  it('边界越界返回 null（到边界按「下一页」应无动作）', () => {
    expect(pageNeighbor(0, 3, -1)).toBeNull()
    expect(pageNeighbor(2, 3, 1)).toBeNull()
  })

  it('中间页前后都可达', () => {
    expect(pageNeighbor(1, 3, -1)).toBe(0)
    expect(pageNeighbor(1, 3, 1)).toBe(2)
  })

  it('无页返回 null', () => {
    expect(pageNeighbor(0, 0, 1)).toBeNull()
  })
})

describe('readerNav / pageStepForKey（方向键 → 叙事位移）', () => {
  it('ltr：右=前进、左=后退', () => {
    expect(pageStepForKey('right', 'ltr')).toBe(1)
    expect(pageStepForKey('left', 'ltr')).toBe(-1)
  })

  it('rtl：右=后退、左=前进（日漫手感）', () => {
    expect(pageStepForKey('right', 'rtl')).toBe(-1)
    expect(pageStepForKey('left', 'rtl')).toBe(1)
  })
})

describe('readerNav / nextSide', () => {
  it('下一页的视觉朝向随阅读方向翻转', () => {
    expect(nextSide('ltr')).toBe('right')
    expect(nextSide('rtl')).toBe('left')
  })
})

describe('readerNav / spreadGroups（跨页分组）', () => {
  it('无页返回空', () => {
    expect(spreadGroups(0, true)).toEqual([])
    expect(spreadGroups(-2, true)).toEqual([])
  })

  it('封面单页 + 其后两页一组（loneFirst），末尾落单也独立成组', () => {
    expect(spreadGroups(1, true)).toEqual([[0]])
    expect(spreadGroups(2, true)).toEqual([[0], [1]])
    expect(spreadGroups(3, true)).toEqual([[0], [1, 2]])
    expect(spreadGroups(5, true)).toEqual([[0], [1, 2], [3, 4]])
    expect(spreadGroups(6, true)).toEqual([[0], [1, 2], [3, 4], [5]])
  })

  it('不设封面时从头两页一组', () => {
    expect(spreadGroups(4, false)).toEqual([
      [0, 1],
      [2, 3],
    ])
    expect(spreadGroups(5, false)).toEqual([[0, 1], [2, 3], [4]])
  })
})

describe('readerNav / spreadOfPage', () => {
  it('定位页所属跨页组（组内任意页都指向同一组首）', () => {
    expect(spreadOfPage(0, 5, true)).toEqual({ start: 0, pages: [0] })
    expect(spreadOfPage(1, 5, true)).toEqual({ start: 1, pages: [1, 2] })
    expect(spreadOfPage(2, 5, true)).toEqual({ start: 1, pages: [1, 2] })
    expect(spreadOfPage(4, 5, true)).toEqual({ start: 3, pages: [3, 4] })
  })

  it('越界先夹回、无页返回 null', () => {
    expect(spreadOfPage(0, 0, true)).toBeNull()
    expect(spreadOfPage(9, 3, true)).toEqual({ start: 1, pages: [1, 2] })
    expect(spreadOfPage(-5, 3, true)).toEqual({ start: 0, pages: [0] })
  })
})

describe('readerNav / spreadNeighbor（跨页步进）', () => {
  it('一步跨一组（而非一页）', () => {
    expect(spreadNeighbor(0, 5, true, 1)).toBe(1)
    expect(spreadNeighbor(1, 5, true, 1)).toBe(3)
    expect(spreadNeighbor(2, 5, true, 1)).toBe(3)
    expect(spreadNeighbor(4, 5, true, -1)).toBe(1)
    expect(spreadNeighbor(3, 5, true, -1)).toBe(1)
  })

  it('边界越界返回 null（到边界按「下一页」应无动作）', () => {
    expect(spreadNeighbor(0, 5, true, -1)).toBeNull()
    expect(spreadNeighbor(4, 5, true, 1)).toBeNull()
    expect(spreadNeighbor(0, 0, true, 1)).toBeNull()
  })
})

describe('readerNav / spreadSlots（视觉左右槽位）', () => {
  it('双页：ltr 较早页在左、rtl 较早页在右（镜像）', () => {
    expect(spreadSlots([1, 2], 'ltr')).toEqual([1, 2])
    expect(spreadSlots([1, 2], 'rtl')).toEqual([2, 1])
  })

  it('单页：ltr 靠左、rtl 靠右（另一侧留空占位）', () => {
    expect(spreadSlots([0], 'ltr')).toEqual([0, null])
    expect(spreadSlots([0], 'rtl')).toEqual([null, 0])
  })

  it('空组两侧都留空', () => {
    expect(spreadSlots([], 'ltr')).toEqual([null, null])
    expect(spreadSlots([], 'rtl')).toEqual([null, null])
  })
})
