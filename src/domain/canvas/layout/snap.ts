import { rectBottom, rectRight, rectUnion, type Rect } from '../geometry/rect'

/**
 * 节点拖动时的**吸附对齐**（用户 2026-10-06 第 1 条，参考图是两个节点之间的"108"）。
 *
 * ## 用户定下的口径（逐条对着做）
 *
 * - **吸附对象 = 边缘**（左 / 右 / 上 / 下。**不做中心吸附**，也不吸网格）；
 * - **提示形式 = 参考线 + 间距数字都要**；
 * - **触发距离用默认 8px**（屏幕像素 —— 调用方按缩放换算成世界单位，见
 *   `SNAP_THRESHOLD_SCREEN_PX`）；
 * - **容器内不做吸附**（容器自己有自动整理）—— 这条由调用方决定"喂哪些盒子进来"，
 *   本函数只管几何。
 *
 * ## 为什么是纯函数
 *
 * 吸附最容易出的错是"差了 1px 没吸上 / 吸过头"，而这种错只有在**真拖动**里才看得见；
 * 把它写成纯函数之后，"对准 / 阈值内外的边界 / 两个方向同时吸 / 间距算得对不对"
 * 都能用几条单测钉死，界面那边只剩"把盒子喂进来、把结果画出来"。
 */

/** 吸附触发距离的**屏幕**像素值（用户要的"默认"）；世界单位 = 它 ÷ 缩放 */
export const SNAP_THRESHOLD_SCREEN_PX = 8

export type SnapAxis = 'x' | 'y'

/** 一条参考线（世界坐标）：`at` 是对齐到的那条坐标，`from`/`to` 是线的两端 */
export interface SnapGuide {
  axis: SnapAxis
  at: number
  from: number
  to: number
}

/**
 * 一处间距读数（用户参考图里那个"108"）。
 *
 * `x`/`y` 是**徽标的锚点**（世界坐标）：横向间距取"两个盒子重叠区的**上沿**"横跨中点 ——
 * 与参考图一致（徽标贴在间隙的靠上位置，不是垂直居中）。
 */
export interface SnapGap {
  axis: SnapAxis
  value: number
  x: number
  y: number
}

export interface SnapResult {
  /** 相对传入位置的**修正量**（世界单位，直接加到拖动位移上） */
  dx: number
  dy: number
  guides: SnapGuide[]
  gaps: SnapGap[]
}

export interface SnapInput {
  /** 一起被拖的那些盒子（**未吸附**的当前位置，世界坐标） */
  moving: readonly Rect[]
  /** 候选（同级其它节点，世界坐标）—— 传谁进来就等于"允许吸附到谁" */
  others: readonly Rect[]
  /** 触发距离（**世界单位**） */
  threshold: number
}

const EMPTY: SnapResult = { dx: 0, dy: 0, guides: [], gaps: [] }

/** 判定"同一个坐标"的容差：浮点位移累加后会有 1e-9 级误差，比像素严就够了 */
const SAME_COORD = 0.5

interface AxisHit {
  axis: SnapAxis
  /** 修正量：把它加到所有被拖盒子上，边缘就与目标对齐 */
  shift: number
  /** 对齐到的世界坐标（画参考线用） */
  at: number
}

/** 沿一个轴找**最接近的一次边缘对齐**；超出阈值返回 null（"不吸"也是一种正确结果） */
function snapAxis(
  moving: readonly Rect[],
  others: readonly Rect[],
  axis: SnapAxis,
  threshold: number,
): AxisHit | null {
  const edgesOf = (r: Rect) =>
    axis === 'x' ? [r.x, rectRight(r)] : [r.y, rectBottom(r)]

  let best: AxisHit | null = null
  for (const m of moving) {
    for (const mine of edgesOf(m)) {
      for (const o of others) {
        for (const target of edgesOf(o)) {
          const shift = target - mine
          if (Math.abs(shift) > threshold) continue
          if (!best || Math.abs(shift) < Math.abs(best.shift)) {
            best = { axis, shift, at: target }
          }
        }
      }
    }
  }
  return best
}

/**
 * 参考线要画多长：**参与对齐的那些盒子**的并集（被拖的 + 所有边缘落在同一条坐标上的）。
 *
 * 只画自己那一截的话，用户看不出"到底跟谁对齐了"——参考图里那条线是穿过两三个节点的。
 */
