import type { Rect } from '../../../domain/canvas/geometry/rect'
import styles from './OverlayLayer.module.css'

/**
 * 覆盖层：框选矩形（连线预览 / 拖线预览在后续里程碑接入）。
 *
 * 坐标约定：**surface 局部屏幕坐标**（不是 world）。
 * 本层在 `[data-world]` 之外，不随视口 transform 变换；
 * 框选时把屏幕矩形换算成世界矩形去命中节点即可（见 CanvasSurface）。
 * 好处是矩形边框恒为 1px，不会在 500% 缩放下变成 5px。
 */
export function OverlayLayer({ marquee }: { marquee: Rect | null }) {
  if (!marquee) return null
  return (
    <div
      className={styles.marquee}
      data-marquee
      style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
    />
  )
}
