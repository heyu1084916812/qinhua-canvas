import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { useCanvasStore, useGraph } from '../storeContext'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { linkMenuSections, type LinkMenuItem } from '../../../domain/canvas/menu/linkMenu'
import { NODE_MINIMUMS } from '../../../domain/canvas/layout/constants'
import { createId } from '../../../shared/id'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { applyDefaults, resolveDefaults } from '../../../features/canvas/createNodeWithDefaults'
import {
  IconBatch,
  IconCompare,
  IconGeneration,
  IconGroup,
  IconLink,
  IconPrompt,
} from '../toolbar/icons'
import styles from './LinkMenu.module.css'

/**
 * 菜单项图标（用户 2026-09-19 第 5 条：拉线后的这个菜单也要有图标，与工具栏同一套）。
 *
 * 「新建并连接」的项按**要建的节点类型**取图标——与工具栏节点面板逐字同形，
 * 用户不必在两处各认一遍；「连接已有节点」的项统一用连线图标（它们指向的是不同
 * 既有节点，图标要表达的是「连过去」这个动作，而不是目标类型）。
 */
const MENU_ICON_SIZE = 16

const CREATE_ICONS: Record<string, ReactNode> = {
  prompt: <IconPrompt size={MENU_ICON_SIZE} />,
  generation: <IconGeneration size={MENU_ICON_SIZE} />,
  compare: <IconCompare size={MENU_ICON_SIZE} />,
  group: <IconGroup size={MENU_ICON_SIZE} />,
  batch: <IconBatch size={MENU_ICON_SIZE} />,
}

function iconOf(item: LinkMenuItem) {
  if (item.action.kind === 'create') return CREATE_ICONS[item.action.type] ?? <IconLink size={MENU_ICON_SIZE} />
  return <IconLink size={MENU_ICON_SIZE} />
}

/** §6.14：菜单打开在「指针右侧 12px」 */
const POINTER_GAP = 12
/** 距可视区边缘的最小留白 */
const MARGIN = 8

/**
 * 端点拖线在**空白处松手**的可连接菜单（§6.14「空白松手菜单」）。
 *
 * 三条与右键菜单不同的规矩：
 * - **锚点是指针右侧 12px**，不是指针本身（右键菜单是 +4/+4）；
 * - **指针离开菜单范围立即关闭**，不点外部、不等 Esc（§6.14「菜单关闭」）；
 * - 分「新建并连接」/「连接已有节点」两个区，方向由被拖的那一端决定
 *   （output → 只列合法下游，input → 只列合法上游）。
 *
 * 菜单项由 domain 的 `linkMenuSections` 纯函数给出，合法性走 `canConnect`
 * ——与「直接拖到节点上松手」同一份规则，菜单里点得到的连接不会连不上。
 * 这里只负责定位、渲染与派发。
 */
