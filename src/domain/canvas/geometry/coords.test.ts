import { describe, it, expect } from 'vitest'
import { screenToWorld, worldToScreen, convertOnReparent, toWorldRect, toWorldRectInGraph, isRectVisible } from './coords'
import type { NodeLike } from '../model/graph'

const vp = { x: 100, y: 50, zoom: 1.5 }
const container = { x: 0, y: 0, w: 800, h: 600 }

function node(id: string, x: number, y: number, parentId: string | null = null): NodeLike {
  return { id, parentId, type: 'generation', x, y, w: 200, h: 200 }
}

describe('screen ↔ world', () => {
  it('往返换算不漂移', () => {
    const p = { x: 321, y: 123 }
    const back = screenToWorld(worldToScreen(p, vp, container), vp, container)
    expect(back.x).toBeCloseTo(p.x, 10)
    expect(back.y).toBeCloseTo(p.y, 10)
  })

  it('视口原点映射到容器左上角', () => {
    const out = worldToScreen({ x: vp.x, y: vp.y }, vp, container)
    expect(out).toEqual({ x: container.x, y: container.y })
  })

  it('缩放越大，屏幕跨度越大', () => {
    const a = worldToScreen({ x: 0, y: 0 }, { x: 0, y: 0, zoom: 1 }, container)
    const b = worldToScreen({ x: 0, y: 0 }, { x: 0, y: 0, zoom: 2 }, container)
    expect(a).toEqual(b)
    const c = worldToScreen({ x: 10, y: 0 }, { x: 0, y: 0, zoom: 2 }, container)
    expect(c.x - a.x).toBe(20)
  })
})

describe('容器坐标', () => {
  const parent = node('p', 500, 400)
  const child = node('c', 20, 30, 'p')

  it('有父级时世界坐标叠加父级偏移', () => {
    expect(toWorldRect(child, parent)).toEqual({ x: 520, y: 430, w: 200, h: 200 })
  })

  it('无父级时世界坐标即自身', () => {
    expect(toWorldRect(parent, null)).toEqual({ x: 500, y: 400, w: 200, h: 200 })
  })

  it('进出容器往返不漂移（产品文档 §14.2 属性测试要求）', () => {
    const into = convertOnReparent(child, null, parent)
    expect(into.x).toBe(20 - 500)
    expect(into.y).toBe(30 - 400)
    expect(into.parentId).toBe('p')

    const out = convertOnReparent(into, parent, null)
    expect(out.x).toBeCloseTo(child.x, 10)
    expect(out.y).toBeCloseTo(child.y, 10)
    expect(out.parentId).toBeNull()
  })
})

describe('图内世界矩形（父级可能是结果组）', () => {
  /**
   * 结果组不在 nodes 表里：只查节点索引会得到 null，子节点的 local 坐标被当成
   * 世界坐标 —— 拖出结果组时的落点判定会整片偏到画布左上角。
   */
  const rgGraph = {
    nodes: [node('c1', 16, 16, 'rg1'), node('top', 100, 100, null)],
    resultGroups: [{ id: 'rg1', x: 500, y: 300 }],
  }

  it('结果组子节点要加上组原点', () => {
    expect(toWorldRectInGraph(rgGraph.nodes[0]!, rgGraph)).toEqual({
      x: 516,
      y: 316,
      w: 200,
      h: 200,
    })
  })

  it('普通容器子节点与顶层节点走原路径（零回归）', () => {
    const g = { nodes: [node('c', 10, 20, 'p'), node('p', 400, 300, null)], resultGroups: [] }
    expect(toWorldRectInGraph(g.nodes[0]!, g)).toEqual({ x: 410, y: 320, w: 200, h: 200 })
    expect(toWorldRectInGraph(rgGraph.nodes[1]!, rgGraph)).toEqual({ x: 100, y: 100, w: 200, h: 200 })
  })
})

describe('视口裁剪', () => {
  it('视口内的矩形可见，视口外不可见', () => {
    const view = { x: 0, y: 0, zoom: 1 }
    expect(isRectVisible({ x: 10, y: 10, w: 100, h: 100 }, view, { x: 0, y: 0, w: 800, h: 600 })).toBe(true)
    expect(isRectVisible({ x: 5000, y: 10, w: 100, h: 100 }, view, { x: 0, y: 0, w: 800, h: 600 })).toBe(false)
  })
})
