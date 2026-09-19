import type { Rect } from '../geometry/rect'
import { rectUnion } from '../geometry/rect'

/**
 * 排列方式（产品文档 §6.5 ④，用户 2026-09-19）。
 *
 * 与 `align.ts` 的**分工**（两者不可互相替代，故并存）：
 * - 对齐：只改**一个方向**的坐标，用于把已有布局的边缘 / 中心线拉齐；
 * - 排列：**两个方向一起重排**，用于把散落的节点整理成网格 / 一行 / 一列。
 *
 * 纯函数：输入节点矩形，输出 id → 目标左上角坐标；不碰图数据、不读时间。
 */
export type ArrangeMode = 'grid' | 'row' | 'column'

/** 排列间距（与 tidyLayout 的 ARRANGE_GAP 同值，产品文档 §6.5「间距统一 24px」） */
export const ARRANGE_GAP = 24

export interface ArrangeModeInput {
  id: string
  rect: Rect
}

/** id → 目标坐标（仅含需要移动的节点，避免 no-op 补丁污染撤销栈） */
export type ArrangeModeTargets = Map<string, { x: number; y: number }>

/**
 * 排列顺序：**先上后下、先左后右**。
 *
 * 为什么按坐标排序而不是沿用传入顺序：用户框选时点选次序是随机的，
 * 若照传入顺序排，「把这两行整理成一行」会变成随机拼接，看着像被打乱。
 * 按位置排序保证结果**符合视觉直觉且可复现**（同样输入必得同样输出）。
 */
function inReadingOrder(nodes: readonly ArrangeModeInput[]): ArrangeModeInput[] {
  return [...nodes].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
}

/**
 * 算排列目标坐标。
 *
 * **锚点**：排列后整块的包围盒**中心保持不动**——与 `tidyLayout` 同口径，
 * 不允许「排一次就把整组甩到画布别处」。这也是为什么先算总尺寸再反推起点。
 *
 * `grid` 的列数取**接近正方形**的那一档（`ceil(sqrt(n))`）：不写死列数，
 * 否则 3 个节点会排成 3 列一条线、12 个节点会排成 1 列长条，两种都很难看。
 */
export function computeArrangeMode(
  nodes: readonly ArrangeModeInput[],
  mode: ArrangeMode,
): ArrangeModeTargets {
  const out: ArrangeModeTargets = new Map()
  if (nodes.length < 2) return out

  const ordered = inReadingOrder(nodes)
  const bounds = rectUnion(nodes.map((n) => n.rect))
  if (!bounds) return out

  /** 每行 / 每列放几个 */
  const columns =
    mode === 'row' ? ordered.length : mode === 'column' ? 1 : Math.ceil(Math.sqrt(ordered.length))

  /** 列宽取各列最大值、行高取各行最大值——尺寸不一时才不会互相压住 */
  const rows = Math.ceil(ordered.length / columns)
  const colW = new Array<number>(columns).fill(0)
  const rowH = new Array<number>(rows).fill(0)
  ordered.forEach((n, i) => {
    const c = i % columns
    const r = Math.floor(i / columns)
    colW[c] = Math.max(colW[c], n.rect.w)
    rowH[r] = Math.max(rowH[r], n.rect.h)
  })

  const totalW = colW.reduce((s, w) => s + w, 0) + Math.max(0, columns - 1) * ARRANGE_GAP
  const totalH = rowH.reduce((s, h) => s + h, 0) + Math.max(0, rows - 1) * ARRANGE_GAP
  const originX = bounds.x + bounds.w / 2 - totalW / 2
  const originY = bounds.y + bounds.h / 2 - totalH / 2

  /** 每格的左上角起点（前面各列/各行累加） */
  const colX = new Array<number>(columns).fill(0)
  for (let c = 1; c < columns; c++) colX[c] = colX[c - 1] + colW[c - 1] + ARRANGE_GAP
  const rowY = new Array<number>(rows).fill(0)
  for (let r = 1; r < rows; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + ARRANGE_GAP

  ordered.forEach((n, i) => {
    const c = i % columns
    const r = Math.floor(i / columns)
    /**
     * 单元内**居中**放置：节点比该行/列最大尺寸小时，两边留白对称。
     * 不居中会让行列边缘参差不齐（看上去像没排好）。
     */
    const x = originX + colX[c] + (colW[c] - n.rect.w) / 2
    const y = originY + rowY[r] + (rowH[r] - n.rect.h) / 2
    /** 只收**真的会动**的节点 */
    if (Math.abs(x - n.rect.x) > 1e-6 || Math.abs(y - n.rect.y) > 1e-6) {
      out.set(n.id, { x: Math.round(x), y: Math.round(y) })
    }
  })
  return out
}

/** 三种排列的中文标签与面板顺序（产品文档 §6.5 ④） */
export const ARRANGE_MODES: readonly { mode: ArrangeMode; label: string }[] = [
  { mode: 'grid', label: '宫格排列' },
  { mode: 'row', label: '水平排列' },
  { mode: 'column', label: '垂直排列' },
]
