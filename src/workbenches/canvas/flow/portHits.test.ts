import { beforeEach, describe, expect, it } from 'vitest'
import { PORT_HIT_SIZE, portHitsOf } from './portHits'
import {
  PORT_CENTER_OFFSET,
  PORT_HIT_INNER_PAD,
  PORT_HIT_RADIUS,
  PORT_SIZE,
} from '../../../domain/canvas/geometry/portReveal'
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
   * 端点的**圆心浮在节点边缘外面 20px**（第 14 批第 4 条；第 16 批第 3 条点名要它回来），
   * 而 **`edgeX`（连线锚点）仍在边缘上**（第 15 批澄清 + 第 16 批「线没有在边界」）
   * —— 这两件事必须分开钉住，否则又会被谁"顺手统一"成一份。
   */
  it('★ 单口节点：圆心 = 边缘 ± (20 + 半直径)，而 edgeX 仍在边缘上', () => {
    const hits = portHitsOf(graphOf([node('a', 100, 200, 240, 160)]))
    expect(hits.map((h) => [h.portId, h.x, h.y])).toEqual([
      ['input', 100 - PORT_CENTER_OFFSET, 280],
      ['output', 340 + PORT_CENTER_OFFSET, 280],
    ])
    expect(hits.map((h) => h.edgeX)).toEqual([100, 340])
    // 命中方块按世界单位给（随缩放一起缩，与端口视觉同比例）
    expect(hits[0].size).toBe(PORT_HIT_SIZE)
  })

  /**
   * ★★ 命中块**比圆点往里多探一段**，一直探到节点边缘 —— 圆点浮在边缘外 20px，
   * 只罩圆点的话"从节点边缘往外拖"会落在节点身体上（拖不动线）。
   * 冒烟 G91 / G92 正是从节点边缘那只 `[data-port]` 锚点起拖的。
   */
  it('★★ 命中块：内侧沿探进节点 4px（罩住"从边缘起拖"），外侧沿到圆点外沿', () => {
    const [input, output] = portHitsOf(graphOf([node('a', 100, 200, 240, 160)]))
    const left = (h: { hitX: number; size: number }) => h.hitX - h.size / 2
    const right = (h: { hitX: number; size: number }) => h.hitX + h.size / 2
    const reach = PORT_CENTER_OFFSET + PORT_SIZE / 2
    /** 输出口在右边：命中块 = 340 − 4 → 340 + reach */
    expect(left(output)).toBeCloseTo(340 - PORT_HIT_INNER_PAD)
    expect(right(output)).toBeCloseTo(340 + reach)
    /** 输入口在左边：镜像 */
    expect(left(input)).toBeCloseTo(100 - reach)
    expect(right(input)).toBeCloseTo(100 + PORT_HIT_INNER_PAD)
    /** 纵向仍以端口中线为中心 */
    expect(output.hitY).toBe(output.y)
    /** ⚠️ 节点边缘那一点必须落在命中块里（否则"从边缘往外拖"落空） */
    expect(left(output)).toBeLessThanOrEqual(340)
    expect(right(input)).toBeGreaterThanOrEqual(100)
  })

  it('融合节点：右侧共用口 `patch` 在右中线（一个锚点，不按方向拆成两个）', () => {
    const hits = portHitsOf(graphOf([node('f', 840, 160, 280, 420, 'fusion')]))
    expect(hits.map((h) => h.portId)).toEqual(['input', 'patch'])
    expect(hits[1]).toMatchObject({ x: 1120 + PORT_CENTER_OFFSET, y: 370, edgeX: 1120 })
  })

  it('★ 命中块取"圆点容错圈"与"边缘→圆点外沿"的较大者', () => {
    expect(PORT_HIT_SIZE).toBe(
      Math.max(PORT_HIT_RADIUS * 2, PORT_HIT_INNER_PAD + PORT_CENTER_OFFSET + PORT_SIZE / 2),
    )
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
