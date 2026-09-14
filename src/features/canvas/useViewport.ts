import { useCallback, useRef } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { Viewport } from '../../domain/canvas/geometry/coords'
import type { Rect } from '../../domain/canvas/geometry/rect'
import { zoomAt, panBy } from '../../domain/canvas/geometry/transform'
import { coalescePointerMove } from '../../shared/rafThrottle'

/**
 * 视口交互控制器（架构 §2.3：交互逻辑放在独立 hook，可被画布 / 画板 / 小地图复用）。
 * 平移与缩放只改 store.viewport，不触发节点重渲染（架构 §5.4）。
 *
 * 注意：features 不能反向依赖 workbenches，故以 store 实例为参数。
 */
export function useViewport(store: CanvasStore) {
  const panState = useRef<{ startX: number; startY: number; vp: Viewport } | null>(null)

  /** 滚轮以光标为锚点缩放（架构 §5.4 / §6.11）。
   *  滚轮不合帧：每次 delta 都是独立的缩放步长，丢弃中间事件会改变最终缩放。 */
  const onWheel = useCallback(
    (e: React.WheelEvent, rect: Rect) => {
      const vp = store.getViewport()
      const factor = Math.exp(-e.deltaY * 0.0015)
      const next = zoomAt(vp, { x: e.clientX, y: e.clientY }, rect, vp.zoom * factor)
      store.setViewport(next)
    },
    [store],
  )

  /** 在空白画布按下并拖动 → 平移（pointermove 经 rAF 合帧，§1.7） */
  const beginPan = useCallback(
    (e: React.PointerEvent) => {
      const vp = store.getViewport()
      panState.current = { startX: e.clientX, startY: e.clientY, vp }
      const applyMove = (ev: PointerEvent) => {
        const s = panState.current
        if (!s) return
        store.setViewport(panBy(s.vp, ev.clientX - s.startX, ev.clientY - s.startY))
      }
      const move = coalescePointerMove(applyMove)
      const up = () => {
        panState.current = null
        move.flush() // 补上最后一拍，终点与光标一致
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [store],
  )

  return { onWheel, beginPan }
}
