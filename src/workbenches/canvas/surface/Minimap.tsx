import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Rect, Size } from '../../../domain/canvas/geometry/rect'
import { panBy } from '../../../domain/canvas/geometry/transform'
import {
  MINIMAP_BOX,
  buildMinimapModel,
  centerViewportOn,
  minimapToWorld,
  viewWorldRect,
  type MinimapModel,
} from '../../../domain/canvas/minimap/minimap'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { useCanvasStore, useGraph, useViewportState } from '../storeContext'
import { coalescePointerMove } from '../../../shared/rafThrottle'
import { fitCanvasView } from './fitView'
import styles from './Minimap.module.css'

/**
 * 小地图（产品文档 §6.4）：画布右下角的全局导航浮层。
 *
 * 投影数学全在 `domain/canvas/minimap`（纯函数），这里只负责：量容器、取节点、
 * 把指针 / 键盘事件翻译成 `store.setViewport`。
 *
 * 两个容易踩的点：
 * - **只画顶层节点与结果组**：容器内子节点的 x/y 是局部坐标，混进来会把范围拉偏
 *   （与 `fitCanvasView`、框选命中同一口径）。
 * - **指针处理读 ref 里的模型**：拖拽期间每一拍都会改视口并触发重渲染，闭包里的
 *   `model` / `viewport` 会陈旧 ⇒ 落点越拖越偏。
 */

/** 节点简化矩形（§6.4 指定色） */
const NODE_FILL = '#D8D8DE'
/** 视口框：半透填充 + 描边（§6.4「半透 #16161A 描边」） */
const VIEW_FILL = 'rgba(22, 22, 26, 0.06)'
const VIEW_STROKE = 'rgba(22, 22, 26, 0.55)'

/** 方向键一次平移的屏幕像素 */
const KEY_STEP = 80
/** Shift + 方向键：快一点 */
const KEY_STEP_FAST = 240

const KEY_PAN: Record<string, [number, number]> = {
  ArrowLeft: [KEY_STEP, 0],
  ArrowRight: [-KEY_STEP, 0],
  ArrowUp: [0, KEY_STEP],
  ArrowDown: [0, -KEY_STEP],
}

export function Minimap() {
  const store = useCanvasStore()
  const graph = useGraph()
  const viewport = useViewportState()
  const hostRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<Size | null>(null)

  // 视口覆盖多大世界范围要用画布可视区尺寸反算；尺寸变化走 ResizeObserver，
  // 不在渲染中读 DOM（读一次就强制一次重排，平移时每帧都读代价太高）
  useLayoutEffect(() => {
    const measure = () => {
      const surface = hostRef.current?.closest<HTMLElement>('[data-canvas-surface]')
      if (!surface) return
      const { width, height } = surface.getBoundingClientRect()
      setContainer((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }))
    }
    measure()
    const parent = hostRef.current?.parentElement
    const ro = typeof ResizeObserver === 'function' && parent ? new ResizeObserver(measure) : null
    if (ro && parent) ro.observe(parent)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const sources = useMemo(
    () => [
      ...graph.nodes
        .filter((n) => !n.parentId)
        .map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, w: n.w, h: n.h } as Rect })),
      ...graph.resultGroups.map((g) => ({ id: g.id, rect: { x: g.x, y: g.y, w: g.w, h: g.h } as Rect })),
    ],
    [graph.nodes, graph.resultGroups],
  )

  const box = container ?? { w: 0, h: 0 }
  const model: MinimapModel = useMemo(
    () => buildMinimapModel({ sources, view: viewWorldRect(viewport, box) }),
    // 依赖取 box.w / box.h：`box` 每次渲染都是新对象，直接进依赖会每次重算
    [sources, viewport, box.w, box.h],
  )

  // 指针 / 键盘处理里要读**最新**的模型与视口
  const latest = useRef<{ model: MinimapModel; viewport: Viewport; box: Size | null }>({
    model,
    viewport,
    box: container,
  })
  useLayoutEffect(() => {
    latest.current = { model, viewport, box: container }
  })

  /** 把视口中心移到光标所指的世界点（点击 / 拖拽同一个语义） */
  const jumpTo = (clientX: number, clientY: number) => {
    const el = hostRef.current
    const cur = latest.current
    if (!el || !cur.box) return
    const r = el.getBoundingClientRect()
    const world = minimapToWorld({ x: clientX - r.left, y: clientY - r.top }, cur.model)
    store.setViewport(centerViewportOn(cur.viewport, cur.box, world))
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    // 画布把「空白处按下」当作清选中 + 起平移，这里必须截断，否则一按就跑
    e.preventDefault()
    e.stopPropagation()
    hostRef.current?.focus()
    jumpTo(e.clientX, e.clientY)
    const move = coalescePointerMove((ev: PointerEvent) => jumpTo(ev.clientX, ev.clientY))
    const up = () => {
      move.flush()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const pan = KEY_PAN[e.key]
    if (pan) {
      e.preventDefault()
      const scale = (e.shiftKey ? KEY_STEP_FAST : KEY_STEP) / KEY_STEP
      store.setViewport(panBy(latest.current.viewport, pan[0] * scale, pan[1] * scale))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      fitCanvasView(store) // 与 Z 键同一份「复位视图」语义
    }
  }

  return (
    <div
      ref={hostRef}
      className={styles.minimap}
      data-canvas-minimap
      // **刻意不进 Tab 序列**：画布的 Tab 已被 §6.3「逐个选中节点」占用（CanvasSurface
      // 直接 preventDefault），小地图挂 tabIndex=0 只是多出一个永远走不到的停靠点，
      // 却会在焦点从顶栏进来时把 Tab 吃掉一站。键盘导航不靠 Tab —— 点击后即聚焦
      // （下面 onPointerDown 里 focus()），方向键 / Home 立刻可用。
      tabIndex={-1}
      role="group"
      aria-label="画布小地图：点击或拖拽跳转，方向键平移，Home 复位视图"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // 在小地图上滚轮不缩放画布：它是导航控件，不是画布的一部分
      onWheel={(e) => e.stopPropagation()}
    >
      <svg
        className={styles.svg}
        width={MINIMAP_BOX.w}
        height={MINIMAP_BOX.h}
        viewBox={`0 0 ${MINIMAP_BOX.w} ${MINIMAP_BOX.h}`}
        data-minimap-svg
      >
        {model.items.map((item) => (
          <rect
            key={item.id}
            data-minimap-node={item.id}
            x={item.rect.x}
            y={item.rect.y}
            width={item.rect.w}
            height={item.rect.h}
            rx={1}
            fill={NODE_FILL}
          />
        ))}
        <rect
          data-minimap-view
          x={model.view.x}
          y={model.view.y}
          width={model.view.w}
          height={model.view.h}
          rx={2}
          fill={VIEW_FILL}
          stroke={VIEW_STROKE}
          strokeWidth={1}
        />
      </svg>
    </div>
  )
}
