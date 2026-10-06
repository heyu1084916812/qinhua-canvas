import { memo, useMemo } from 'react'
import { useGraph, useSelection, useViewportState } from '../storeContext'
import { useCanvasStore } from '../storeContext'
import { childEdgePaths } from './childEdges'
import styles from './FlowChildEdgeLayer.module.css'

/**
 * 牵涉**容器子节点**的边的绘制层（屏幕空间 SVG）。
 *
 * 数据侧（`canConnect` + `useEdgeDrag.expandContainers`）保证这类边建得出来，
 * 这一层保证它**看得见**：从组端点拉出来的线是"组内每个成员各一条"，
 * 不画出来用户只会看到"拖了一下、什么都没发生"（用户 2026-10-06 第 13 批第 5 条
 * 要的就是"把组内的下游都拉一条线出来"）。
 *
 * 分两段算（与 `FlowPortLayer` 同一条手法）：**路径只跟图与选中走**，
 * 视口换算挂在一个 `transform` 上 —— 平移 / 缩放帧只改一个属性，子树的 props 不变。
 */
export function FlowChildEdgeLayer() {
  return <ChildEdgeViewport />
}

const ChildEdgeViewport = memo(function ChildEdgeViewport() {
  const graph = useGraph()
  const selection = useSelection()
  const viewport = useViewportState()
  const store = useCanvasStore()
  const drawn = useMemo(
    () => childEdgePaths(graph, viewport, selection),
    [graph, viewport, selection],
  )
  if (drawn.length === 0) return null
  return (
    <svg className={styles.svg} aria-hidden={false}>
      {drawn.map((p) => (
        <g key={p.id}>
          <path
            className={p.related ? `${styles.edge} ${styles.edgeActive}` : styles.edge}
            d={p.d}
            vectorEffect="non-scaling-stroke"
            data-edge
            data-child-edge
          />
          <path
            className={styles.hit}
            d={p.d}
            vectorEffect="non-scaling-stroke"
            data-child-edge-hit
            onDoubleClick={() => store.dispatch({ kind: 'edge.remove', id: p.id })}
          />
        </g>
      ))}
    </svg>
  )
})
