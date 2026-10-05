import { memo } from 'react'
import {
  getBezierPath,
  useStore,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from '@xyflow/react'
import styles from './FlowEdge.module.css'

/** 边上的附加事实（由 FlowSurface 装配时注入：视图层不读图，架构 §4.7） */
export interface QhEdgeData extends Record<string, unknown> {
  /** 源 / 目标端口 id：与老表面同一口径，冒烟按 `data-edge-source-port` 等断言 */
  sourcePort: string
  targetPort: string
  /** 是否与当前选中的节点相连（§6.14：相关连线一并高亮并显示删除按钮） */
  related: boolean
  /** 删除这条边（由装配层接线到 `edge.remove`） */
  onDelete: (id: string) => void
}

/**
 * 画布的连线（RF 自定义边）。
 *
 * 为什么不用 RF 默认边：默认边只画 `<path class="react-flow__edge-path">`，**不带 `data-edge` 锚点**，
 * 而冒烟是按 `[data-edge]` 数连线的。这里自己画同一条贝塞尔，加上锚点 —— 既有 RF 的交互
 * （RF 把 `onClick` / `onDoubleClick` 挂在 `<g class="react-flow__edge">` 上，点这条路径一样生效），
 * 又保住了老锚点契约。
 *
 * 三件与"只画一条线"不同的事，都是老表面 §6.14 的既有行为：
 * 1. **透明加宽命中区**（`data-edge-hit`）：细线也要点得中；
 * 2. **末端锚点**：`data-edge-source` / `-target` / `-source-port` / `-target-port`
 *    （「谁是谁的上游」「谁接在融合节点的 patch 上」这些断言全靠它）；
 * 3. **删除按钮**（`data-edge-delete`）：选中连线、或选中了它的任一端节点时出现，
 *    点一下删掉这条边。RF 的坐标是**流坐标**（随缩放变化），而按钮要恒定大小 ⇒ 按 1/zoom 反向缩放。
 */
function QhEdgeInner(props: EdgeProps) {
  const zoom = useStore((s) => s.transform[2])
  const data = props.data as QhEdgeData | undefined
  // 第 2 个返回值就是贝塞尔 t=0.5 的点（标签位置），正好是删除按钮该待的地方
  const [path, midX, midY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  const active = !!props.selected || !!data?.related
  return (
    <>
      <path
        className={active ? `${styles.edge} ${styles.edgeActive}` : styles.edge}
        d={path}
        vectorEffect="non-scaling-stroke"
        data-edge={props.id}
        data-edge-source={props.source}
        data-edge-target={props.target}
        data-edge-source-port={data?.sourcePort}
        data-edge-target-port={data?.targetPort}
      />
      {/* 命中区：不是自己接点击，而是让 `<g>` 上那两个 RF 处理器收得到（点 = 选中，双击 = 删） */}
      <path
        className={styles.hit}
        d={path}
        vectorEffect="non-scaling-stroke"
        strokeWidth={props.interactionWidth ?? 20}
        data-edge-hit={props.id}
      />
      {active && (
        <g
          className={styles.deleteBtn}
          data-edge-delete={props.id}
          transform={`translate(${midX}, ${midY}) scale(${1 / (zoom || 1)})`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            data?.onDelete(props.id)
          }}
        >
          <circle className={styles.deleteCircle} r={9} />
          <path className={styles.deleteCross} d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" />
        </g>
      )}
    </>
  )
}

export const QhEdge = memo(QhEdgeInner)

/**
 * 拖线过程中的**草稿曲线**（§6.14）。
 *
 * 老表面自己画（`data-edge-draft`，可见源各一条）；RF 面用官方入口 `connectionLineComponent`
 * 接管同一条曲线，锚点不变 —— 冒烟按 `[data-edge-draft]` 数它。
 * 可连接 = 常态高亮色，不可连接 = 危险色（`connectionStatus` 由 RF 按 `isValidConnection` 给出；
 * 指针在空白处时是 `null`，按常态色画）。
 */
export function QhConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  })
  return (
    <path
      className={connectionStatus === 'invalid' ? `${styles.draft} ${styles.draftInvalid}` : styles.draft}
      d={path}
      vectorEffect="non-scaling-stroke"
      data-edge-draft
    />
  )
}
