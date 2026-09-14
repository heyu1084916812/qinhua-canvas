import { describe, it, expect } from 'vitest'
import { computeAlign, canAlign, ALIGN_MODES, type AlignMode } from './align'
import type { Rect } from '../geometry/rect'

function n(id: string, x: number, y: number, w = 100, h = 50) {
  return { id, rect: { x, y, w, h } }
}

/** 取某 id 的目标坐标；未出现在结果里表示「无需移动」 */
function at(targets: ReturnType<typeof computeAlign>, id: string) {
  return targets.get(id)
}

describe('computeAlign', () => {
  it('选中少于 2 个时不对齐（§6.5「≥ 2 个节点选中时可用」）', () => {
    expect(computeAlign([n('a', 0, 0)], 'left').size).toBe(0)
    expect(computeAlign([], 'left').size).toBe(0)
  })

  it('左对齐：全部贴包围盒左边', () => {
    const t = computeAlign([n('a', 0, 0), n('b', 120, 40), n('c', 300, 80)], 'left')
    expect(at(t, 'a')).toBeUndefined() // 本来就在最左
    expect(at(t, 'b')?.x).toBe(0)
    expect(at(t, 'c')?.x).toBe(0)
    // 只改 x，不动 y
    expect(at(t, 'b')?.y).toBe(40)
  })

  it('右对齐：全部贴包围盒右边（按各自宽度右缘对齐）', () => {
    const t = computeAlign([n('a', 0, 0, 100, 50), n('b', 120, 40, 200, 50)], 'right')
    // 包围盒右缘 = 320；a 宽 100 → x = 220
    expect(at(t, 'a')?.x).toBe(220)
    expect(at(t, 'b')).toBeUndefined() // 本来就贴右
  })

  it('水平居中：中心对齐包围盒中心（尺寸不一也不共用左边）', () => {
    const t = computeAlign([n('a', 0, 0, 100, 50), n('b', 100, 0, 200, 50)], 'hcenter')
    // 包围盒 0..300，中心 150；a(100) → 100，b(200) → 50
    expect(at(t, 'a')?.x).toBe(100)
    expect(at(t, 'b')?.x).toBe(50)
  })

  it('顶对齐 / 底对齐 / 垂直居中：只改 y', () => {
    const items = [n('a', 0, 0, 100, 50), n('b', 0, 200, 100, 80)]
    const top = computeAlign(items, 'top')
    expect(at(top, 'b')?.y).toBe(0)
    const bottom = computeAlign(items, 'bottom')
    // 包围盒 y 0..280；a 高 50 → y = 230，b 高 80 → y = 200（不变）
    expect(at(bottom, 'a')?.y).toBe(230)
    expect(at(bottom, 'b')).toBeUndefined()
    const vc = computeAlign(items, 'vcenter')
    // 中心 140：a(50) → 115，b(80) → 100
    expect(at(vc, 'a')?.y).toBe(115)
    expect(at(vc, 'b')?.y).toBe(100)
    for (const t of [top, bottom, vc]) {
      for (const v of t.values()) expect(v.x).toBe(0)
    }
  })

  it('水平等距分布：两端不动，中间按间隙等分（宽度不一也间隙相等）', () => {
    const t = computeAlign(
      [n('a', 0, 0, 100, 50), n('b', 150, 0, 100, 50), n('c', 400, 0, 100, 50)],
      'hdistribute',
    )
    // 跨度 0..500，占用 300，两个间隙 → 各 100；a 在 0（不动），b → 200，c 在 400（不动）
    expect(at(t, 'a')).toBeUndefined()
    expect(at(t, 'b')?.x).toBe(200)
    expect(at(t, 'c')).toBeUndefined()
  })

  it('垂直等距分布：按 y 排序后分布', () => {
    const t = computeAlign(
      [n('a', 0, 0, 100, 50), n('b', 0, 150, 100, 50), n('c', 0, 400, 100, 50)],
      'vdistribute',
    )
    expect(at(t, 'a')).toBeUndefined()
    expect(at(t, 'b')?.y).toBe(200)
    expect(at(t, 'c')).toBeUndefined()
  })

  it('等距分布少于 3 个节点时不动', () => {
    expect(computeAlign([n('a', 0, 0), n('b', 100, 0)], 'hdistribute').size).toBe(0)
  })

  it('结果只含位置确实要变的节点（不产生 no-op 补丁）', () => {
    const t = computeAlign([n('a', 0, 0), n('b', 0, 0)], 'left')
    expect(t.size).toBe(0)
  })

  it('八种模式全部覆盖（与工具栏按钮一一对应）', () => {
    const modes = ALIGN_MODES.map((m) => m.mode)
    expect(modes).toEqual([
      'left',
      'hcenter',
      'right',
      'top',
      'vcenter',
      'bottom',
      'hdistribute',
      'vdistribute',
    ])
    for (const m of modes) {
      expect(() => computeAlign([n('a', 0, 0), n('b', 10, 10), n('c', 20, 20)], m as AlignMode)).not.toThrow()
    }
  })

  it('矩形构造辅助：rect 原样参与运算', () => {
    const r: Rect = { x: 5, y: 6, w: 7, h: 8 }
    expect(computeAlign([{ id: 'a', rect: r }, n('b', 0, 0)], 'left').get('a')?.x).toBe(0)
  })
})

describe('canAlign', () => {
  it('普通对齐需 ≥ 2', () => {
    expect(canAlign(1, 'left')).toBe(false)
    expect(canAlign(2, 'left')).toBe(true)
  })

  it('等距分布需 ≥ 3（两个节点谈等距无意义）', () => {
    expect(canAlign(2, 'hdistribute')).toBe(false)
    expect(canAlign(3, 'hdistribute')).toBe(true)
    expect(canAlign(2, 'vdistribute')).toBe(false)
  })
})
