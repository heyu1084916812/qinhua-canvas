import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { useCanvasStore, useGraph } from '../storeContext'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import {
  nodeMenuItems,
  canvasMenuItems,
  type ContextMenuItem,
} from '../../../domain/canvas/menu/contextMenu'
import { hasClipboard, pasteClipboard } from '../../../features/canvas/useClipboard'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { fitCanvasView } from '../surface/fitView'
import { NODE_MINIMUMS } from '../../../domain/canvas/layout/constants'
import { createId } from '../../../shared/id'
import styles from './ContextMenu.module.css'
import {
  IconBatch,
  IconBoard,
  IconCompare,
  IconGeneration,
  IconGroup,
  IconPrompt,
  IconReset,
} from '../toolbar/icons'

/**
 * 菜单项的图标（用户 2026-09-19）。
 *
 * 为什么是「按 id 映射」而不是让领域层带图标：`nodeMenuItems` / `canvasMenuItems`
 * 是纯函数、只描述结构与顺序（架构 §4.1 的解耦口径），不该持有 React 节点。
 * 图标属于渲染决定，故映射放在这里——但**同一份 id 在功能栏与右键菜单里
 * 必须拿到同一个图标**，两边都从 `toolbar/icons` 取，不各画一套。
 */
const MENU_ICON_SIZE = 18
const MENU_ICON: Record<string, ReactNode> = {
  'create:prompt': <IconPrompt size={MENU_ICON_SIZE} />,
  'create:generation': <IconGeneration size={MENU_ICON_SIZE} />,
  'create:compare': <IconCompare size={MENU_ICON_SIZE} />,
  'create:group': <IconGroup size={MENU_ICON_SIZE} />,
  'create:batch': <IconBatch size={MENU_ICON_SIZE} />,
  'create:board': <IconBoard size={MENU_ICON_SIZE} />,
  resetView: <IconReset size={MENU_ICON_SIZE} />,
}

/**
 * 右键菜单（§4.1）。浮层用**屏幕坐标**绝对定位（与创作面板 §6.8 同理，不随画布变换），
 * 受画布可视区边界约束：下方/右侧/左侧空间不足时贴边翻转。
 *
 * 状态由 store.menu 持有（瞬时态，不进撤销栈不落库）；Esc / 空白单击 / 滚轮 / 平移时关闭。
 * 只渲染浮层本身，节点与画布空白的「打开」由 CanvasSurface 的 onContextMenu 负责。
 */
export function ContextMenu() {
  const store = useCanvasStore()
  const graph = useGraph()
  const exec = useCanvasExecution()
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 180, h: 0 })

  const menu = useSyncExternalStore(store.subscribe, store.getMenu, store.getMenu)

  // 菜单打开时挂全局关闭监听：Esc / 点外部 / 滚轮 / 平移
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeMenu()
    }
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      store.closeMenu()
    }
    const onWheel = () => store.closeMenu()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('wheel', onWheel)
    }
  }, [menu, store])

  // 渲染后量一下自身高度，做边界翻转
  useEffect(() => {
    if (menu && ref.current) {
      setSize({ w: ref.current.offsetWidth, h: ref.current.offsetHeight })
    }
  }, [menu])

  if (!menu) return null

  const nodeId = menu.target.kind === 'node' ? menu.target.nodeId : null
  const items: ContextMenuItem[] = nodeId
    ? nodeMenuItems(graph.nodes.find((n) => n.id === nodeId)?.type ?? 'prompt')
    // 剪贴板是模块级单例、不触发重渲染；菜单每次打开都会重算这里，故读到的即当前值
    : canvasMenuItems({ canPaste: hasClipboard() })

  // 边界约束：菜单锚点在 surface 局部屏幕坐标 (menu.x, menu.y)
  const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
  const vw = surface?.clientWidth ?? window.innerWidth
  const vh = surface?.clientHeight ?? window.innerHeight
  const MARGIN = 8
  let left = menu.x + 4
  let top = menu.y + 4
  if (left + size.w > vw - MARGIN) left = Math.max(MARGIN, menu.x - size.w - 4)
  if (top + size.h > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - size.h)

  const runAction = (item: ContextMenuItem) => {
    const target = menu.target
    if (target.kind === 'node') {
      const nodeId = target.nodeId
      const a = item.action
      if (a.kind === 'run') {
        void exec.runNode(nodeId)
      } else if (a.kind === 'runBoard') {
        void exec.runBoard(nodeId)
      } else if (a.kind === 'duplicate') {
        store.dispatch({
          kind: 'node.duplicate',
          ids: [nodeId],
          newIds: [createId('node')],
          dx: 24,
          dy: 24,
          rewire: true,
        })
      } else if (a.kind === 'rename') {
        store.beginRename(nodeId)
      } else if (a.kind === 'fullscreenEdit') {
        store.openTextEditor(nodeId)
      } else if (a.kind === 'delete') {
        store.dispatch({ kind: 'node.delete', ids: [nodeId] })
        store.setSelection([])
        // 删除是已落撤销栈的可恢复操作 → 弹撤销条（§6.12）
        store.showUndoBar('已删除节点')
      }
    } else {
      const a = item.action
      if (a.kind === 'create') {
        const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
        if (!el) return
        const r = el.getBoundingClientRect()
        const world = screenToWorld(
          { x: r.left + menu.x, y: r.top + menu.y },
          store.getViewport(),
          { x: r.left, y: r.top, w: r.width, h: r.height },
        )
        const min = NODE_MINIMUMS[a.type]
        const res = store.dispatch({
          kind: 'node.create',
          projectId: graph.projectId,
          type: a.type,
          at: { x: world.x - min.w / 2, y: world.y - min.h / 2 },
        })
        const created = res.patches.find(
          (p) => p.op === 'upsert' && p.table === 'nodes',
        ) as unknown as { row: { id: string } } | undefined
        if (created) store.setSelection([created.row.id])
      } else if (a.kind === 'paste') {
        // 粘贴在**右键那一点**（§4.1 菜单锚点即落点；快捷键则落在鼠标位置）
        const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
        if (el) {
          const r = el.getBoundingClientRect()
          pasteClipboard(
            store,
            screenToWorld(
              { x: r.left + menu.x, y: r.top + menu.y },
              store.getViewport(),
              { x: r.left, y: r.top, w: r.width, h: r.height },
            ),
          )
        }
      } else if (a.kind === 'resetView') {
        // 重置视图（§6.3）：缩放到全部节点可见并居中 —— 与 Z 键 / 工具栏按钮共用一份实现
        fitCanvasView(store)
      }
    }
    store.closeMenu()
  }

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      data-context-menu
      style={{ left, top }}
      onContextMenu={(e: ReactMouseEvent) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <div key={item.id}>
          <button
            type="button"
            className={styles.item}
            role="menuitem"
            data-context-menu-item={item.id}
            onClick={() => runAction(item)}
            onMouseDown={(e) => e.preventDefault()}
          >
            {/*
              图标 + 文案两列（与左侧功能栏的面板同形）。没配图标的项
              （复制 / 重命名 / 删除…）不占位——占位会留出一列空白，
              让那些项看起来「缺了点什么」。
            */}
            {MENU_ICON[item.id] && (
              <span className={styles.itemIcon} aria-hidden="true">
                {MENU_ICON[item.id]}
              </span>
            )}
            {item.label}
          </button>
          {item.separatorAfter && i < items.length - 1 && <span className={styles.sep} />}
        </div>
      ))}
    </div>
  )
}
