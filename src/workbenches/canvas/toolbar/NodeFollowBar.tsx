/**
 * 节点跟随功能栏（用户 2026-09-16 需求）。
 *
 * 形态与定位口径**照抄创作面板**（`panels/PanelLayer.tsx`）：
 * - 挂在 `[data-world]` 之外，用**屏幕坐标**绝对定位 ⇒ 缩放 / 平移只重算锚点，
 *   栏目自身尺寸不随画布缩放（§6.8「缩放独立性」同源）；
 * - world → screen 用同一个换算：屏幕 = (世界 − 视口平移) × zoom；
 * - **但显示/隐藏规则刻意与面板不同**：面板是 840px 的大块头，拖动时遮挡视线、
 *   松手后还要「追着节点跑」很烦，所以 §6.15 让它拖动即隐、拖完也保持隐藏；
 *   本栏只有一个按钮条，它的全部意义就是**跟着节点**，因此拖动中照常显示并随节点移动，
 *   拖完也不消失。只有「多选（这一栏属于谁有歧义）」与「没选中」才隐藏。
 *
 * 差别只有一处：面板在节点**下方**，本栏在节点**上方**（标题之上），
 * 因此纵向锚点是节点顶边再上移「栏高 + 间距」。上方空间不够时翻到节点下方贴着顶边。
 */
import { useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCanvasStore, useGraph, useSelection, useViewportState } from '../storeContext'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import type { NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'
import { createId } from '../../../shared/id'
import { followBarAnchor } from './followBarAnchor'
import styles from './NodeFollowBar.module.css'

/**
 * 出现跟随栏的节点类型。
 *
 * 与创作面板同一批（§6.1）——画板是「被收纳的工作区」，其内部工具条已经常驻，
 * 再叠一条跟随栏会与它抢位置。
 */
const FOLLOW_TYPES = new Set<NodeType>(['prompt', 'generation', 'group', 'batch', 'compare'])

/** 鼠标按下时阻止默认聚焦：按钮点击后不滞留焦点，否则空格会被按钮吃掉（§6.3） */
const keepCanvasFocus = { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() }

export interface NodeFollowBarProps {
  /** 关闭（= 取消选中，与创作面板「点面板外关闭」同一语义） */
  onClose?: () => void
  /** 宿主导航：去后台设置配渠道 */
  onOpenSettings?: () => void
}

export function NodeFollowBar({ onClose, onOpenSettings }: NodeFollowBarProps = {}) {
  const store = useCanvasStore()
  const graph = useGraph()
  const selection = useSelection()
  const viewport = useViewportState()
  const exec = useCanvasExecution()

  /**
   * Esc：跟随栏可见时**先收起它**（取消选中），而不是等画布那层去兜。
   *
   * 少了这一条，用户按 Esc 时画布的 keydown 处理会因为「焦点不在画布 /
   * 事件被别的浮层吃掉」等原因没落到取消选中上，Esc 看起来时灵时不灵。
   * 本层自己监听 window，只认「当前有单选」这一种情况，不与别的浮层抢 Esc。
   */
  useEffect(() => {
    if (selection.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as { tagName?: string; isContentEditable?: boolean } | null
      // 正在改名 / 输入文本时 Esc 属于编辑器，不抢
      if (t?.isContentEditable) return
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      store.setSelection([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, selection.length])

  // 多选不显示：「这一栏属于谁」有歧义（§6.15 同款判据）
  if (selection.length !== 1) return null
  const node = graph.nodes.find((n) => n.id === selection[0])
  if (!node || !FOLLOW_TYPES.has(node.type)) return null

  // 结果组子节点的父不在 nodes 表，必须走「图内」世界矩形（否则锚点飞到左上角）
  const rect = toWorldRectInGraph(node, graph)
  // 锚点几何（含「上方装不下就翻到下方」）由纯函数给出，组件只负责用它
  const anchor = followBarAnchor(rect, viewport)

  const close = onClose ?? (() => store.setSelection([]))

  return (
    <div
      className={styles.bar}
      style={{ left: anchor.centerX, top: anchor.top, transform: 'translateX(-50%)' }}
      data-node-follow-bar={node.id}
      data-node-follow-placement={anchor.placement}
      // 栏上的点击/拖动不该被画布当成「点空白取消选中」或发起平移
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <NodeActions
        node={node}
        running={exec.isRunning}
        onClose={close}
        onOpenSettings={onOpenSettings}
      />
      <span className={styles.arrow} data-node-follow-arrow aria-hidden="true" />
    </div>
  )
}

/**
 * 按节点类型注入动作（视图层不发命令，交给 store / 执行宿主）。
 *
 * 第一版只挂**确定有效**的四个：生成/取消、重命名、复制、删除 ——
 * 与右键菜单同源（§4.1），不新增任何「点了没反应」的入口。
 */
function NodeActions({
  node,
  running,
  onClose,
  onOpenSettings,
}: {
  node: NodeSnapshot
  running: boolean
  onClose: () => void
  onOpenSettings?: () => void
}) {
  const store = useCanvasStore()
  const exec = useCanvasExecution()
  const state = exec.nodeStateOf(node.id)
  const busy = state?.kind === 'queued' || state?.kind === 'running'
  const canRun = node.type === 'generation' || node.type === 'batch' || node.type === 'group'

  const onRun = () => {
    if (busy) exec.cancel()
    else if (node.type === 'generation') void exec.runNode(node.id)
    else void exec.runNode(node.id)
  }

  return (
    <div className={styles.actions}>
      {canRun && (
        <FollowButton
          action="run"
          glyph={busy ? '■' : '▶'}
          label={busy ? '取消生成' : '生成'}
          onClick={onRun}
        />
      )}
      <FollowButton
        action="rename"
        glyph="✎"
        label="重命名"
        onClick={() => store.beginRename(node.id)}
      />
      <FollowButton
        action="duplicate"
        glyph="⧉"
        label="复制"
        onClick={() =>
          store.dispatch({
            kind: 'node.duplicate',
            ids: [node.id],
            newIds: [createId('node')],
            dx: 24,
            dy: 24,
            rewire: true,
          })
        }
      />
      <FollowButton
        action="delete"
        glyph="✕"
        label="删除"
        onClick={() => {
          store.dispatch({ kind: 'node.delete', ids: [node.id] })
          store.setSelection([])
          store.showUndoBar('已删除节点')
        }}
      />
      <span className={styles.divider} />
      <FollowButton action="close" glyph="⌄" label="关闭" onClick={onClose} />
      {onOpenSettings && !running && (
        <FollowButton action="settings" glyph="⚙" label="渠道设置" onClick={onOpenSettings} />
      )}
    </div>
  )
}

/**
 * 单个动作按钮：**图标 + 常驻中文**（用户 2026-09-17）。
 *
 * 中文始终显示（不是 hover 才展开），鼠标移到按钮上只把它变成实色块——
 * 与创作面板参数 chip 的 hover 反馈同一条规则（透明 → `--bg-hover`）。
 * `title` 给完整中文，长悬停时与可见文案一致。
 */
function FollowButton({
  action,
  glyph,
  label,
  onClick,
}: {
  action: string
  glyph: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={styles.btn}
      data-follow-action={action}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...keepCanvasFocus}
    >
      <span className={styles.glyph} aria-hidden="true">
        {glyph}
      </span>
      <span className={styles.label} data-follow-label={action}>
        {label}
      </span>
    </button>
  )
}
