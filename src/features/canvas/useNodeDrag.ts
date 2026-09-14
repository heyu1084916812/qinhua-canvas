import { useMemo } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { Point } from '../../domain/canvas/geometry/rect'
import { screenToWorld } from '../../domain/canvas/geometry/coords'
import { indexNodes } from '../../domain/canvas/model/graph'
import { createId } from '../../shared/id'
import { coalescePointerMove } from '../../shared/rafThrottle'
import { resolveDropOutcome, dropPointOf } from './dropReparent'

interface DragState {
  ids: string[]
  prevX: number
  prevY: number
  zoom: number
}

export interface NodeDragController {
  /** 开始拖动；e 只需提供指针坐标与修饰键（便于单测直接构造） */
  begin(e: DragStartEvent, nodeId: string): void
  /** 本次拖动要移动的节点集合（单测与 NodeLayer 共用同一判定） */
  resolveDragIds(nodeId: string): string[]
  /** Alt 复制：原地生成副本并把选中切到副本，返回副本 id */
  duplicateForDrag(ids: string[]): string[]
}

export interface DragStartEvent {
  clientX: number
  clientY: number
  altKey?: boolean
  stopPropagation?: () => void
}

/**
 * 拖动控制器工厂（架构 §2.3 / §4.4）。
 *
 * 与 React 解耦：状态放在闭包而非 ref，因此单测可以不装 testing-library 直接驱动。
 * `useNodeDrag` 只负责用 useMemo 把它挂到组件生命周期上。
 *
 * 三条交互语义（产品文档 §4.2 / §6.15）：
 * - 多选整体拖动：按下时该节点已在选中集合且集合 > 1 → 整组一起移动，选区不变
 * - Alt + 拖动：先**原地复制**出新节点（保留上下游连线），再拖动副本（§4.2）
 * - 拖动期间置 store.dragging，创作参数面板据此立即隐藏（§6.15）
 */
export function createNodeDragController(
  store: CanvasStore,
  containerEl?: () => HTMLElement | null,
): NodeDragController {
  let current: DragState | null = null

  /**
   * 解析本次拖动要移动的节点集合。
   * 纯判定：已在多选集合内 → 整组一起动（选区保持不变，否则拖一下选区就散了）。
   *
   * 结果组子节点（M6-25）有两条特例：
   * - 按下的就是它 → 只拖它一个（走「取出」语义，见 NodeLayer 的阈值提取）；
   * - 它只是**混在**多选里 → 从集合里剔除。组内没有位置语义，整体拖动会改它的
   *   local 坐标、把组内版面拖乱，而松手的归属判定又只对单节点生效——两头都不对。
   */
  function resolveDragIds(nodeId: string): string[] {
    const sel = store.getSelection()
    if (!(sel.length > 1 && sel.includes(nodeId))) return [nodeId]
    const graph = store.getSnapshot()
    const nodeIds = new Set(graph.nodes.map((n) => n.id))
    const pressed = graph.nodes.find((n) => n.id === nodeId)
    if (pressed?.parentId && !nodeIds.has(pressed.parentId)) return [nodeId]
    return sel.filter((id) => {
      const n = graph.nodes.find((x) => x.id === id)
      return !!n && (!n.parentId || nodeIds.has(n.parentId))
    })
  }

  /**
   * Alt 复制：在**原位置**生成副本并把选中切到副本，随后拖动的即是副本。
   * 失败（如节点不存在）时退化成原集合，不打断拖动。
   */
  function duplicateForDrag(ids: string[]): string[] {
    const newIds = ids.map(() => createId('node'))
    try {
      store.dispatch({ kind: 'node.duplicate', ids, newIds, dx: 0, dy: 0, rewire: true })
    } catch {
      return ids
    }
    store.setSelection(newIds)
    return newIds
  }

  function begin(e: DragStartEvent, nodeId: string): void {
    e.stopPropagation?.() // 不触发画布平移
    const zoom = store.getViewport().zoom
    const ids = e.altKey ? duplicateForDrag(resolveDragIds(nodeId)) : resolveDragIds(nodeId)

    current = { ids, prevX: e.clientX, prevY: e.clientY, zoom }
    store.setDragging(true)
    store.dispatch({ kind: 'node.move', ids, dx: 0, dy: 0, phase: 'begin' })

    // pointermove 经 rAF 合帧（§1.7）：同一帧多次移动只派发一次最新位置
    // （dx 由 prev 增量计算，丢中间事件不改变最终落点）
    const move = coalescePointerMove((ev: PointerEvent) => {
      const d = current
      if (!d) return
      const dx = (ev.clientX - d.prevX) / d.zoom
      const dy = (ev.clientY - d.prevY) / d.zoom
      d.prevX = ev.clientX
      d.prevY = ev.clientY
      if (dx !== 0 || dy !== 0) {
        store.dispatch({ kind: 'node.move', ids: d.ids, dx, dy, phase: 'move' })
      }
    })
    const up = (ev: PointerEvent) => {
      const d = current
      current = null
      move.flush() // 帧内待执行的 move 先落盘（终点不落后光标），再提交 end
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!d) return
      store.dispatch({ kind: 'node.move', ids: d.ids, dx: 0, dy: 0, phase: 'end' })
      store.setDragging(false)

      // 归属判定（§6.11 / §6.12）只在**单节点**拖动时做：
      // 多选拖进容器的落点归属有歧义（谁进谁不进），不做猜测。
      if (d.ids.length !== 1) return
      const el = containerEl?.() ?? null
      const graph = store.getSnapshot()
      const node = indexNodes(graph.nodes).get(d.ids[0])
      if (!node) return
      const worldPoint = dropPointOf(dropPoint(ev, store, el), node, graph)
      const outcome = resolveDropOutcome(d.ids[0], worldPoint, graph)
      if (outcome.kind === 'rejected') {
        store.notify(outcome.reason)
        return
      }
      if (outcome.kind === 'ok') {
        store.dispatch({ kind: 'node.reparent', id: d.ids[0], toParent: outcome.drop.toParent })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return { begin, resolveDragIds, duplicateForDrag }
}

/** hook 包装：把控制器挂到组件生命周期上（每实例一个，状态互不影响） */
export function useNodeDrag(
  store: CanvasStore,
  containerEl?: () => HTMLElement | null,
): NodeDragController {
  return useMemo(() => createNodeDragController(store, containerEl), [store, containerEl])
}

/**
 * 松手时的判定点（world）：优先取指针位置，指针不在节点内（快速甩动）时退回节点中心。
 * 语义与 dropReparent 的 dropPointOf 一致。
 */
function dropPoint(
  ev: PointerEvent,
  store: CanvasStore,
  container: HTMLElement | null,
): Point | null {
  if (!container) return null
  const cr = container.getBoundingClientRect()
  return screenToWorld({ x: ev.clientX, y: ev.clientY }, store.getViewport(), {
    x: cr.left,
    y: cr.top,
    w: cr.width,
    h: cr.height,
  })
}
