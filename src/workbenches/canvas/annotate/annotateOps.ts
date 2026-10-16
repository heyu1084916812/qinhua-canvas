/**
 * 标注的**模型层**：工具 / 一笔操作 / 色板 / 「怎么把一笔画出来」。
 *
 * 从老的独立标注层 `AnnotateLayer` 里抽出来的（2026-10-16：标注搬进灯箱，
 * 见 `LightboxLayer` 的标注模式）。留在组件里的话，「屏幕上预览」与「保存时
 * 烘焙进像素」就会各画一遍 —— 那正是这个仓库反复踩的坑：两套实现迟早漂移，
 * 表现为「看着对、存下来少一笔 / 颜色不对」。
 *
 * 两个工程决定（沿用老那一层的口径）：
 * 1. 画布 = 图片的**原始像素尺寸**，显示时用 CSS 缩到屏幕上 —— 于是标注坐标天然
 *    是图片坐标，保存时不做任何换算（换算一次就多一处「看着对、存下来偏了」）。
 * 2. 数据结构是**操作列表**而不是点阵：撤销 / 重做就是把列表切一刀，重放即得画面。
 */
export type AnnotateTool = 'brush' | 'rect' | 'text'

export interface AnnotatePoint {
  x: number
  y: number
}

export interface AnnotateOp {
  tool: AnnotateTool
  color: string
  size: number
  points: AnnotatePoint[]
  text?: string
}

/** 画笔颜色只用**固定色板**：画在图上要跟任何照片都分得开，也让撤销 / 重做可预期 */
export const ANNOTATE_COLORS = [
  '#e5484d',
  '#f5a524',
  '#f2e600',
  '#30a46c',
  '#0091ff',
  '#ffffff',
] as const

/** 把一条标注操作画到 2D 上下文上（预览 / 撤销 / 重做 / 保存都走这同一个函数） */
export function drawAnnotateOp(g2: CanvasRenderingContext2D, op: AnnotateOp): void {
  g2.save()
  g2.strokeStyle = op.color
  g2.fillStyle = op.color
  g2.lineWidth = op.size
  g2.lineCap = 'round'
  g2.lineJoin = 'round'
  if (op.tool === 'brush') {
    g2.beginPath()
    op.points.forEach((p, i) => (i === 0 ? g2.moveTo(p.x, p.y) : g2.lineTo(p.x, p.y)))
    g2.stroke()
  } else if (op.tool === 'rect') {
    const a = op.points[0]
    const b = op.points[1] ?? a
    if (a && b) g2.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
  } else {
    const at = op.points[0]
    if (at && op.text) {
      g2.font = '600 ' + Math.max(14, op.size * 5) + 'px sans-serif'
      g2.textBaseline = 'top'
      g2.fillText(op.text, at.x, at.y)
    }
  }
  g2.restore()
}
