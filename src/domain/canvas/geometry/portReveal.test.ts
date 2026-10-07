import { describe, expect, it } from 'vitest'
import {
  PORT_CENTER_OFFSET,
  PORT_EDGE_GAP,
  PORT_SIZE,
  PORT_VERTICAL_PAD,
  portReveal,
} from './portReveal'

/** 一个 240×160 的节点，屏幕上下边在 y = 100 / 260 */
const node = { nodeTop: 100, nodeBottom: 260, pointerY: 180 }

describe('端点的位置常量（第 14 批第 4 条）', () => {
  it('★ 静止时端点的**近边**距节点边缘 20px ⇒ 圆心外移 27（20 + 半直径）', () => {
    expect(PORT_EDGE_GAP).toBe(20)
    expect(PORT_SIZE).toBe(14)
    expect(PORT_CENTER_OFFSET).toBe(PORT_EDGE_GAP + PORT_SIZE / 2)
  })
})

describe('端点出场（靠近弹出 / 离开收回）', () => {
  it('★ 距离 0-50（含负数 = 指针在节点内）→ 完全弹出，且可吸附鼠标', () => {
    for (const edgeGap of [-40, -1, 0, 10, 49, 50]) {
      const r = portReveal({ ...node, edgeGap })
      expect(r.progress).toBe(1)
      expect(r.hot).toBe(true)
      expect(r.pop).toBe(0)
    }
  })

  it('★★ 50 → 70 线性收回：60 正好收到中间（用户点名的 10px 缓冲）', () => {
    expect(portReveal({ ...node, edgeGap: 55 }).progress).toBeCloseTo(0.75)
    const mid = portReveal({ ...node, edgeGap: 60 })
    expect(mid.progress).toBeCloseTo(0.5)
    expect(mid.pop).toBeCloseTo(PORT_EDGE_GAP / 2)
    expect(mid.hot).toBe(false)
  })

  it('★ 70 及以上完全收回（progress 0 ⇒ 端点贴住节点边缘、看不见）', () => {
    for (const edgeGap of [70, 200]) {
      const r = portReveal({ ...node, edgeGap })
      expect(r.progress).toBe(0)
      expect(r.hot).toBe(false)
      expect(r.pop).toBe(PORT_EDGE_GAP)
    }
  })

  it('★★ 指针离开了节点的上下范围 → 不管横向多近都不出现', () => {
    const far = PORT_VERTICAL_PAD + 1
    expect(portReveal({ ...node, edgeGap: 0, pointerY: node.nodeTop - far }).progress).toBe(0)
    expect(portReveal({ ...node, edgeGap: 0, pointerY: node.nodeBottom + far }).progress).toBe(0)
    /* 边界上仍算在范围内（与"距离取闭区间"同一条口径） */
    expect(portReveal({ ...node, edgeGap: 0, pointerY: node.nodeTop - PORT_VERTICAL_PAD }).progress).toBe(1)
    expect(portReveal({ ...node, edgeGap: 0, pointerY: node.nodeBottom + PORT_VERTICAL_PAD }).progress).toBe(1)
  })

  it('指针在节点上下之外、且横向也远 → 依旧不出现（两个条件同时不满足也不能冒出来）', () => {
    expect(portReveal({ ...node, edgeGap: 999, pointerY: -999 }).progress).toBe(0)
  })
})
