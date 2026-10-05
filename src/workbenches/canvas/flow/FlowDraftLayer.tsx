import { useViewportState } from '../storeContext'
import type { LinkDraft } from '../../../features/canvas/useEdgeDrag'
import styles from './FlowDraftLayer.module.css'

interface ScreenPoint {
  x: number
  y: number
}

/**
 * 一条草稿曲线（**屏幕坐标**，与老表面 `EdgeLayer.draftPath` 同一条形状）：
 * 两端横向延展，方向随**被拖端点所在的那一侧**翻转 —— 用几何侧（`fromSide`）而不是
 * 入 / 出语义：融合节点的 `patch` 是"输入口但长在右侧"，按语义判会朝左伸、线从节点里穿出去。
 */
function draftPath(from: ScreenPoint, to: ScreenPoint, fromSide: 'left' | 'right', zoom: number): string {
  const dx = Math.max(40 * zoom, Math.abs(to.x - from.x) / 2)
  if (fromSide === 'right') {
    return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
  }
  return `M ${from.x} ${from.y} C ${from.x - dx} ${from.y}, ${to.x + dx} ${to.y}, ${to.x} ${to.y}`
}

/**
 * 拖线草稿（§6.14）：老表面那套拖线控制器（`useEdgeDrag`）在 RF 面上没有 `EdgeLayer` 可画，
 * 这里补上同一件事，锚点 `data-edge-draft` 不变（冒烟按它数草稿线）。
 *
 * **多选"共有端点"时每个源各一条**（`alsoFrom`，用户 2026-10-05 第 3 批）：
 * 功能上每个节点都连上了，但只画一条线时读起来像"只连了一个"。
 */
export function FlowDraftLayer({ draft }: { draft: LinkDraft | null }) {
  const viewport = useViewportState()
  if (!draft) return null
  const toScreen = (p: { x: number; y: number }): ScreenPoint => ({
    x: (p.x - viewport.x) * viewport.zoom,
    y: (p.y - viewport.y) * viewport.zoom,
  })
  const to = toScreen(draft.to)
  const paths = [draft.from, ...(draft.alsoFrom ?? [])].map((from) =>
    draftPath(toScreen(from), to, draft.fromSide, viewport.zoom),
  )
  return (
    <svg className={styles.svg} aria-hidden>
      {paths.map((d, i) => (
        <path
          key={i}
          className={draft.invalid ? `${styles.draft} ${styles.draftInvalid}` : styles.draft}
          d={d}
          vectorEffect="non-scaling-stroke"
          data-edge-draft
        />
      ))}
    </svg>
  )
}
