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

/** 栏目与节点框的间距（屏幕 px） */
export const FOLLOW_BAR_GAP = 10
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
