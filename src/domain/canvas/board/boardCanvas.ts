import type { Stroke, StrokePoint, TextItem } from '../model/node'
import type { Point } from '../geometry/rect'

/**
 * 画板绘制层纯函数（M4-1）。
 * 不依赖 React / DOM / store：坐标换算与笔迹生成都在这里完成，
 * 视图层只负责把屏幕事件翻译成这里的入参，再 emit 结果（架构 §4.7）。
 */

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 屏幕坐标 → 画板局部逻辑坐标。
 * 画板的绘制 SVG 用 viewBox="0 0 w h" 铺满节点内容区，
 * 因此屏幕像素坐标要除以「屏幕宽 / 逻辑宽」的缩放比，得到与缩放无关的逻辑坐标。
 * 这样无论画布 zoom 还是节点缩放，落点都能稳定锚定在画板画布上。
 */
export function clientToLogical(
  rect: ScreenRect,
  clientX: number,
  clientY: number,
  w: number,
  h: number,
): Point {
  const sx = rect.width === 0 ? 1 : w / rect.width
  const sy = rect.height === 0 ? 1 : h / rect.height
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  }
}

/**
 * 笔迹点集 → SVG path d。
 * 单点画成小圆点（M + l 0 0）；多点用折线连接。
 * 后续若要更顺滑可换成二次贝塞尔（取相邻中点为控制点），这里保持可读的最小实现。
 */
export function strokePath(points: StrokePoint[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const p = points[0]!
    return `M ${p.x} ${p.y} l 0.01 0`
  }
  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    d += ` L ${p.x} ${p.y}`
  }
  return d
}

/** 新建一笔画笔笔迹（§6.13 可调参数：color / width / feather）。 */
export function makeStroke(input: {
  id: string
  color: string
  width: number
  feather: number
  points: StrokePoint[]
}): Stroke {
  return {
    id: input.id,
    color: input.color,
    width: input.width,
    feather: input.feather,
    points: input.points,
  }
}

/** 新建一个文字图元（§6.13 可调参数：size / weight / color）。 */
export function makeText(input: {
  id: string
  x: number
  y: number
  text: string
  size: number
  color: string
  weight: number
}): TextItem {
  return {
    id: input.id,
    x: input.x,
    y: input.y,
    text: input.text,
    size: input.size,
    color: input.color,
    weight: input.weight,
  }
}
