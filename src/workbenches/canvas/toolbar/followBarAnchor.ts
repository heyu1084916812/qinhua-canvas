/**
 * 节点跟随功能栏的**锚点几何**（用户 2026-09-16 需求）。
 *
 * 抽成纯函数的理由与 `staleReport` / `planSlots` 同款：这类几何换算一旦算错，
 * 界面上的表现是「栏飞到画布左上角」或「栏压在节点上」，看渲染截图极难定位，
 * 而作为纯函数可以直接断言（见 NodeFollowBar.test.ts）。
 *
 * 换算口径与创作面板（`panels/PanelLayer.tsx`）完全一致：
 *   屏幕 = (世界 − 视口平移) × zoom
 * 差别只有纵向：面板在节点**下方**，本栏在**上方**（标题之上）。
 *
 * **不做「上方装不下就翻到下方」**（用户 2026-09-17）：节点顶到画布顶端时，
 * 栏一律保持在上方。翻转会让栏在节点上下横跳——同一个节点，用户只是往上拖了一点，
 * 栏就从上面跳到下面，比「暂时被顶栏压住」更难用。位置稳定优先于始终可见。
 */
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { Rect } from '../../../domain/canvas/geometry/rect'

/**
 * 节点**标题带**的高度（屏幕 px）。
 *
 * `NodeFrame.module.css` 的 `.header` 是 22px 高、挂在节点框**上方**
 * （`bottom: 100%` + `margin-bottom: 2px`）⇒ 节点名与右上角像素读数占掉
 * 节点顶边之上 24px。
 *
 * 为什么要在这里把它记下来：跟随栏的锚点是「节点顶边 − 栏高 − 间距」，
 * 间距只要小于这条带的高度，栏就会**压在节点名上**（用户 2026-10-05：
 * 「功能栏也遮住了节点名称」）。把它抽成常数，栏与标题带的关系就是可断言的。
 */
export const NODE_TITLE_BAND = 24

/**
 * 栏目与节点框的间距（屏幕 px）。
 *
 * 2026-10-05：10 → 30（= 标题带 24 + 6 呼吸）。用户报「功能栏遮住了节点名称」——
 * 原先 10px 的间距让栏底落在标题带**中间**，节点名被压掉一半。
 */
export const FOLLOW_BAR_GAP = NODE_TITLE_BAND + 6
/** 栏高（屏幕 px）：按钮 26 + 内距 4×2 + 描边 1×2 ≈ 36，取整以稳定翻转判定 */
export const FOLLOW_BAR_HEIGHT = 36

export interface FollowBarAnchor {
  /** 栏目水平中心（屏幕 x），由调用方 `translateX(-50%)` 居中使用 */
  centerX: number
  /** 栏目顶边（屏幕 y）：恒为「节点顶边 − 栏高 − 间距」 */
  top: number
}

export function followBarAnchor(rect: Rect, viewport: Viewport): FollowBarAnchor {
  const centerX = (rect.x + rect.w / 2 - viewport.x) * viewport.zoom
  const topEdge = (rect.y - viewport.y) * viewport.zoom
  return { centerX, top: topEdge - FOLLOW_BAR_HEIGHT - FOLLOW_BAR_GAP }
}
