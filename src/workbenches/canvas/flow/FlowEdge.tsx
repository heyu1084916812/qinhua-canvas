import { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * 画布的连线（RF 自定义边）。
 *
 * 为什么不用 RF 默认边：默认边只画 `<path class="react-flow__edge-path">`，**不带 `data-edge` 锚点**，
 * 而冒烟是按 `[data-edge]` 数连线的。这里自己画同一条贝塞尔，加上锚点 —— 既有 RF 的交互
 * （选中 / 删除 / 命中用的 interaction path 由 RF 自己补），又保住了老锚点契约。
 */
function QhEdgeInner(props: EdgeProps) {
  const [path] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  return <path className="react-flow__edge-path" d={path} data-edge={props.id} />
}

export const QhEdge = memo(QhEdgeInner)
