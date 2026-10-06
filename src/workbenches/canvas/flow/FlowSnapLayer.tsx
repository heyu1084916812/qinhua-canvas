import { useSnapHints, useViewportState } from '../storeContext'
import styles from './FlowSnapLayer.module.css'

/**
 * 拖动吸附的**提示层**（对账 #257）：参考线 + 间距数字（参考图里那个"108"）。
 *
 * ## 为什么画在**屏幕坐标**里
 *
 * 与 `FlowDraftLayer` 同一条路子：把世界坐标自己换算成屏幕坐标，
 * 这样线宽与数字字号**不随缩放变化** —— 缩到 30% 时参考线还是一条 1px 的线、
 * 数字还是 11px 的字（放进 viewport 里就都得再乘一次 `1/zoom` 去抵消，反而绕）。
 *
 * 层本身 `pointer-events: none`：它只在拖动时出现，绝不能吃掉画布上的指针事件。
 *
 * ## 徽标为什么贴"重叠区上沿"而不是居中
 *
 * 用户给的参考图里那个"108"就贴在两个节点之间的**靠上**位置。居中在长节点旁边
 * 会飘到离视线很远的地方（两个节点一个 240 高、一个 800 高时尤其明显）。
 */
export function FlowSnapLayer() {
  const hints = useSnapHints()
  const viewport = useViewportState()
  if (!hints || (hints.guides.length === 0 && hints.gaps.length === 0)) return null

  const sx = (x: number) => (x - viewport.x) * viewport.zoom
  const sy = (y: number) => (y - viewport.y) * viewport.zoom

  return (
    <div className={styles.layer} data-snap-layer aria-hidden>
      <svg className={styles.svg}>
        {hints.guides.map((g, i) =>
          g.axis === 'x' ? (
            <line
              key={`x${i}`}
              className={styles.guide}
              x1={sx(g.at)}
              y1={sy(g.from)}
              x2={sx(g.at)}
              y2={sy(g.to)}
              data-snap-guide="x"
            />
          ) : (
            <line
              key={`y${i}`}
              className={styles.guide}
              x1={sx(g.from)}
              y1={sy(g.at)}
              x2={sx(g.to)}
              y2={sy(g.at)}
              data-snap-guide="y"
            />
          ),
        )}
      </svg>
      {hints.gaps.map((gap, i) => (
        <span
          key={`gap${i}`}
          className={styles.badge}
          data-snap-gap={gap.axis}
          style={{
            left: sx(gap.x),
            /* 往下让 12px：参考图里那个数字是贴在两个节点顶边下面一点的 */
            top: sy(gap.y) + 12,
            transform:
              gap.axis === 'x' ? 'translate(-50%, 0)' : 'translate(0, -50%)',
          }}
        >
          {Math.round(gap.value)}
        </span>
      ))}
    </div>
  )
}