export function LinkMenu() {
  const store = useCanvasStore()
  const graph = useGraph()
  /** 新建节点要带默认配方（用户 2026-09-23：三个入口必须同源） */
  const channels = useChannels()
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 180, h: 0 })
  const menu = useSyncExternalStore(store.subscribe, store.getLinkMenu, store.getLinkMenu)

  // 渲染后量自身尺寸做边界翻转（与右键菜单同一套做法）
  useEffect(() => {
    if (menu && ref.current) setSize({ w: ref.current.offsetWidth, h: ref.current.offsetHeight })
  }, [menu])

  // 关闭途径：菜单外按下 / Esc / 滚轮。
  // 「指针离开即关」是 §6.14 的主路径，但若用户根本没进过菜单就走开，
  // 光靠 onPointerLeave 永远不触发——菜单会一直挂在屏幕上，故补这三条。
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      store.closeLinkMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeLinkMenu()
    }
    const onWheel = () => store.closeLinkMenu()
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [menu, store])

  if (!menu) return null

  const sections = linkMenuSections({
    nodeId: menu.nodeId,
    side: menu.side,
    portId: menu.portId,
    graph,
  })
  if (sections.length === 0) return null

  const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
  const vw = surface?.clientWidth ?? window.innerWidth
  const vh = surface?.clientHeight ?? window.innerHeight
  let left = menu.x + POINTER_GAP
  let top = menu.y
  if (left + size.w > vw - MARGIN) left = Math.max(MARGIN, menu.x - size.w - POINTER_GAP)
  top = Math.max(MARGIN, Math.min(top, vh - MARGIN - size.h))

  /** 松手处的世界坐标：新建节点就落在这儿（§6.14「新建节点后按当前方向自动建立连接」） */
  const dropWorld = () => {
    const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return screenToWorld({ x: r.left + menu.x, y: r.top + menu.y }, store.getViewport(), {
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
    })
  }

  const runItem = async (item: LinkMenuItem) => {
    const a = item.action
    /**
     * 建边时带上被拖的那只口（§6.23）：从融合节点的 `patch` 口反拖时，
     * 目标口就是 `patch`；从输出口正拖时，源口是它、目标口取对端的默认输入口。
     */
    const wiredPorts = { sourcePort: menu.portId, targetPort: menu.portId }
    if (a.kind === 'connect') {
      const source = menu.side === 'output' ? menu.nodeId : a.nodeId
      const target = menu.side === 'output' ? a.nodeId : menu.nodeId
      store.dispatch({
        kind: 'edge.connect',
        source,
        target,
        ...(menu.side === 'output'
          ? { sourcePort: wiredPorts.sourcePort }
          : { targetPort: wiredPorts.targetPort }),
      })
    } else {
      const at = dropWorld()
      if (!at) return
      const min = NODE_MINIMUMS[a.type]
      /**
       * 默认配方先在**事务外**异步解析（用户 2026-09-23）。
       *
       * `beginPlan` / `endPlan` 之间必须同步——中间一旦 await，事务边界被让出，
       * 「建节点 + 连线」就不再是一次撤销。所以先取数据、再进事务。
       *
       * 此前这里直接裸 `node.create`（data 为空）⇒ 拖线建出来的生成节点
       * 没有默认渠道 / 模型，「改参数就记配方」也因守卫缺渠道而记不上。
       */
      const data = await resolveDefaults({ channels, type: a.type })
      /**
       * 建节点 + 连线合成**一步撤销**（§6.3「一次操作 = 一次撤销步骤」）。
       *
       * 分两步的话，撤销一次会留下一个孤零零的新节点。关键在 `endPlan()` 的位置：
       * 事务靠 `activePlan` 非空把后续命令并进同一个撤销组，因此必须在
       * `edge.connect` **之后**才结束计划——先结束就等于白开，撤销仍然分两步。
       */
      store.beginPlan(`link:${createId('link')}`, '新建并连接')
      const createdId = applyDefaults({
        store,
        channels,
        projectId: graph.projectId,
        type: a.type,
        at: { x: at.x - min.w / 2, y: at.y - min.h / 2 },
        data,
      })
      if (createdId) {
        const source = menu.side === 'output' ? menu.nodeId : createdId
        const target = menu.side === 'output' ? createdId : menu.nodeId
        store.dispatch({
          kind: 'edge.connect',
          source,
          target,
          ...(menu.side === 'output'
            ? { sourcePort: wiredPorts.sourcePort }
            : { targetPort: wiredPorts.targetPort }),
        })
        store.setSelection([createdId])
      }
      store.endPlan()
    }
    store.closeLinkMenu()
  }

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      data-link-menu
      data-link-menu-side={menu.side}
      style={{ left, top }}
      // §6.14「指针离开菜单范围后立即关闭」；菜单关闭不改变已有节点和连线
      onPointerLeave={() => store.closeLinkMenu()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sections.map((s, i) => (
        <div key={s.id} data-link-menu-section={s.id}>
          {i > 0 && <span className={styles.sep} />}
          <div className={styles.sectionTitle}>{s.title}</div>
          {s.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.item}
              role="menuitem"
              data-link-menu-item={item.id}
              onClick={() => runItem(item)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <span className={styles.itemIcon} aria-hidden="true">
                {iconOf(item)}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
