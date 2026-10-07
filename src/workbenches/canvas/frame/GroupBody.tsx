import type { ReactNode } from 'react'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { groupFitSize } from '../../../domain/canvas/layout/packContainer'
import styles from './GroupBody.module.css'

export interface GroupBodyProps {
  /** 容器节点自身（取 childIds 作排序，与批量同一套） */
  node: NodeSnapshot
  /** 子节点快照（由 画布表面 注入，视图层不读图） */
  children?: NodeSnapshot[]
  /** 把子渲染成完整 frame（画布表面 注入） */
  renderChild?: (child: NodeSnapshot) => ReactNode
}

/**
 * 分组本体（用户 2026-10-06 第 14 批第 1 条：「打组其实就是一个背景板而已」）。
 *
 * 三条口径（都来自这条需求）：
 * ① 子节点**保持在画布中的比例与位置**：不排网格、不缩放、不吸附、不自动整理 ——
 *    它们存的是**相对本容器**的 local 坐标（§5.3），按 `child.x / child.y` 摆位即"回到原位"；
 * ② 底色**不在这里**：由 `FlowGroupBoardLayer` 画在**连线之下**（节点层在连线之上，
 *    画在这里就会盖住线，用户看到的就是"连线混乱"）；
 * ③ **没有空态文案 / 虚线框**：节点移出后不该留下"上一版分组节点"的残影（用户实测报过）。
 *
 * ⚠️ 与批量共用"容器"这个概念，但**布局是两套**：批量走 `ContainerBody` 的 3×3 网格，
 * 分组走这里。两者长得像、语义完全不同（见 `packContainer.groupFitSize` 的说明）。
 */
export function GroupBody({ children = [], renderChild }: GroupBodyProps) {
  const fit = groupFitSize(children)
  return (
    <div
      className={styles.body}
      data-container-body
      data-group-body
      data-group-child-count={children.length}
      data-group-min={`${fit.w}x${fit.h}`}
    >
      {children.map((child) => (
        <div key={child.id} className={styles.placed} style={{ left: child.x, top: child.y }}>
          {renderChild?.(child)}
        </div>
      ))}
    </div>
  )
}
