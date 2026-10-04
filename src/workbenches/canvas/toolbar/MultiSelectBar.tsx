import { useCallback, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { ARRANGE_MODES } from '../../../domain/canvas/layout/arrangeModes'
import { useArrangeTools } from '../../../features/canvas/useArrangeTools'
import { groupNodes } from '../../../features/canvas/groupNodes'
import { saveAssetToLibrary } from '../../../features/canvas/saveAssetToLibrary'
import { noOverlapDelta } from '../../../features/canvas/duplicatePlacement'
import { sendSelectionToAgent } from '../../../features/canvas/agentHandoff'
import { createId } from '../../../shared/id'
import { useCanvasStore, useGraph, useSelection, useViewportState } from '../storeContext'
import { FOLLOW_BAR_HEIGHT } from './followBarAnchor'
import {
  IconDownload,
  IconDuplicate,
  IconGridArrange,
  IconGroup,
  IconMention,
  IconStar,
} from './icons'
import styles from './MultiSelectBar.module.css'

/**
 * 虚线框相对选区**往外扩多少**（屏幕 px）——用户 2026-10-05 第 6 条：
 * 「虚线框要大一点，不要遮住节点的名称还有左右的端点」。
 *
 * - 上边 30：让出节点标题带（节点框上方那 24px 的标题 + 读数，理由与跟随栏同一条，
 *   见 `followBarAnchor.NODE_TITLE_BAND`）；
 * - 左右下 22：把框整体推离节点内容，左右端点也随之落到框沿上，
 *   不再压在节点自己的端口上。
 *
 * **这是唯一来源**：框的 `inset`、端点位置、功能栏的高度偏移都由它算出来，
 * 不写进 CSS（散成两处就会出现「框放大了、端点还留在原地」）。
 */
export const MULTI_BOX_INSET = { top: 30, side: 22, bottom: 22 } as const
/** 端点直径（与 `.endpoint` 的 width/height 一致）：居中到框沿要用它的一半 */
const ENDPOINT_SIZE = 14
/**
 * 端点的纵向位置：**虚线框的纵向中点**，不是选区的中点。
 *
 * 框的外扩上下不对称（上面多让 30px 给标题带、下面 22px），两者的中点因此差
 * `(bottom − top) / 2` —— 端点若不补这个差值，就会比框的中线低 4px（G103 抓到过）。
 */
const ENDPOINT_TOP_OFFSET = (MULTI_BOX_INSET.bottom - MULTI_BOX_INSET.top) / 2

/**
 * **多选浮层**：虚线框 + 上方功能栏 + 左右两个「共有端点」（用户 2026-10-05 第 11 / 12 条，
 * 参考图四）。
 *
 * 三个部分的职责与交互边界写在这里，别在别处再实现一遍：
 * ① **虚线框**只是指示「这一圈是选中的」，`pointer-events: none` —— 框内还要能继续
 *    框选 / 点节点，浮层不能把画布手势吃掉；
 * ② **功能栏**（六个动作）与单选时的跟随栏同一套视觉与锚点口径（屏幕坐标、挂在选区
 *    上沿之上）；
 * ③ **左右端点**是「一次连多个」的入口：拖出去落在一个节点上 = 把**每个**选中节点都
 *    连到它（右侧 = 连下游、左侧 = 连上游）。参考图四只有右侧一只，按用户要求补左侧。
 */

export function MultiSelectBar({
  onDownload,
  onStartLink,
}: {
  /** 单个节点的下载（与单选跟随栏同一个实现，由 CanvasSurface 注入） */
  onDownload?: (nodeId: string) => void
  /** 拖端点建连：`side` 决定「连下游（output）」还是「连上游（input）」 */
  onStartLink: (
    e: ReactPointerEvent,
    nodeId: string,
    portId: string,
    also: readonly string[],
  ) => void
}) {
  const store = useCanvasStore()
  const graph = useGraph()
  const selection = useSelection()
  const viewport = useViewportState()
  const platform = usePlatform()
  const { arrange, arrangeMode } = useArrangeTools(store)
  const [menuOpen, setMenuOpen] = useState(false)

  const nodes = selection
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))

  const run = useCallback(
    (mode?: (typeof ARRANGE_MODES)[number]['mode']) => {
      setMenuOpen(false)
      const r = mode ? arrangeMode(mode) : arrange()
      if (r.kind === 'cycle') store.notify(r.reason ?? '存在循环依赖，无法整理')
      else if (r.kind === 'too-few') store.notify('至少选中 2 个节点才能排列')
    },
    [arrange, arrangeMode, store],
  )

  const saveToLibrary = useCallback(() => {
    const withAsset = nodes.filter((n) => (n.data as { assetHash?: string }).assetHash)
    if (withAsset.length === 0) {
      store.notify('选中的节点里没有可保存的素材')
      return
    }
    void Promise.all(withAsset.map((n) => saveAssetToLibrary({ platform, store }, n.id))).then(
      (rs) => {
        const ok = rs.filter((r) => r.ok).length
        store.notify(ok > 0 ? `已保存 ${ok} 张到「我的素材」` : '保存失败：素材已不在库里')
      },
    )
  }, [nodes, platform, store])

  const duplicate = useCallback(() => {
    const ids = selection
    if (ids.length === 0) return
    /** 副本落位：整组往右让开（集合内部的节点不算「别人」，否则彼此判成撞上） */
    const graph = store.getSnapshot()
    const picked = graph.nodes.filter((n) => ids.includes(n.id))
    const delta = noOverlapDelta(
      picked,
      graph.nodes.filter((n) => !ids.includes(n.id)),
    )
    store.dispatch({
      kind: 'node.duplicate',
      ids: [...ids],
      newIds: ids.map(() => createId('node')),
      dx: delta.dx,
      dy: delta.dy,
      rewire: true,
    })
  }, [selection, store])

  const group = useCallback(() => {
    if (groupNodes(store, selection)) store.showUndoBar('已打组')
  }, [selection, store])

  if (nodes.length < 2) return null

  /** 选区在**屏幕坐标**下的外框（与跟随栏同一套换算：屏幕 =（世界 − 视口）× zoom） */
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + n.w))
  const maxY = Math.max(...nodes.map((n) => n.y + n.h))
  const left = (minX - viewport.x) * viewport.zoom
  const top = (minY - viewport.y) * viewport.zoom
  const width = (maxX - minX) * viewport.zoom
  const height = (maxY - minY) * viewport.zoom

  const [first, ...rest] = nodes
  const others = rest.map((n) => n.id)

  return (
    <div
      className={styles.wrap}
      data-multi-select
      style={{ left, top, width, height }}
      /** 浮层本体不吃画布手势（框 / 端点 / 功能栏各自显式接管） */
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className={styles.box}
        data-multi-select-box
        /** 外扩量来自上面那个常量（框 / 端点 / 功能栏三者共用一份） */
        style={{
          inset: `-${MULTI_BOX_INSET.top}px -${MULTI_BOX_INSET.side}px -${MULTI_BOX_INSET.bottom}px`,
        }}
      />

      <div
        className={styles.bar}
        data-multi-select-bar
        /**
         * 功能栏挂在**虚线框上沿之上**再留 6px —— 原先只按「选区上沿」算，
         * 框一放大，栏的底边就压在虚线上（用户 2026-10-05 第 6 条）。
         */
        style={{ top: -(MULTI_BOX_INSET.top + FOLLOW_BAR_HEIGHT + 6) }}
      >
        {/*
          六枚按钮都走「图标 + 常驻中文」——与单选跟随栏同一条口径（用户 2026-09-17：
          「中文始终显示，不要 hover 才出现」），也贴近参考图四那排的样子。
        */}
        <BarButton
          action="arrange"
          label="排列与整理"
          icon={<IconGridArrange size={16} />}
          onClick={() => setMenuOpen((v) => !v)}
        />
        <BarButton
          action="library"
          label="保存到资产"
          icon={<IconStar size={16} />}
          onClick={saveToLibrary}
        />
        <BarButton
          action="duplicate"
          label="创建副本"
          icon={<IconDuplicate size={16} />}
          onClick={duplicate}
        />
        <BarButton action="group" label="打组" icon={<IconGroup size={16} />} onClick={group} />
        <BarButton
          action="download"
          label="下载"
          icon={<IconDownload size={16} />}
          onClick={() => nodes.forEach((n) => onDownload?.(n.id))}
        />
        <BarButton
          action="agent"
          label="添加到 agent"
          icon={<IconMention size={16} />}
          onClick={() => sendSelectionToAgent(nodes.map((n) => n.id))}
        />
        {menuOpen && (
          <div className={styles.arrangeMenu} data-multi-arrange-menu>
            {ARRANGE_MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                className={styles.arrangeItem}
                data-multi-arrange={m.mode}
                onClick={() => run(m.mode)}
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              className={styles.arrangeItem}
              data-multi-arrange="tidy"
              onClick={() => run()}
            >
              整理节点
            </button>
          </div>
        )}
      </div>

      {/*
        左右两个**共有端点**：拖出去落在某个节点上 = 把每个选中节点都连上它。
        左侧 >（连上游）、右侧 >（连下游）都走 `onStartLink`，方向由 portId 决定。
      */}
      <button
        type="button"
        className={`${styles.endpoint} ${styles.endpointLeft}`}
        style={{
          left: -(MULTI_BOX_INSET.side + ENDPOINT_SIZE / 2),
          top: `calc(50% + ${ENDPOINT_TOP_OFFSET}px)`,
        }}
        data-multi-endpoint="input"
        title="连上游（把每个选中节点都接到它）"
        aria-label="连上游"
        onPointerDown={(e) => onStartLink(e, first.id, 'input', others)}
      />
      <button
        type="button"
        className={`${styles.endpoint} ${styles.endpointRight}`}
        style={{
          right: -(MULTI_BOX_INSET.side + ENDPOINT_SIZE / 2),
          top: `calc(50% + ${ENDPOINT_TOP_OFFSET}px)`,
        }}
        data-multi-endpoint="output"
        title="连下游（每个选中节点都连到它）"
        aria-label="连下游"
        onPointerDown={(e) => onStartLink(e, first.id, 'output', others)}
      />
    </div>
  )
}

/** 功能栏上的一枚按钮：**图标 + 常驻中文**（与单选跟随栏同一个形状与 hover 反馈） */
function BarButton({
  action,
  label,
  icon,
  onClick,
}: {
  action: string
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={styles.btn}
      title={label}
      aria-label={label}
      data-multi-action={action}
      onClick={onClick}
    >
      <span className={styles.btnIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.btnLabel}>{label}</span>
    </button>
  )
}
