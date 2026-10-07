import { beforeEach, describe, expect, it } from 'vitest'
import { PORT_HIT_SIZE, portHitsOf } from './portHits'
import { PORT_SIZE } from '../../../domain/canvas/geometry/portReveal'
import { registerAllSpecs, resetSpecs } from '../../../domain/canvas/nodeSpecs'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'

/**
 * 端点命中层的几何（引擎替换 P5 收口）。
 *
 * 这里只验**世界坐标**这一段：函数刻意不收视口 —— 视口换算由命中层的
 * `translate(−视口×zoom) scale(zoom)` 承担（`transform-origin: 0 0`），
 * 这样平移 / 缩放帧不会重排圆点。**若哪天有人把 zoom 乘回这里，这条就红了**（那正是退化的开始）。
 */
describe('端点命中层几何', () => {
  const node = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    type: NodeType = 'generation',
    parentId: string | null = null,
  ) =>
    ({ id, type, parentId, x, y, w, h, title: id, data: {} }) as unknown as NodeSnapshot

  const graphOf = (nodes: NodeSnapshot[]) =>
    ({ nodes, edges: [], resultGroups: [] }) as unknown as GraphSnapshot

  beforeEach(() => {
    resetSpecs()
    registerAllSpecs()
  })

  /**
   * 端点的圆心**就在节点边缘上**（用户 2026-10-07 第 15 批澄清：端点只是动效点，
   * 「线的起始位置是节点的边缘」）⇒ 圆点是"骑"在边缘上的，纵向仍是各口声明的中线。
   */
  it('单口节点：输出口圆心在右边缘、输入口圆心在左边缘（世界坐标）', () => {
    const hits = portHitsOf(graphOf([node('a', 100, 200, 240, 160)]))
    expect(hits.map((h) => [h.portId, h.x, h.y])).toEqual([
      ['input', 100, 280],
      ['output', 340, 280],
    ])
    // 命中方块按世界单位给（随缩放一起缩，与端口视觉同比例）
    expect(hits[0].size).toBe(PORT_HIT_SIZE)
  })

  it('融合节点：右侧共用口 `patch` 在右中线（一个锚点，不按方向拆成两个）', () => {
    const hits = portHitsOf(graphOf([node('f', 840, 160, 280, 420, 'fusion')]))
    expect(hits.map((h) => h.portId)).toEqual(['input', 'patch'])
    expect(hits[1]).toMatchObject({ x: 1120, y: 370 })
  })

  it('★ 命中区随端点尺寸放大（42 的圆点 ⇒ 命中方块 2×(21+8) = 58）', () => {
    expect(PORT_HIT_SIZE).toBe(PORT_SIZE + 16)
  })

  it('容器子节点不给端点（§6.11 组内节点端点隐藏）', () => {
    const hits = portHitsOf(
      graphOf([node('g', 0, 0, 600, 400, 'group'), node('c', 20, 20, 100, 100, 'generation', 'g')]),
    )
    expect(hits.every((h) => h.nodeId === 'g')).toBe(true)
  })

  it('未注册的节点类型跳过（老数据 / 未加载视图），不抛异常', () => {
    const hits = portHitsOf(graphOf([node('x', 0, 0, 100, 100, 'nope' as NodeType)]))
    expect(hits).toEqual([])
  })

  it('每个端点的 key 唯一（同一节点多口也不撞）', () => {
    const hits = portHitsOf(graphOf([node('f', 0, 0, 280, 420, 'fusion')]))
    expect(new Set(hits.map((h) => h.key)).size).toBe(hits.length)
  })
})
