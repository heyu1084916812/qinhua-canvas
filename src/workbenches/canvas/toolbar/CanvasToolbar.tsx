import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCanvasStore, useSelection } from '../storeContext'
import { useAlignTools } from '../../../features/canvas/useAlignTools'
import { ALIGN_MODES, canAlign, type AlignMode } from '../../../domain/canvas/layout/align'
import { canArrange } from '../../../domain/canvas/layout/arrange'
import type { NodeType } from '../../../domain/canvas/model/node'
import { fitCanvasView } from '../surface/fitView'
import styles from './CanvasToolbar.module.css'

/**
 * 鼠标按下时阻止默认聚焦：工具栏按钮点击后不滞留焦点，
 * 否则后续按空格会去激活按钮而没法「空格 + 拖拽平移」（§6.3）。
 * 键盘 Tab 导航不受影响，焦点在按钮上时空格仍激活控件（无障碍 §4.5）。
 */
const keepCanvasFocus = { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() }

/** 新建节点菜单项（§6.5 ①「与画布空白处右键菜单同一份」） */
const NODE_MENU: readonly { type: NodeType; label: string }[] = [
  { type: 'prompt', label: '提示词节点' },
  { type: 'generation', label: '图片·视频生成节点' },
  { type: 'compare', label: '对比节点' },
  { type: 'group', label: '分组节点' },
  { type: 'batch', label: '批量节点' },
  { type: 'board', label: '画板节点' },
]

/** 8 种对齐的图标字形（纯文本，不引图标库） */
const ALIGN_GLYPH: Record<AlignMode, string> = {
  left: '⇤',
  hcenter: '↔',
  right: '⇥',
  top: '⇡',
  vcenter: '↕',
  bottom: '⇣',
  hdistribute: '⋯',
  vdistribute: '⋮',
}

/**
 * 画布左侧竖向工具栏（产品文档 §6.1「画布左侧竖向悬浮」/ §6.5）。
 * 四组能力：新建节点菜单 / 8 种对齐 / 整理节点 / 重置视图。
 * 对齐与整理都要求 ≥ 2 个节点选中，不满足时按钮禁用（§6.5）。
 */
export function CanvasToolbar({
  onCreateNode,
  onImportAsset,
}: {
  onCreateNode: (type: NodeType) => void
  /** 导入本地图片 / 视频，落成生成节点（顶栏改版后迁入工具栏） */
  onImportAsset?: () => void
}) {
  const store = useCanvasStore()
  const selection = useSelection()
  const { align, arrange } = useAlignTools(store)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  /**
   * 撤销 / 重做从顶栏迁入（产品文档 §6.2 / §6.5 顶栏改版，2026-09-18）。
   *
   * 顶栏按 §6.2 只留导航与项目级入口，画布内操作一律归工具栏；
   * 撤销 / 重做的是**图操作**的逆操作，与对齐 / 整理同类，故放这里。
   */
  const canUndo = useSyncExternalStore(store.subscribe, store.canUndo, store.canUndo)
  const canRedo = useSyncExternalStore(store.subscribe, store.canRedo, store.canRedo)

  // 点击外部或 Esc 关闭新建菜单（§6.15「Esc 取消」）
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const count = selection.length
  // useSyncExternalStore 保持与 store 同源，避免工具栏与画布选中不同步
  const dragging = useSyncExternalStore(store.subscribe, store.isDragging, store.isDragging)

  const onAlign = (mode: AlignMode) => {
    const r = align(mode)
    if (r.kind === 'too-few') store.notify('至少选中 2 个节点才能对齐')
  }

  const onArrange = () => {
    const r = arrange()
    if (r.kind === 'cycle') store.notify(r.reason ?? '存在循环依赖，无法整理')
    else if (r.kind === 'too-few') store.notify('至少选中 2 个节点才能整理')
  }

  return (
    <div className={styles.bar} ref={rootRef} data-canvas-toolbar>
      <div className={styles.menuWrap}>
        <button
          className={styles.iconBtn}
          title="新建节点"
          aria-label="新建节点"
          aria-expanded={menuOpen}
          data-toolbar-add
          onClick={() => setMenuOpen((v) => !v)}
          {...keepCanvasFocus}
        >
          ＋
        </button>
        {menuOpen && (
          <div className={styles.menu} role="menu" data-toolbar-menu>
            {NODE_MENU.map((item) => (
              <button
                key={item.type}
                className={styles.menuItem}
                role="menuitem"
                data-toolbar-menu-item={item.type}
                onClick={() => {
                  onCreateNode(item.type)
                  setMenuOpen(false)
                }}
                {...keepCanvasFocus}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className={styles.divider} />

      <div className={styles.alignGroup} data-toolbar-align>
        {ALIGN_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            className={styles.iconBtn}
            title={label}
            aria-label={label}
            data-toolbar-align-mode={mode}
            disabled={!canAlign(count, mode) || dragging}
            onClick={() => onAlign(mode)}
            {...keepCanvasFocus}
          >
            {ALIGN_GLYPH[mode]}
          </button>
        ))}
      </div>

      <span className={styles.divider} />

      <button
        className={styles.iconBtn}
        title="整理节点"
        aria-label="整理节点"
        data-toolbar-arrange
        disabled={!canArrange(count) || dragging}
        onClick={onArrange}
        {...keepCanvasFocus}
      >
        ⌗
      </button>
      <button
        className={styles.iconBtn}
        title="重置视图"
        aria-label="重置视图"
        data-toolbar-reset
        onClick={() => fitCanvasView(store)}
        {...keepCanvasFocus}
      >
        ⤾
      </button>

      <span className={styles.divider} />

      <button
        className={styles.iconBtn}
        title="撤销"
        aria-label="撤销"
        data-toolbar-undo
        disabled={!canUndo}
        onClick={() => store.undo()}
        {...keepCanvasFocus}
      >
        ↶
      </button>
      <button
        className={styles.iconBtn}
        title="重做"
        aria-label="重做"
        data-toolbar-redo
        disabled={!canRedo}
        onClick={() => store.redo()}
        {...keepCanvasFocus}
      >
        ↷
      </button>
      {/*
        导入素材（§6.3）：顶栏改版后从顶栏迁入工具栏。落点语义不变
        （视口中心），拖文件到画布空白处的第二条入口也不变。
      */}
      {onImportAsset && (
        <button
          className={styles.iconBtn}
          title="导入本地图片 / 视频，落成生成节点（也可直接拖到画布上）"
          aria-label="导入素材"
          data-toolbar-import
          onClick={onImportAsset}
          {...keepCanvasFocus}
        >
          ⬆
        </button>
      )}
    </div>
  )
}
