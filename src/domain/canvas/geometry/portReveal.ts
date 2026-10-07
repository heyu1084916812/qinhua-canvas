/**
 * 端点的**位置与出场**（用户 2026-10-06 第 14 批第 4 条）。
 *
 * ## 用户原话（口径就按这个来）
 *
 * - 「节点的端点需要改样式改成一个圆形填充 + 描边，中间一个和描边一样颜色的加号」；
 * - 「悬停位置（位置不在节点的边缘，需要和端点的边缘距离节点的边缘 **20PX**）」；
 * - 「端点出场动画改成从节点边缘向左或右**渐显弹出**」；
 * - 「同时需要**吸附鼠标**，吸附的范围是距离边缘 **0-50PX**，超出这个范围的时候鼠标
 *   离开的节点范围，也就是不再悬停，所以端点会渐隐收回（需要有 **10px 的缓冲范围**，
 *   例如 60PX 的时候，他收回去的范围刚刚好收到中间，50PX 开始收回，70px 完全收回）」；
 * - 「因为吸附功能小于 0px 的时候，鼠标在节点范围内，所以会保持悬停状态」。
 *
 * ## 单位只有一套：**画布自己的像素**（世界单位）
 *
 * 用户说的 "20PX" / "0-50PX" 都是在 100% 缩放下量的，而节点自己的尺寸（240×160）
 * 也是这套单位 —— 所以这里一律用世界单位，**不要**在这里掺 `zoom`：
 * 掺进来就会出现"放大到 300% 时，指针明明正戳在端点上，却因为屏幕距离 81px > 70
 * 而被判成已经离开"这种自相矛盾（端点圆心离边缘就是 27）。
 * 换算在世界 → 屏幕那一层做（`FlowPortLayer` 把指针坐标除回去）。
 *
 * 纯几何：不碰 DOM、不碰 React，故可直接单测（同 `portMagnet.ts` 的理由）。
 */

/** 端点直径（世界单位）。视觉、命中区、连线锚点三处共用这一个值 */
export const PORT_SIZE = 14
/** 静止时端点的**近边**距离节点边缘多远（世界单位）—— 用户点名的 20px */
export const PORT_EDGE_GAP = 20
/** 端点**圆心**相对节点边缘的外移量（世界单位）：静止位 = 20 + 半直径 */
export const PORT_CENTER_OFFSET = PORT_EDGE_GAP + PORT_SIZE / 2
/**
 * 端点的**命中半径**（世界单位，从圆心算）：视觉 14 的圆点再外扩 8px，
 * 于是"按住端点"不必精确点在圆点上（与老表面 `.port::after { inset: -8px }` 同一口径）。
 *
 * 三处共用：画端的命中方块（`portHits.PORT_HIT_SIZE`）、拖线的落点判定
 * （`useEdgeDrag.nodeAtPoint`）、以及点击"端点"时的容错。
 */
export const PORT_HIT_RADIUS = PORT_SIZE / 2 + 8
/** 0-50：完全弹出 + 吸附鼠标 */
export const PORT_REVEAL_FULL = 50
/** ≥70：完全收回（50→70 之间线性收回，60 正好收到一半 —— 用户点名的缓冲） */
export const PORT_REVEAL_END = 70
/** 纵向允许范围：节点上下边各再放宽这么多，超出就当作"鼠标已经离开这个节点" */
export const PORT_VERTICAL_PAD = 20

export interface PortReveal {
  /** 展开度 0..1：1 = 完全弹出在静止位，0 = 完全收回、贴住节点边缘 */
  progress: number
  /** 是否"感应到"：完全展开（可以吸附鼠标） */
  hot: boolean
  /**
   * 收回位移（**世界单位**，0 = 停在静止位）：把它加到端点的横向上，
   * 端点就沿"节点边缘 → 静止位"这条线弹出 / 收回。
   */
  pop: number
}

export interface PortRevealInput {
  /** 指针到节点**这一侧边缘**的横向距离（世界单位）；负数 = 指针在节点内 */
  edgeGap: number
  /** 指针的纵坐标（世界单位） */
  pointerY: number
  /** 节点**上下边**的纵坐标（世界单位） */
  nodeTop: number
  nodeBottom: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 这一刻端点该露多少。
 *
 * 三条边界（全部来自用户原话）：
 * - `edgeGap ≤ 50` ⇒ 完全展开（含负数：**指针在节点内**时保持悬停）；
 * - `50 < edgeGap < 70` ⇒ 线性收回（60 收到一半）；
 * - `edgeGap ≥ 70` ⇒ 完全收回，看不见。
 *
 * 纵向另有一条：指针必须还在节点上下边附近（±`PORT_VERTICAL_PAD`），
 * 否则算"鼠标已经离开这个节点" —— 少了它，鼠标在节点正上方 300px 处
 * 只要横向距离够近，端点也会冒出来。
 */
export function portReveal(input: PortRevealInput): PortReveal {
  const { edgeGap, pointerY, nodeTop, nodeBottom } = input
  const inBand = pointerY >= nodeTop - PORT_VERTICAL_PAD && pointerY <= nodeBottom + PORT_VERTICAL_PAD
  if (!inBand) return { progress: 0, hot: false, pop: PORT_EDGE_GAP }
  const span = PORT_REVEAL_END - PORT_REVEAL_FULL
  const progress = clamp01((PORT_REVEAL_END - edgeGap) / span)
  return {
    progress,
    hot: edgeGap <= PORT_REVEAL_FULL,
    pop: PORT_EDGE_GAP * (1 - progress),
  }
}
