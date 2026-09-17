/**
 * 节点跟随功能栏（用户 2026-09-16 需求）。
 *
 * 形态与定位口径**照抄创作面板**（`panels/PanelLayer.tsx`）：
 * - 挂在 `[data-world]` 之外，用**屏幕坐标**绝对定位 ⇒ 缩放 / 平移只重算锚点，
 *   栏目自身尺寸不随画布缩放（§6.8「缩放独立性」同源）；
 * - world → screen 用同一个换算：屏幕 = (世界 − 视口平移) × zoom；
 * - 显示/隐藏规则与面板**完全一致**（用户 2026-09-17：跟随栏要跟创作面板一个样）：
 *   §6.15「拖动期间立即隐藏；发生真实位移的拖动，松手后保持隐藏，
 *   直到下一次显式选中」。两个标记都从 store 读（`dragging` / `panelDismissed`），
 *   与 PanelLayer 同源，因此两者永远同时出现、同时消失。
 *
 * 差别只有纵向位置：面板在节点**下方**，本栏在节点**上方**（标题之上），
 * 即纵向锚点 = 节点顶边再上移「栏高 + 间距」（用户 2026-09-17 起不再翻转到下方）。
 */
import { useEffect, useSyncExternalStore } from 'react'
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

  // §6.15：拖动期间立即隐藏；**真实位移**的拖动松手后保持隐藏，直到下一次显式选中
  // （`setSelection` 会复位 panelDismissed）。普通单击（无位移）不算拖动，照常出现。
  const dragging = useSyncExternalStore(store.subscribe, store.isDragging, store.isDragging)
  const dismissed = useSyncExternalStore(
    store.subscribe,
    store.isPanelDismissed,
    store.isPanelDismissed,
  )

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
      /**
       * 已经被别的层消费掉的 Esc，这里不再抢。
       *
       * 为什么需要这一条：创作面板的参数浮层开着时按 Esc，语义是「收起这个下拉」，
       * 不应连带清空选中（那会让整个面板一起消失）。浮层那一侧会 `preventDefault()`
       * 声明「这次 Esc 我吃了」，本层据此让行。
       *
       * 用 `defaultPrevented` 而不是 `stopPropagation`：本层挂在 window 上，
       * 与 React 的合成事件不在同一条传播链上，靠「谁标记谁消费」协商才稳——
       * 否则就得依赖「React 把监听器挂在 root container」这个实现细节。
       */
      if (e.defaultPrevented) return
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

  // 与创作面板同款：拖动中 / 刚拖完（未重新选中）/ 多选（归属有歧义）都不显示
  if (dragging || dismissed) return null
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
