import { useMemo, type ReactNode } from 'react'
import type { GroupBgTone } from '../../../domain/canvas/model/node'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import {
  packContainerChildren,
  containerMinSize,
  containerScale,
} from '../../../domain/canvas/layout/packContainer'
import styles from './ContainerBody.module.css'
import { useDraggingId } from '../storeContext'

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
  /**
   * 背景色档位（只有分组用；批量不挑色 ⇒ 不传，样式里回落到缺省档）。
   * 值来自 `groupBgOf(node)`（缺字段 / 非法值已经在那边归一过）。
   */
  bg?: GroupBgTone
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
  const { node, kind, children = [], renderChild, bg } = props
  const childIds = (node.data as { childIds?: string[] }).childIds ?? []
  const ordered = useMemo(() => orderChildren(children, childIds), [children, childIds])
  const packs = useMemo(() => packContainerChildren(ordered.length), [ordered.length])
  const min = containerMinSize(kind, ordered.length)
  /**
   * ★★ 放大容器 ⇒ **里面的单元与素材同步放大**（用户第 15 批 #335-①：
   * 「随时随地都要保持里面子容器和边缘的留白规则，一直保持那个数值的留白，
   *  如果放大批量节点的话，里面的子节点和素材同步放大，这样才能保持规则」）。
   *
   * 做法：单元仍按**基准网格**摆（`packContainerChildren` 的 200×160 + 16 间距 + 20 内边距），
   * 整层再乘一个**等比**系数 `k = min(宽比, 高比)`。这样四边的留白**比例**恒定不变
   *（不乘 `k` 的话，把框拉大只会多出一圈空白，"留白规则"就破了）；
   * 取 `min` 是保证**不变形**——某一轴多出来的部分表现为那一边更宽的留白，
   * 总比把素材拉扁好（缩放锁是自由的，用户可能只往一个方向拉）。
   *
   * 基准尺寸 = `min`（该子节点数下的网格贴合尺寸）⇒ `k ≥ 1`（下限就是基准，拉不小）。
   */
  const k = containerScale(kind, ordered.length, { w: node.w, h: node.h })
  /**
   * ★ 批量：单元位置由**格位**决定（不是子节点自己的 x/y）⇒ 直接画看不出拖动
   * （用户第 15 批 #335-③：「子节点可以点击+拖动出批量节点，但是我看不到拖动」）。
   * 把"正在拖的那一个"的位移叠上去：拖动开始时坐标已被归一成格位
   * （见 `onChildPointerDown`）⇒ `child.x - cell.x` 就是**这一趟**的真实位移。
   */
  const draggingId = useDraggingId()

  return (
    <div
      className={styles.body}
      data-container-body
      {...(bg ? { 'data-container-bg': bg } : {})}
      {...{ [`data-${kind}-body`]: '' }}
      {...{ [`data-${kind}-child-count`]: ordered.length }}
      {...{ [`data-${kind}-min`]: `${min.w}x${min.h}` }}
      {...{ [`data-${kind}-scale`]: k.toFixed(3) }}
    >
      {/* 缩放层：基准网格写在里面，整体乘 `k`（`transform-origin: 0 0` ⇒ 从左上角长出去） */}
      <div
        className={styles.scaleLayer}
        data-container-scale-layer
        style={{ width: min.w, height: min.h, transform: `scale(${k})` }}
      >
        {ordered.map((child, i) => {
          const cell = packs.positions[i] ?? { x: 0, y: 0 }
          const dragging = kind === 'batch' && draggingId === child.id
          return (
            <div
              key={child.id}
              className={styles.cell}
              style={{
                left: cell.x,
                top: cell.y,
                ...(dragging
                  ? { transform: `translate(${child.x - cell.x}px, ${child.y - cell.y}px)` }
                  : {}),
              }}
            >
              {renderChild?.(child)}
            </div>
          )
        })}
      </div>

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
export function orderChildren<T extends Pick<NodeSnapshot, 'id'>>(children: T[], childIds: string[]): T[] {
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
