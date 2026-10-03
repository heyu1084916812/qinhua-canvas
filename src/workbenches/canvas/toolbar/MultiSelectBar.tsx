import { useCallback, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { ARRANGE_MODES } from '../../../domain/canvas/layout/arrangeModes'
import { useArrangeTools } from '../../../features/canvas/useArrangeTools'
import { groupNodes } from '../../../features/canvas/groupNodes'
import { saveAssetToLibrary } from '../../../features/canvas/saveAssetToLibrary'
import { sendSelectionToAgent } from '../../../features/canvas/agentHandoff'
import { createId } from '../../../shared/id'
import { useCanvasStore, useGraph, useSelection, useViewportState } from '../storeContext'
import { FOLLOW_BAR_GAP, FOLLOW_BAR_HEIGHT } from './followBarAnchor'
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
    store.dispatch({
      kind: 'node.duplicate',
      ids: [...ids],
      newIds: ids.map(() => createId('node')),
      dx: 24,
      dy: 24,
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
      <div className={styles.box} data-multi-select-box />

      <div
        className={styles.bar}
        data-multi-select-bar
        style={{ top: -FOLLOW_BAR_HEIGHT - FOLLOW_BAR_GAP }}
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
        data-multi-endpoint="input"
        title="连上游（把每个选中节点都接到它）"
        aria-label="连上游"
        onPointerDown={(e) => onStartLink(e, first.id, 'input', others)}
      />
      <button
        type="button"
        className={`${styles.endpoint} ${styles.endpointRight}`}
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
