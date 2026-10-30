import { beforeEach, describe, expect, it } from 'vitest'
import {
  PORT_HIT_SIZE,
  PORT_PRECISE_HIT_RADIUS,
  portHitAcceptsPointer,
  portHitsOf,
  portInverseScale,
} from './portHits'
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
    // 命中方块按世界单位给；视图层用反向缩放把它固定为屏幕像素尺寸
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

  it('★ 端点视觉尺寸与反向缩放相乘后保持屏幕像素不变', () => {
    for (const zoom of [1, 0.5, 0.29, 0.15]) {
      expect(PORT_SIZE * zoom * portInverseScale(zoom)).toBeCloseTo(PORT_SIZE)
      expect(PORT_HIT_SIZE * zoom * portInverseScale(zoom)).toBeCloseTo(PORT_HIT_SIZE)
    }
  })

  it('keeps the fixed visual dot but narrows hit testing at low zoom', () => {
    const dotCenter = { x: 100, y: 100 }
    expect(
      portHitAcceptsPointer({
        zoom: 0.2,
        pointer: { x: dotCenter.x + PORT_PRECISE_HIT_RADIUS - 1, y: dotCenter.y },
        dotCenter,
      }),
    ).toBe(true)
    expect(
      portHitAcceptsPointer({
        zoom: 0.2,
        pointer: { x: dotCenter.x - PORT_HIT_SIZE / 2, y: dotCenter.y },
        dotCenter,
      }),
    ).toBe(false)
    expect(
      portHitAcceptsPointer({
        zoom: 0.5,
        pointer: { x: dotCenter.x - PORT_HIT_SIZE / 2, y: dotCenter.y },
        dotCenter,
      }),
    ).toBe(true)
  })

  it('★★ 容器子节点也给端点，且坐标换算到世界系（用户 2026-10-14）', () => {
    const hits = portHitsOf(
      graphOf([
        node('g', 100, 50, 600, 400, 'group'),
        node('c', 20, 20, 100, 100, 'generation', 'g'),
      ]),
      /** 子节点的端点**只在选中时**出现（见下一条） */
      ['c'],
    )
    /**
     * 用户原话：「建组后……选择节点后也是可以有端点出现，也是可以进行连线的」。
     * 此前按 §6.11「组内节点端点隐藏」只收顶层 ⇒ 打组之后组内成员再也连不出线。
     *
     * ⚠️ 父容器故意**不在原点**：子节点写的是相对坐标 (20,20)，只有真的换算过，
     * 世界左边缘才会是 100+20=120。父容器放 (0,0) 的话，忘了换算也能通过。
     */
    const child = hits.filter((h) => h.nodeId === 'c')
    expect(child.length).toBeGreaterThan(0)
    expect(child.some((h) => h.nodeLeft === 120)).toBe(true)
    expect(child.some((h) => h.nodeRight === 220)).toBe(true)
  })

  it('★ 子节点**未选中**时不给端点 —— 否则会抢「拖出容器」的手势', () => {
    const hits = portHitsOf(
      graphOf([
        node('g', 100, 50, 600, 400, 'group'),
        node('c', 20, 20, 100, 100, 'generation', 'g'),
      ]),
    )
    /**
     * G15 实测：子节点端点做常驻时，命中块（从边缘往里铺 18.5px）会把
     * 「按住子节点往容器外拖」吃掉 —— 组内计数多一个、组端点拉线 2 条变 3 条。
     * 用户要的本来就是「**选择节点后**有端点」。
     */
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
