import { memo, type ReactNode } from 'react'
import { useCanvasStore, useEdgeSelection, useSelection, useViewportState } from '../storeContext'
import type { LinkDraft } from '../../../features/canvas/useEdgeDrag'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { Edge } from '../../../domain/canvas/model/edge'
import { toWorldRect } from '../../../domain/canvas/geometry/coords'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import styles from './EdgeLayer.module.css'

/** 贝塞尔曲线的控制点与端点（源右中 → 目标左中）；输入为 world 矩形 */
function portPoints(source: Rect, target: Rect) {
  const sx = source.x + source.w
  const sy = source.y + source.h / 2
  const tx = target.x
  const ty = target.y + target.h / 2
  const dx = Math.max(40, Math.abs(tx - sx) / 2)
  return { sx, sy, tx, ty, c1x: sx + dx, c2x: tx - dx }
}

type PortPoints = ReturnType<typeof portPoints>

function toPath(p: PortPoints): string {
  return `M ${p.sx} ${p.sy} C ${p.c1x} ${p.sy}, ${p.c2x} ${p.ty}, ${p.tx} ${p.ty}`
}

/** 自由端点的草稿曲线：两端横向延展，方向随拖动端点侧翻转 */
function draftPath(d: LinkDraft): string {
  const dx = Math.max(40, Math.abs(d.to.x - d.from.x) / 2)
  if (d.side === 'output') {
    return `M ${d.from.x} ${d.from.y} C ${d.from.x + dx} ${d.from.y}, ${d.to.x - dx} ${d.to.y}, ${d.to.x} ${d.to.y}`
  }
  return `M ${d.from.x} ${d.from.y} C ${d.from.x - dx} ${d.from.y}, ${d.to.x + dx} ${d.to.y}, ${d.to.x} ${d.to.y}`
}

/** 曲线的近似中点（Bezier t=0.5）：用于放置删除按钮 */
function midPoint(p: PortPoints) {
  // B(0.5) = (P0 + 3P1 + 3P2 + P3) / 8；y 的两个控制点高度等于端点高度
  return {
    x: (p.sx + 3 * p.c1x + 3 * p.c2x + p.tx) / 8,
    y: (p.sy + p.ty) / 2,
  }
}

/**
 * 世界变换组：连线层挂在 `[data-world]` 之外（原因见 EdgeLayer 注释），
 * 世界坐标 → 屏幕坐标的换算由这个 `<g>` 承担。
 *
 * 为什么用「内层 <g> + 独立订阅 viewport」而不是外层 CSS transform：
 * 平移 / 缩放帧只更新 <g> 的 transform 属性，外层 memo(EdgeLayer) 的 props 不变、
 * 其 children 元素引用也不变，React 直接跳过子树 → 500 条曲线不重排（与改造前等价）。
 * 变换用 SVG 属性形式（无单位数字，绕用户空间原点）——避开 CSS transform-origin
 * 在 SVG 元素上依赖 transform-box 的坑。
 */
function EdgeWorld({ children }: { children: ReactNode }) {
  const viewport = useViewportState()
  return (
    <g
      data-edge-world
      transform={`translate(${-viewport.x * viewport.zoom}, ${-viewport.y * viewport.zoom}) scale(${viewport.zoom})`}
    >
      {children}
    </g>
  )
}

/**
 * 连线层（铺满 surface 的屏幕空间 SVG，内部 `<g>` 承担视口变换）。
 * 产品文档 §6.14：常态 `#C9C9D1` 1.5px；单击连线选中变色进入可删除态；
 * 节点选中时其上下游连线同时高亮，每条相关连线上出现删除按钮；双击连线直接删除。
 * 另绘制拖线中的草稿曲线（可连接常态色 / 不可连接 `--danger`）。
 *
 * memo：props（graph 引用 / draft 引用）在平移 / 缩放帧不变，跳过 500 条曲线的重排。
 *
 * ⚠️ 本 SVG **不能**放回 `[data-world]`（0×0 的 div）内：`.world` 靠「0 尺寸 + overflow
 * 溢出」承载节点层是有效的，但 `<svg>` 是特例——Chrome 对退化尺寸（0×0）的 SVG 根
 * **完全不绘制其内容**，`overflow: visible` 也救不回来（连线相关断言仍全绿，因为
 * DOM / 样式 / getBoundingClientRect / elementFromPoint 全都正常，只是屏幕上没有线）。
 */
