import type { CSSProperties } from 'react'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { GRID_SIZE, ZOOM_HIDE_GRID_BELOW, ZOOM_FADE_GRID_ABOVE } from '../../../domain/canvas/layout/constants'
import styles from './GridLayer.module.css'

/**
 * 网格层（屏幕空间，不随 world 变换）。
 * 背景位移与缩放由视口派生，缩放 <40% 隐藏、>200% 淡出（架构 §5.4 / 常量 §3）。
 */
export function GridLayer({ viewport }: { viewport: Viewport }) {
  if (viewport.zoom < ZOOM_HIDE_GRID_BELOW) return null
  const size = GRID_SIZE * viewport.zoom
  const opacity = viewport.zoom > ZOOM_FADE_GRID_ABOVE ? 0.4 : 1
  const style: CSSProperties = {
    opacity,
    backgroundImage:
      'linear-gradient(to right, var(--grid-line) 1px, transparent 1px),' +
      'linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)',
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${-viewport.x * viewport.zoom}px ${-viewport.y * viewport.zoom}px`,
  }
  return <div className={styles.grid} style={style} />
}
