import type { Rect } from '../geometry/rect'
import { rectRight, rectBottom, rectUnion } from '../geometry/rect'

/**
 * 8 种对齐（产品文档 §6.5 ②）。
 * 纯函数：输入节点矩形集合，输出 id → 目标左上角坐标的映射；
 * 只算坐标、不碰图数据，由调用方（命令层）负责落库。
 *
 * 关键取舍：对齐**不改尺寸**，只平移 x 或 y 之一（等距分布两个方向都改）。
 * 参考基准取选中集合的**包围盒**：左对齐 = 全部贴包围盒左边，右对齐 = 全部贴右边，
 * 水平居中 = 全部中心对齐包围盒中心。这与「节点尺寸不一」场景下用户的直觉一致。
 */
export type AlignMode =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom'
  | 'hdistribute'
  | 'vdistribute'

/** 对齐结果：id → 目标坐标（仅含需要移动的节点） */
export type AlignTargets = Map<string, { x: number; y: number }>

interface AlignInput {
  id: string
  rect: Rect
}

/**
 * 计算对齐目标坐标。选中数量 < 2 时返回空表（§6.5「≥ 2 个节点选中时可用」）。
 * 返回的 Map 只含**位置确实要变**的节点，避免产生 no-op 补丁污染撤销栈。
 */
export function computeAlign(
  nodes: readonly AlignInput[],
  mode: AlignMode,
): AlignTargets {
  const out: AlignTargets = new Map()
  if (nodes.length < 2) return out

  const bounds = rectUnion(nodes.map((n) => n.rect))
  if (!bounds) return out

  if (mode === 'hdistribute') return distribute(nodes, 'h')
  if (mode === 'vdistribute') return distribute(nodes, 'v')

  for (const { id, rect } of nodes) {
    let x = rect.x
    let y = rect.y
    switch (mode) {
      case 'left':
        x = bounds.x
        break
      case 'right':
        x = rectRight(bounds) - rect.w
        break
      case 'hcenter':
        x = bounds.x + bounds.w / 2 - rect.w / 2
        break
      case 'top':
        y = bounds.y
        break
      case 'bottom':
        y = rectBottom(bounds) - rect.h
        break
      case 'vcenter':
        y = bounds.y + bounds.h / 2 - rect.h / 2
        break
    }
    if (x !== rect.x || y !== rect.y) out.set(id, { x, y })
  }
  return out
}

/**
 * 等距分布（§6.5「水平等距分布 / 垂直等距分布」）。
 * 语义取**间隙等距**（gap 相等）而非**中心等距**：节点宽度不一时，
 * 中心等距会出现视觉上疏密不均；间隙等距才符合「等距分布」的直觉。
 *
 * 实现：两端节点位置不动，把中间的可用空间平均分给 (n-1) 个间隙。
 * 总间距可能为负（节点太大装不下）——此时按原始顺序压缩，仍保持单调递增。
 */
function distribute(nodes: readonly AlignInput[], axis: 'h' | 'v'): AlignTargets {
  const out: AlignTargets = new Map()
  if (nodes.length < 3) return out

  // 按当前位置排序，保证「左 → 右」「上 → 下」的分布顺序与视觉一致
  const sorted = [...nodes].sort((a, b) => (axis === 'h' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
  const first = sorted[0].rect
  const last = sorted[sorted.length - 1].rect

  const start = axis === 'h' ? first.x : first.y
  const end = axis === 'h' ? rectRight(last) : rectBottom(last)
  const span = end - start
  const occupied = sorted.reduce((sum, n) => sum + (axis === 'h' ? n.rect.w : n.rect.h), 0)
  const gap = (span - occupied) / (sorted.length - 1)

  let cursor = start
  for (const { id, rect } of sorted) {
    const size = axis === 'h' ? rect.w : rect.h
    const target = Math.round(cursor)
    const cur = axis === 'h' ? rect.x : rect.y
    if (target !== cur) {
      out.set(id, axis === 'h' ? { x: target, y: rect.y } : { x: rect.x, y: target })
    }
    cursor += size + gap
  }
  return out
}

/** 供 UI 判断按钮是否可用（§6.5：≥ 2 个节点选中） */
export function canAlign(selectedCount: number, mode: AlignMode): boolean {
  if (selectedCount < 2) return false
  return mode === 'hdistribute' || mode === 'vdistribute' ? selectedCount >= 3 : true
}

/** 8 种对齐的中文标签与顺序（工具栏按钮顺序，§6.5 ②） */
export const ALIGN_MODES: readonly { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: '左对齐' },
  { mode: 'hcenter', label: '水平居中' },
  { mode: 'right', label: '右对齐' },
  { mode: 'top', label: '顶对齐' },
  { mode: 'vcenter', label: '垂直居中' },
  { mode: 'bottom', label: '底对齐' },
  { mode: 'hdistribute', label: '水平等距分布' },
  { mode: 'vdistribute', label: '垂直等距分布' },
]
