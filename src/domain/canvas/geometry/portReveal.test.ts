import { describe, expect, it } from 'vitest'
import {
  PORT_HIT_RADIUS,
  PORT_MIN_SCALE,
  PORT_REVEAL_END,
  PORT_REVEAL_FULL,
  PORT_SIZE,
  PORT_VERTICAL_PAD,
  activePortNode,
  portReveal,
  type PortNodeRect,
} from './portReveal'

/** 一个 240×160 的节点，屏幕上下边在 y = 100 / 260 */
const node = { nodeTop: 100, nodeBottom: 260, pointerY: 180 }

describe('端点的尺寸与命中（第 15 批第 1 条：放大三倍）', () => {
  it('★ 直径 42（= 第 14 批的 14 × 3），命中半径 = 半直径 + 8', () => {
    expect(PORT_SIZE).toBe(14 * 3)
    expect(PORT_HIT_RADIUS).toBe(PORT_SIZE / 2 + 8)
  })
})

describe('端点出场（靠近弹出 / 离开收回）', () => {
  it('★ 距离 0-50（含负数 = 指针在节点内）→ 完全弹出，且可吸附鼠标', () => {
    for (const edgeGap of [-40, -1, 0, 10, PORT_REVEAL_FULL]) {
      const r = portReveal({ ...node, edgeGap })
      expect(r.progress).toBe(1)
      expect(r.hot).toBe(true)
      expect(r.scale).toBe(1)
    }
  })

  it('★★ 50 → 70 线性收回：60 正好收到中间（用户点名的 10px 缓冲）', () => {
    expect(portReveal({ ...node, edgeGap: 55 }).progress).toBeCloseTo(0.75)
    const mid = portReveal({ ...node, edgeGap: 60 })
    expect(mid.progress).toBeCloseTo(0.5)
    expect(mid.scale).toBeCloseTo((1 + PORT_MIN_SCALE) / 2)
    expect(mid.hot).toBe(false)
  })

  it('★ 70 及以上完全收回（progress 0 ⇒ 缩到最小、看不见）', () => {
    for (const edgeGap of [PORT_REVEAL_END, 200]) {
      const r = portReveal({ ...node, edgeGap })
      expect(r.progress).toBe(0)
      expect(r.hot).toBe(false)
      expect(r.scale).toBe(PORT_MIN_SCALE)
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
})

/**
 * ★★ 用户 2026-10-07 图二：「我选择悬停左边的节点的时候，**右边也会出现端点**」。
 *
 * 根因：露出量是按"指针到**每个节点自己**边缘的距离"逐节点算的 ⇒ 两个节点挨得近时
 * （间隔 < 70px），指针停在一个节点的端点上，旁边节点的端点也一起露出来。
 * 修法：先定出**唯一的活动节点**，只让它露。
 */
describe('活动节点：一次只露一个节点的端点（图二）', () => {
  const a: PortNodeRect = { id: 'a', left: 0, right: 200, top: 0, bottom: 300 }
  /** b 紧贴在 a 右边 60px 处（正是图二那种"挨着"的布局） */
  const b: PortNodeRect = { id: 'b', left: 260, right: 460, top: 0, bottom: 300 }

  it('★ 指针在节点里 → 就是它（不看旁边那个）', () => {
    expect(activePortNode({ x: 100, y: 150 }, [a, b])).toBe('a')
    expect(activePortNode({ x: 300, y: 150 }, [a, b])).toBe('b')
  })

  it('★★ a 的右边缘与 b 的左边缘之间（间隔 60px）：只算**离得近**的那一个', () => {
    /** 贴 a 的右边缘（a 侧 gap 5、b 侧 gap 55）⇒ a */
    expect(activePortNode({ x: 205, y: 150 }, [a, b])).toBe('a')
    /** 贴 b 的左边缘（a 侧 gap 55、b 侧 gap 5）⇒ b */
    expect(activePortNode({ x: 255, y: 150 }, [a, b])).toBe('b')
    /** 正中间（两侧各 30）⇒ 取先遇到的 a */
    expect(activePortNode({ x: 230, y: 150 }, [a, b])).toBe('a')
  })

  it('★ 两个节点都够近也只有一个；都远了就没有活动节点', () => {
    /** b 的右边缘在 460 ⇒ 500 处只差 40（仍在 70 之内，算 b）；要出范围得再远一点 */
    expect(activePortNode({ x: 500, y: 150 }, [a, b])).toBe('b')
    expect(activePortNode({ x: 460 + 71, y: 150 }, [a, b])).toBeNull()
    expect(activePortNode({ x: 255, y: 900 }, [a, b])).toBeNull()
  })

  it('★ 重叠时取**上层**（数组靠后 = 后添加 = 压在上面）', () => {
    const c: PortNodeRect = { id: 'c', left: 100, right: 300, top: 100, bottom: 200 }
    expect(activePortNode({ x: 150, y: 150 }, [a, c])).toBe('c')
  })

  /**
   * ★★ **指针正戳在端点上时，那只端点所属的节点优先**。
   *
   * 端点的命中方块有 29px 宽、又骑在节点边缘上 ⇒ 节点挨着时它会盖到**邻居的框里**。
   * 只按"指针在谁的框里"判，就会把落点算给压过来的邻居：端点不亮、从这只端点拖不出线
   *（实测：G91 第二次从同一个输出端拖线时整条边丢掉）。
   */
  it('★★ 指针戳在 D 的端点上：哪怕 D 的框被别的节点压着，也算 D', () => {
    const d: PortNodeRect = { id: 'd', left: 0, right: 200, top: 0, bottom: 300 }
    /** e 压住 d 的右半（数组靠后 = 在上层） */
    const e: PortNodeRect = { id: 'e', left: 150, right: 400, top: 0, bottom: 300 }
    /** d 的右端点在 (200, 150)：不传 ports 时按框判会算成 e */
    expect(activePortNode({ x: 200, y: 150 }, [d, e])).toBe('e')
    /** 传了端点 ⇒ 算 D（指针就在它那只端点上） */
    expect(activePortNode({ x: 200, y: 150 }, [d, e], [{ nodeId: 'd', x: 200, y: 150 }])).toBe('d')
    /** 离端点超过命中半径（半直径 21 + 8 = 29）就不再优先，回到框判 */
    expect(
      activePortNode({ x: 200, y: 150 }, [d, e], [{ nodeId: 'd', x: 200 - (PORT_HIT_RADIUS + 6), y: 150 }]),
    ).toBe('e')
  })
})
