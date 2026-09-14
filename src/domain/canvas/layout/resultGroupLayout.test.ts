import { describe, it, expect } from 'vitest'
import {
  layoutResultGroup,
  collapsedRect,
  resultGroupCells,
  resultGroupViewRect,
} from './resultGroupLayout'
import { RESULT_CELL, RESULT_GROUP_GAP, RESULT_GROUP_OFFSET, RESULT_GROUP_PADDING } from './constants'
import type { Rect } from '../geometry/rect'

const source: Rect = { x: 100, y: 200, w: 240, h: 240 }

describe('结果组落位', () => {
  it('位于生成节点右侧 32px', () => {
    const { containerRect } = layoutResultGroup({ sourceRect: source, count: 2, cell: RESULT_CELL })
    expect(containerRect.x).toBe(source.x + source.w + RESULT_GROUP_OFFSET)
  })

  it('N=1 与生成节点垂直居中对齐', () => {
    const { containerRect } = layoutResultGroup({ sourceRect: source, count: 1, cell: RESULT_CELL })
    expect(containerRect.y + containerRect.h / 2).toBeCloseTo(source.y + source.h / 2, 6)
  })

  it('N=4 排成 2×2', () => {
    const { containerRect, cells } = layoutResultGroup({ sourceRect: source, count: 4, cell: RESULT_CELL })
    expect(cells).toHaveLength(4)
    const rows = new Set(cells.map((c) => c.y))
    const cols = new Set(cells.map((c) => c.x))
    expect(rows.size).toBe(2)
    expect(cols.size).toBe(2)
    expect(containerRect.w).toBe(RESULT_GROUP_PADDING * 2 + 2 * RESULT_CELL.w + RESULT_GROUP_GAP)
  })

  it('N=3 单行，N=8 每排 4 个', () => {
    const three = layoutResultGroup({ sourceRect: source, count: 3, cell: RESULT_CELL })
    expect(new Set(three.cells.map((c) => c.y)).size).toBe(1)

    const eight = layoutResultGroup({ sourceRect: source, count: 8, cell: RESULT_CELL })
    expect(new Set(eight.cells.map((c) => c.y)).size).toBe(2)
    expect(new Set(eight.cells.map((c) => c.x)).size).toBe(4)
  })

  it('超过 8 个每排固定 4 个并向下扩展', () => {
    const twelve = layoutResultGroup({ sourceRect: source, count: 12, cell: RESULT_CELL })
    expect(new Set(twelve.cells.map((c) => c.y)).size).toBe(3)
    expect(new Set(twelve.cells.map((c) => c.x)).size).toBe(4)
  })

  it('空间不足时减少每排个数（N=2 退化为单列）', () => {
    const narrow = layoutResultGroup({
      sourceRect: source,
      count: 2,
      cell: RESULT_CELL,
      maxWidth: 300,
    })
    expect(new Set(narrow.cells.map((c) => c.y)).size).toBe(2)
  })

  it('槽位互不重叠且保留 16px 间距', () => {
    const { cells } = layoutResultGroup({ sourceRect: source, count: 6, cell: RESULT_CELL })
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i]!
        const b = cells[j]!
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        expect(overlap).toBe(false)
      }
    }
  })

  it('折叠后用固定小尺寸', () => {
    const r = collapsedRect(source)
    expect(r.w).toBeLessThan(RESULT_CELL.w)
    expect(r).toEqual({ x: source.x + source.w + RESULT_GROUP_OFFSET, y: source.y, w: 160, h: 120 })
  })
})

describe('结果组格位（按容器矩形直接算）', () => {
  /**
   * 结果组层用**组内局部坐标**调用它（容器原点 0,0）：`.group` 自己是
   * `position: absolute`，即缩略图的包含块 —— 传世界坐标会被二次累加，
   * 缩略图整片飞到框外而「数 img 有几个」的断言照样全绿（G50 定性）。
   */
  it('容器在原点时，首格落在内边距处', () => {
    const cells = resultGroupCells({ containerRect: { x: 0, y: 0, w: 448, h: 448 }, count: 4, cell: RESULT_CELL })
    expect(cells[0]).toEqual({ x: RESULT_GROUP_PADDING, y: RESULT_GROUP_PADDING, w: RESULT_CELL.w, h: RESULT_CELL.h })
  })

  it('全部格位都落在容器内（不越框）', () => {
    const c: Rect = { x: 0, y: 0, w: 448, h: 448 }
    for (const n of [1, 2, 3, 4, 5, 8, 9]) {
      const cells = resultGroupCells({ containerRect: c, count: n, cell: RESULT_CELL })
      const w = RESULT_GROUP_PADDING * 2 + 2 * RESULT_CELL.w + RESULT_GROUP_GAP
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0)
        expect(cell.y).toBeGreaterThanOrEqual(0)
        expect(cell.x + cell.w).toBeLessThanOrEqual(w)
      }
    }
  })

  it('容器被压窄时自动减列而不是溢出', () => {
    const cells = resultGroupCells({ containerRect: { x: 0, y: 0, w: 300, h: 900 }, count: 4, cell: RESULT_CELL })
    expect(new Set(cells.map((c) => c.x)).size).toBe(1)
  })

  it('与 layoutResultGroup 同源：给定同一容器得到同样的格位', () => {
    const full = layoutResultGroup({ sourceRect: source, count: 4, cell: RESULT_CELL })
    const local = resultGroupCells({
      containerRect: { x: 0, y: 0, w: full.containerRect.w, h: full.containerRect.h },
      count: 4,
      cell: RESULT_CELL,
    })
    expect(local.map((c) => [c.x, c.y])).toEqual(full.cells.map((c) => [c.x - full.containerRect.x, c.y - full.containerRect.y]))
  })
})

describe('结果组呈现矩形', () => {
  const expanded = { x: 500, y: 300, w: 448, h: 448, collapsed: false }

  it('展开态用持久几何', () => {
    expect(resultGroupViewRect(expanded, source)).toEqual({ x: 500, y: 300, w: 448, h: 448 })
  })

  it('折叠态按来源节点现算，且比展开态小', () => {
    const r = resultGroupViewRect({ ...expanded, collapsed: true }, source)
    expect(r).toEqual(collapsedRect(source))
    expect(r.w).toBeLessThan(expanded.w)
  })

  it('来源节点已删时原地缩到折叠尺寸（不猜它原本在哪）', () => {
    const r = resultGroupViewRect({ ...expanded, collapsed: true }, null)
    expect(r.x).toBe(expanded.x)
    expect(r.y).toBe(expanded.y)
    expect(r.w).toBe(160)
  })

  it('折叠 / 展开往返不碰持久几何（展开态恒等于原值）', () => {
    const collapsedOnce = resultGroupViewRect({ ...expanded, collapsed: true }, source)
    expect(collapsedOnce).not.toEqual({ x: expanded.x, y: expanded.y, w: expanded.w, h: expanded.h })
    expect(resultGroupViewRect(expanded, source)).toEqual({ x: 500, y: 300, w: 448, h: 448 })
  })
})
