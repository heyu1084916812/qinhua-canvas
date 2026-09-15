import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Rect, Size } from '../../../domain/canvas/geometry/rect'
import { panBy } from '../../../domain/canvas/geometry/transform'
import {
  MINIMAP_BOX,
  minimapProjection,
  minimapItems,
  minimapViewRect,
  centerViewportOn,
  minimapToWorld,
  viewWorldRect,
  type MinimapProjection,
  type MinimapSource,
} from '../../../domain/canvas/minimap/minimap'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { useCanvasStore, useGraph, useViewportState } from '../storeContext'
import { coalescePointerMove } from '../../../shared/rafThrottle'
import { useThrottled } from '../../../shared/useThrottled'
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
 *
 * 性能（M6-29）：小地图订阅整张图，而拖动节点是**每帧改一次图**——原实现每帧
 * 重建 300 个节点小方块并重渲 300 个 `<rect>`，A/B 实测占拖动帧预算约 15ms
 * （去掉小地图，同样的 60 步拖动总耗时 3773ms → 2894ms）。两刀砍掉它：
 *   1. 节点几何**节流到 8Hz**（`MINIMAP_REFRESH_MS`）。小地图是导航控件，
 *      点阵每秒刷 8 次肉眼无感，却把重算重渲降到约七分之一；
 *   2. **投影与视口解耦**：`bounds/scale/origin` 只由内容决定（不变量 1），
 *      故 `items` 与视口无关——平移时（视口每帧变、内容不动）整份复用，
 *      只有视口框那一个 `<rect>` 跟着动。
 */

/** 节点点阵的刷新间隔（ms）：约 8Hz。视口框不受它限制，仍逐帧跟随 */
const MINIMAP_REFRESH_MS = 120

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

/**
 * 节点点阵（memo）：`items` 引用不变就整块跳过重渲。
 *
 * 它只随「内容几何」变、不随视口变——平移时省下的正是整片 `<rect>` 的协调与重绘。
 */
const MinimapNodes = memo(function MinimapNodes({
  items,
}: {
  items: readonly { id: string; rect: Rect }[]
}) {
  return (
    <>
      {items.map((item) => (
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
    </>
  )
})

export function Minimap() {
  const store = useCanvasStore()
  const graph = useGraph()
  const viewport = useViewportState()
  const hostRef = useRef<HTMLDivElement>(null)
  /** 画布可视区尺寸（**不是**小地图尺寸，见下面 projection 处的说明） */
  const [surfaceSize, setSurfaceSize] = useState<Size | null>(null)

  // 视口覆盖多大世界范围要用画布可视区尺寸反算；尺寸变化走 ResizeObserver，
  // 不在渲染中读 DOM（读一次就强制一次重排，平移时每帧都读代价太高）
  useLayoutEffect(() => {
    const measure = () => {
      const surface = hostRef.current?.closest<HTMLElement>('[data-canvas-surface]')
      if (!surface) return
      const { width, height } = surface.getBoundingClientRect()
      setSurfaceSize((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }))
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

  // 拖动 / 平移期间图每帧一变，这里按 MINIMAP_REFRESH_MS 节流后再用来投影：
  // 节流返回的是**同一个数组引用**，于是下面的 sources / 投影 / items 全部命中缓存。
  const nodes = useThrottled(graph.nodes, MINIMAP_REFRESH_MS)
  const resultGroups = useThrottled(graph.resultGroups, MINIMAP_REFRESH_MS)

  const sources = useMemo<MinimapSource[]>(
    () => [
      ...nodes
        .filter((n) => !n.parentId)
        .map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, w: n.w, h: n.h } as Rect })),
      ...resultGroups.map((g) => ({ id: g.id, rect: { x: g.x, y: g.y, w: g.w, h: g.h } as Rect })),
    ],
    [nodes, resultGroups],
  )

  /**
   * ⚠️ 两个「框」截然不同，混用会让小地图整体失真（G56 曾因此 6 项挂掉）：
   * - `container` = **画布可视区**尺寸，只用来把视口（`x/y/zoom`）反算成世界矩形；
   * - `MINIMAP_BOX` = **小地图自身**尺寸（200×140），投影缩放与「钉回框内」都按它算。
   * 拿画布尺寸去投影，scale 会大好几倍，视口框撑到 751×470、点哪儿也跳不准。
   */
  const container = surfaceSize ?? { w: 0, h: 0 }
  const box = MINIMAP_BOX
  // 视口只作「无内容时的兜底范围」用，读 ref 而非进依赖：否则平移每帧都会换投影，
  // 300 个 items 跟着重算，第 2 刀就白砍了。空画布的命中语义不受影响
  // （那时 sources 为空，本来也没有 items 要复用）。
  const vpRef = useRef(viewport)
  vpRef.current = viewport
  const projection: MinimapProjection = useMemo(
    () => minimapProjection(sources, box, undefined, viewWorldRect(vpRef.current, container)),
    // 依赖取 w/h 而非对象：`container` 每次渲染都是新对象，直接进依赖会每次重算
    [sources, container.w, container.h],
  )
  const items = useMemo(() => minimapItems(projection, sources), [projection, sources])
  // 视口框逐帧跟随（O(1)，不碰 items）
  const viewRect = useMemo(
    () => minimapViewRect(projection, viewWorldRect(viewport, container), box),
    [projection, viewport, container.w, container.h],
  )

  /** 指针处理里要读**最新**的投影、视口与画布尺寸（闭包里的会陈旧 ⇒ 落点越拖越偏） */
  const latest = useRef<{ projection: MinimapProjection; viewport: Viewport; surface: Size | null }>({
    projection,
    viewport,
    surface: surfaceSize,
  })
  useLayoutEffect(() => {
    latest.current = { projection, viewport, surface: surfaceSize }
  })

  /** 把视口中心移到光标所指的世界点（点击 / 拖拽同一个语义） */
  const jumpTo = (clientX: number, clientY: number) => {
    const el = hostRef.current
    const cur = latest.current
    if (!el || !cur.surface) return
    const r = el.getBoundingClientRect()
    const world = minimapToWorld({ x: clientX - r.left, y: clientY - r.top }, cur.projection)
    store.setViewport(centerViewportOn(cur.viewport, cur.surface, world))
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
        {/* 节点点阵单独成 memo 组件：平移时视口框每帧变、items 不变，
            这里整块跳过（否则每帧要协调 300 个 <rect>） */}
        <MinimapNodes items={items} />
        <rect
          data-minimap-view
          x={viewRect.x}
          y={viewRect.y}
          width={viewRect.w}
          height={viewRect.h}
          rx={2}
          fill={VIEW_FILL}
          stroke={VIEW_STROKE}
          strokeWidth={1}
        />
      </svg>
    </div>
  )
}
