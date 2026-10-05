import { useMemo, type ReactNode } from 'react'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { packContainerChildren, containerMinSize } from '../../../domain/canvas/layout/packContainer'
import styles from './ContainerBody.module.css'

export interface ContainerBodyProps {
  /** 容器节点自身（取类型与 data.childIds 作排序键） */
  node: NodeSnapshot
  /** 容器类型，决定空态最小尺寸与 data-* 前缀 */
  kind: 'group' | 'batch'
  /** 子节点快照（由 画布表面 注入，视图层不读图） */
  children?: NodeSnapshot[]
  /** 把子渲染成完整 frame（画布表面 注入） */
  renderChild?: (child: NodeSnapshot) => ReactNode
  /** 空态主文案 */
  emptyText: string
  /** 空态副文案 */
  emptyHint: string
}

/**
 * 固定比例容器本体（产品文档 §6.11 / §6.12）。
 *
 * 分组与批量的容器**形态完全一致**（文档：批量「固定比例容器布局规则与分组节点一致」），
 * 只有收纳物语义不同。因此形态逻辑（3×3 行优先网格、5:4 单元、动态最小尺寸、空态）
 * 只写一份，两个视图各自注入自己的空态文案与 data-* 前缀。
 *
 * 子节点由 画布表面 递归渲染成完整 frame 后注入，这里只负责按网格摆位；
 * 子节点的 local x/y 由网格决定，故渲染时归零（见 画布表面）。
 */
export function ContainerBody(props: ContainerBodyProps) {
  const { node, kind, children = [], renderChild } = props
  const childIds = (node.data as { childIds?: string[] }).childIds ?? []
  const ordered = useMemo(() => orderChildren(children, childIds), [children, childIds])
  const packs = useMemo(() => packContainerChildren(ordered.length), [ordered.length])
  const min = containerMinSize(kind, ordered.length)

  return (
    <div
      className={styles.body}
      data-container-body
      {...{ [`data-${kind}-body`]: '' }}
      {...{ [`data-${kind}-child-count`]: ordered.length }}
      {...{ [`data-${kind}-min`]: `${min.w}x${min.h}` }}
    >
      {ordered.map((child, i) => {
        const cell = packs.positions[i] ?? { x: 0, y: 0 }
        return (
          <div key={child.id} className={styles.cell} style={{ left: cell.x, top: cell.y }}>
            {renderChild?.(child)}
          </div>
        )
      })}

      {ordered.length === 0 && (
        <div className={styles.empty} data-container-empty {...{ [`data-${kind}-empty`]: '' }}>
          <span className={styles.emptyText}>{props.emptyText}</span>
          <span className={styles.emptyHint}>{props.emptyHint}</span>
        </div>
      )}
    </div>
  )
}

/**
 * 子节点顺序：`data.childIds` 是排序依据，但以图（parentId）为准——
 * 这样刚拖入、childIds 还没同步的节点也不会漏掉（§6.11 / §6.12「内部拖动改顺序」）。
 */
function orderChildren<T extends Pick<NodeSnapshot, 'id'>>(children: T[], childIds: string[]): T[] {
  const byId = new Map(children.map((c) => [c.id, c] as const))
  const out: T[] = []
  for (const id of childIds) {
    const c = byId.get(id)
    if (c) {
      out.push(c)
      byId.delete(id)
    }
  }
  for (const c of children) if (byId.has(c.id)) out.push(c)
  return out
}
