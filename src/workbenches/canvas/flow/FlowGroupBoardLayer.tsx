import { memo, useMemo } from 'react'
import { useGraph, useViewportState } from '../storeContext'
import { groupBoards } from './groupBoards'
import styles from './FlowGroupBoardLayer.module.css'

/**
 * 分组的背景板层（**画在连线之下**，用户 2026-10-06 第 14 批第 1 条：
 * 「打组其实就是一个背景板而已」「显示优先级要低于连线」）。
 *
 * 为什么必须是独立一层：RF 的节点层在连线层之上 —— 把底色画在分组节点上就一定会盖线。
 * 这一层渲染在 `<ReactFlow>` 之前 ⇒ 在连线之下；分组节点自己保持透明，
 * 子节点仍画在节点层（连线之上），所以"穿过分组背景的连线看得见、子节点又压在连线之上"。
 *
 * 两段算（与 `FlowPortLayer` / `FlowDraftLayer` 同一条手法）：矩形只跟图走，
 * 视口换算挂在一个 `transform` 上 ⇒ 平移 / 缩放帧只改一个属性。
 */
export function FlowGroupBoardLayer() {
  const graph = useGraph()
  const boards = useMemo(() => groupBoards(graph), [graph])
  return <BoardViewport boards={boards} />
}

const BoardViewport = memo(function BoardViewport({
  boards,
}: {
  boards: ReturnType<typeof groupBoards>
}) {
  const viewport = useViewportState()
  const zoom = viewport.zoom || 1
  if (boards.length === 0) return null
  return (
    <div className={styles.clip} data-group-board-layer>
      <div
        className={styles.layer}
        style={{ transform: `translate(${-viewport.x * zoom}px, ${-viewport.y * zoom}px) scale(${zoom})` }}
      >
        {boards.map((b) => (
          <div
            key={b.id}
            className={styles.board}
            data-group-board={b.id}
            data-group-bg={b.bg}
            style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
          />
        ))}
      </div>
    </div>
  )
})
