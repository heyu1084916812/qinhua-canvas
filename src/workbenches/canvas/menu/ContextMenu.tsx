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
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { createNodeWithDefaults } from '../../../features/canvas/createNodeWithDefaults'
import { saveAssetToLibrary } from '../../../features/canvas/saveAssetToLibrary'
import styles from './ContextMenu.module.css'
import {
  IconBatch,
  IconCompare,
  IconFusion,
  IconGeneration,
  IconGroup,
  IconLoop,
  IconPrompt,
  IconReset,
  IconScan,
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
  /**
   * 循环节点（用户 2026-09-25 报）：`loop` 进 `CREATABLE_TYPES` 时只补了左侧
   * 「＋」菜单的图标，右键菜单这张映射**漏了它** —— 六个类型里唯独循环节点
   * 没有图标，视觉上断一档。
   *
   * 图标与功能栏取**同一份**（`toolbar/icons` 的 `IconLoop`），不另画一套。
   */
  'create:loop': <IconLoop size={MENU_ICON_SIZE} />,
  /** 融合节点：与左侧「＋」菜单取同一份图标组件（各画一套迟早漂） */
  'create:fusion': <IconFusion size={MENU_ICON_SIZE} />,
  /** 提取选区：与功能栏取同一份图标组件 */
  extractSelection: <IconScan size={MENU_ICON_SIZE} />,
  saveLibrary: (
    <svg width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 2.5v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="m5.8 7.6 3.2 3.2 3.2-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12.2v1.6a1.8 1.8 0 0 0 1.8 1.8h8.4a1.8 1.8 0 0 0 1.8-1.8v-1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
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
  const platform = usePlatform()
  /** 新建节点要带默认配方（用户 2026-09-23：三个入口必须同源） */
  const channels = useChannels()
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
  const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : null
  const hasAsset = !!(node?.data as { assetHash?: string } | undefined)?.assetHash
  const items: ContextMenuItem[] = nodeId
    ? nodeMenuItems(node?.type ?? 'prompt', { hasAsset })
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
      } else if (a.kind === 'extractSelection') {
        // 在素材灯箱里框选局部（§6.23）：入口只负责「以提取模式打开灯箱」
        store.openCropLightbox(nodeId)
      } else if (a.kind === 'saveLibrary') {
        void saveAssetToLibrary({ platform, store }, nodeId).then((result) => {
          if (result.ok) {
            store.showUndoBar('已保存到素材库')
          } else {
            store.showUndoBar(
              result.reason === 'missing' ? '素材尚未落库，暂时无法保存' : '保存到素材库失败',
            )
          }
        })
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
        /**
         * 走统一入口（用户 2026-09-23）：此前这里是裸 `node.create`、
         * data 为空 ⇒ 右键建出来的生成节点没有默认渠道 / 模型，
         * 后面「改参数就记配方」也因守卫缺渠道而一条都记不上。
         */
        void createNodeWithDefaults({
          store,
          channels,
          projectId: graph.projectId,
          type: a.type,
          at: { x: world.x - min.w / 2, y: world.y - min.h / 2 },
        })
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
