import { useGraph, useCanvasStore } from '../storeContext'
import type { ReactNode } from 'react'
import {
  resultGroupCells,
  resultGroupViewRect,
} from '../../../domain/canvas/layout/resultGroupLayout'
import { RESULT_CELL } from '../../../domain/canvas/layout/constants'
import { toWorldRect } from '../../../domain/canvas/geometry/coords'
import { useAsset } from '../hooks/useAsset'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { GenerationData } from '../../../domain/canvas/model/node'
import styles from './ResultGroupLayer.module.css'

/**
 * 结果组层（产品文档 §6.9）：把图快照里的每个结果组渲染成容器框 + 内部逐张结果。
 *
 * **组内子结果是真节点**（M6-25）：它们是 `type=generation` 的标准节点
 * （`parentId` 指向结果组），由 NodeLayer 注入的 `renderChild` 渲染成同一个
 * `NodeFrame` + 生成节点 View —— 于是选中 / 拖动（= 取出）/ 双击灯箱 / 删除 /
 * 复制粘贴全部与顶层节点同源，本层不必另写一套交互。
 * NodeLayer 因此不再渲染 `parentId` 非空的节点（避免重复画框）。
 *
 * 折叠态（§6.9）：容器收缩成 `COLLAPSED_SIZE`，只画封面 + 成功/失败汇总；
 * 指向组内子结果的连线由 EdgeLayer 汇成一条总线（见 `domain/canvas/graph/collapsedBus`）。
 * 几何走 `resultGroupViewRect` —— 折叠框是**现算的呈现量**，不写回持久的 rg。
 */
export function ResultGroupLayer({
  renderChild,
}: {
  /** 由 NodeLayer 注入：把组内子结果渲染成真节点（与顶层节点同一套 frame 接线） */
  renderChild?: (child: NodeSnapshot, opts?: { preserveCoords?: boolean }) => ReactNode
}) {
  const graph = useGraph()
  const store = useCanvasStore()
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  return (
    <>
      {graph.resultGroups.map((rg) => {
        const children = rg.childIds
          .map((id) => byId.get(id))
          .filter((n): n is NodeSnapshot => !!n)
        const source = byId.get(rg.sourceNodeId)
        const sourceRect = source
          ? toWorldRect(source, source.parentId ? byId.get(source.parentId) ?? null : null)
          : null
        const rect = resultGroupViewRect(rg, sourceRect)
        /**
         * 格位用**组内局部坐标**（容器原点 0,0）——不是世界坐标。
         *
         * `.group` 自己是 `position: absolute`，于是它**就是**这些绝对定位缩略图的
         * 包含块：传世界坐标会被二次累加（组偏移 + 格位偏移），缩略图整片飞到框外，
         * 而「数 img 有几个」这类断言照样全绿 —— 这个洞一直没人看见。
         */
        const cells = rg.collapsed
          ? []
          : resultGroupCells({
              containerRect: { x: 0, y: 0, w: rg.w, h: rg.h },
              count: children.length,
              cell: RESULT_CELL,
            })

        return (
          <div
            key={rg.id}
            className={styles.group}
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            data-result-group={rg.id}
            data-collapsed={rg.collapsed ? 'true' : 'false'}
          >
            <div className={styles.header}>
              <span className={styles.count}>{children.length} 张结果</span>
              <button
                type="button"
                className={styles.toggle}
                data-result-group-toggle
                title={rg.collapsed ? '展开结果组' : '折叠结果组'}
                aria-label={rg.collapsed ? '展开结果组' : '折叠结果组'}
                aria-expanded={!rg.collapsed}
                onClick={(e) => {
                  // 整组 pointer-events:none，只有标题栏这一颗按钮可点；
                  // 别让点击冒泡到画布（否则会顺手清空选择）
                  e.stopPropagation()
                  store.dispatch({ kind: 'resultGroup.setCollapsed', id: rg.id, collapsed: !rg.collapsed })
                }}
              >
                {rg.collapsed ? '▸' : '▾'}
              </button>
            </div>
            {rg.collapsed ? (
              <CollapsedBody
                cover={children[0]}
                success={children.length}
                failed={rg.summary.failed}
              />
            ) : (
              children.map((child, i) =>
                renderChild ? (
                  // 子结果的 local 坐标就是格位（创建时由 resultGroupCells 落库），
                  // 拖动后若发生增删由 reducer 重排 —— 这里不再另算一遍格位。
                  renderChild(child, { preserveCoords: true })
                ) : (
                  <ChildThumb key={child.id} node={child} rect={cells[i]!} />
                ),
              )
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * 折叠态：封面 + 状态汇总（§6.9「折叠后只显示封面、数量与状态汇总」）。
 *
 * **成功数取 `children.length` 而非 `rg.summary`**：summary 只在 `resultGroup.create`
 * 时写过一次 `{success: 0, failed: 0}`，此后**从没被更新过**（执行引擎不回写它）；
 * 直接照抄就会在装着 4 张图的组上写「成功 0」—— 一个假数字比没数字更糟。
 * 同理，**失败数只在真有记录时才显示**：未知 ≠ 0。
 */
function CollapsedBody({
  cover,
  success,
  failed,
}: {
  cover: NodeSnapshot | undefined
  success: number
  failed: number
}) {
  const hash = cover ? (cover.data as GenerationData).assetHash : undefined
  const url = useAsset(hash)
  return (
    <div className={styles.collapsed}>
      {url ? (
        <img className={styles.cover} src={url} alt="" draggable={false} data-result-group-cover />
      ) : (
        <div className={styles.coverEmpty} />
      )}
      <div
        className={failed > 0 ? `${styles.summary} ${styles.summaryFailed}` : styles.summary}
        data-result-group-summary
      >
        {failed > 0 ? `成功 ${success} / 失败 ${failed}` : `成功 ${success}`}
      </div>
    </div>
  )
}

function ChildThumb({
  node,
  rect,
}: {
  node: NodeSnapshot
  rect: { x: number; y: number; w: number; h: number }
}) {
  const hash = (node.data as GenerationData).assetHash
  const url = useAsset(hash)
  return (
    <div className={styles.thumb} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      {url ? <img src={url} alt={(node.data as GenerationData).prompt ?? '结果'} draggable={false} /> : null}
    </div>
  )
}