export const EdgeLayer = memo(function EdgeLayer({
  nodes,
  edges,
  draft,
}: {
  nodes: NodeSnapshot[]
  edges: Edge[]
  draft?: LinkDraft | null
}) {
  const store = useCanvasStore()
  const selection = useSelection()
  const selectedEdgeIds = useEdgeSelection()

  const byId = new Map(nodes.map((n) => [n.id, n]))
  // 父级查找直接用 byId（id → 节点本体）；误建 parentId → 子节点 映射会使
  // 子节点世界矩形双重偏移、连线端点错位（G21 冒烟教训）

  // 节点选中时，其上下游相关连线集合（高亮 + 显示删除按钮）
  const selectedNodeIds = new Set(selection)
  const relatedEdgeIds = new Set(
    edges
      .filter((e) => selectedNodeIds.has(e.source) || selectedNodeIds.has(e.target))
      .map((e) => e.id),
  )
  const selectedEdgeSet = new Set(selectedEdgeIds)

  const removeEdge = (id: string) => store.dispatch({ kind: 'edge.remove', id })

  const draftD = draft ? draftPath(draft) : null

  if (!edges.length && !draftD) return null

  return (
    <svg className={styles.svg} aria-hidden>
      <EdgeWorld>
        {draftD && (
          <path
            className={draft?.invalid ? `${styles.draft} ${styles.draftInvalid}` : styles.draft}
            d={draftD}
            vectorEffect="non-scaling-stroke"
            data-edge-draft
          />
        )}
        {edges.map((e) => {
          const s = byId.get(e.source)
          const t = byId.get(e.target)
          if (!s || !t) return null
          // 画板内子节点用世界坐标（parent 偏移）定位连线端点
          const ws = toWorldRect(s, s.parentId ? byId.get(s.parentId) : null)
          const wt = toWorldRect(t, t.parentId ? byId.get(t.parentId) : null)
          const p = portPoints(ws, wt)
          const d = toPath(p)
          const active = selectedEdgeSet.has(e.id) || relatedEdgeIds.has(e.id)
          const mid = midPoint(p)
          return (
            <g key={e.id}>
              {/* 透明加宽命中路径：便于点选细线 */}
              <path
                className={styles.hit}
                d={d}
                vectorEffect="non-scaling-stroke"
                data-edge-hit={e.id}
                onPointerDown={(ev) => {
                  ev.stopPropagation()
                  store.setEdgeSelection([e.id])
                }}
                onDoubleClick={(ev) => {
                  ev.stopPropagation()
                  removeEdge(e.id)
                }}
              />
              <path
                className={active ? `${styles.edge} ${styles.edgeActive}` : styles.edge}
                d={d}
                vectorEffect="non-scaling-stroke"
                data-edge={e.id}
                /* 方向也写进 DOM：连线画得再像，方向反了语义就全反了
                   （§6.7「反推」取的是**上游**图）——冒烟据此断言「谁是谁的上游」。 */
                data-edge-source={e.source}
                data-edge-target={e.target}
              />
              {active && (
                <g
                  className={styles.deleteBtn}
                  data-edge-delete={e.id}
                  transform={`translate(${mid.x}, ${mid.y})`}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    removeEdge(e.id)
                  }}
                >
                  <circle className={styles.deleteCircle} r={9} vectorEffect="non-scaling-stroke" />
                  <path
                    className={styles.deleteCross}
                    d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </g>
          )
        })}
      </EdgeWorld>
    </svg>
  )
})