function guideOf(
  hit: AxisHit,
  moving: readonly Rect[],
  others: readonly Rect[],
  dx: number,
  dy: number,
): SnapGuide {
  const snappedMoving = moving.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
  const involved = others.filter((o) =>
    hit.axis === 'x'
      ? Math.abs(o.x - hit.at) <= SAME_COORD || Math.abs(rectRight(o) - hit.at) <= SAME_COORD
      : Math.abs(o.y - hit.at) <= SAME_COORD || Math.abs(rectBottom(o) - hit.at) <= SAME_COORD,
  )
  const union = rectUnion([...snappedMoving, ...involved]) ?? snappedMoving[0]!
  return hit.axis === 'x'
    ? { axis: 'x', at: hit.at, from: union.y, to: rectBottom(union) }
    : { axis: 'y', at: hit.at, from: union.x, to: rectRight(union) }
}

/** 两个盒子在**垂直于间距的那个轴**上是否真的错开了（错开就没有"间距"可言） */
function overlapRange(a: Rect, b: Rect, axis: SnapAxis): [number, number] | null {
  const [a1, a2] = axis === 'x' ? [a.y, rectBottom(a)] : [a.x, rectRight(a)]
  const [b1, b2] = axis === 'x' ? [b.y, rectBottom(b)] : [b.x, rectRight(b)]
  const from = Math.max(a1, b1)
  const to = Math.min(a2, b2)
  return to > from ? [from, to] : null
}

/**
 * 间距读数：每个轴上取**最近的那一个**邻居。
 *
 * 为什么只取最近的一个：参考图里一次只出现一个数字；把所有邻居都标出来，
 * 画布上会瞬间铺满徽标（"信息噪音"，与 §3.4 的克制口径相悖）。
 */
function gapsOf(snapped: readonly Rect[], others: readonly Rect[]): SnapGap[] {
  const out: SnapGap[] = []
  for (const axis of ['x', 'y'] as const) {
    let best: SnapGap | null = null
    for (const m of snapped) {
      for (const o of others) {
        const overlap = overlapRange(m, o, axis)
        if (!overlap) continue
        /**
         * 沿轴量：谁在左边就用"右个的左沿 − 左个的右沿"。
         * ⚠️ 必须取 `max`（两个方向只有一个为真）：取 `min` 会永远拿到那个负数，
         * 于是"框内相邻"被当成"没有间距"——第一版就是这么写的（单测当场拦下）。
         */
        const value =
          axis === 'x'
            ? Math.max(o.x - rectRight(m), m.x - rectRight(o))
            : Math.max(o.y - rectBottom(m), m.y - rectBottom(o))
        if (value <= 0) continue
        if (best && value >= best.value) continue
        const mid = axis === 'x'
          ? { x: (Math.max(m.x, o.x) + Math.min(rectRight(m), rectRight(o))) / 2, y: overlap[0] }
          : { x: overlap[0], y: (Math.max(m.y, o.y) + Math.min(rectBottom(m), rectBottom(o))) / 2 }
        best = { axis, value, x: mid.x, y: mid.y }
      }
    }
    if (best) out.push(best)
  }
  return out
}

/**
 * 算这一次拖动要不要吸附、吸到哪儿、画哪几条线、标哪几个数。
 *
 * 返回的 `dx`/`dy` 是**相对传入位置的修正量**：调用方把 `位置 + dx/dy` 直接落库即可。
 * 两个轴各自独立判定（可以只吸横向、也可以两个方向同时吸）。
 */
export function computeSnap({ moving, others, threshold }: SnapInput): SnapResult {
  if (moving.length === 0 || others.length === 0 || !(threshold > 0)) return EMPTY

  const hitX = snapAxis(moving, others, 'x', threshold)
  const hitY = snapAxis(moving, others, 'y', threshold)
  if (!hitX && !hitY) return EMPTY

  const dx = hitX?.shift ?? 0
  const dy = hitY?.shift ?? 0
  const snapped = moving.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
  return {
    dx,
    dy,
    guides: [
      ...(hitX ? [guideOf(hitX, moving, others, dx, dy)] : []),
      ...(hitY ? [guideOf(hitY, moving, others, dx, dy)] : []),
    ],
    /**
     * 间距数字只在**确实吸住**时才出（`guides` 非空 ⇔ 这里会算）：
     * 平时拖着走就满屏数字，等于没有提示。
     */
    gaps: gapsOf(snapped, others),
  }
}
