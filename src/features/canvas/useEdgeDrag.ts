import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import { canConnect } from '../../domain/canvas/graph/canConnect'
import { getSpec } from '../../domain/canvas/nodeSpecs/registry'
import { screenToWorld, toWorldRect } from '../../domain/canvas/geometry/coords'
import { coalescePointerMove } from '../../shared/rafThrottle'

export type PortSide = 'input' | 'output'

/** 拖线进行中的瞬时状态（不进 store：纯视觉，不参与撤销） */
export interface LinkDraft {
  side: PortSide
  nodeId: string
  /** 固定端的世界坐标（源端点或目标端点） */
  from: { x: number; y: number }
  /** 跟随指针的活动端世界坐标 */
  to: { x: number; y: number }
  /** 悬停到的合法对端节点 id（用于「可连接时下游呈选中态」反馈） */
  hoverNodeId: string | null
  /** 当前悬停目标不合法（连线转危险色） */
  invalid: boolean
}

interface Size {
  w: number
  h: number
}

const PORT_ANCHOR: Record<PortSide, { x: 'left' | 'right'; y: 'center' }> = {
  output: { x: 'right', y: 'center' },
  input: { x: 'left', y: 'center' },
}

/** 端点世界坐标：左 = 输入，右 = 输出，取纵向中点（§6.14 端点位置） */
export function portAnchorWorld(
  node: { x: number; y: number; w: number; h: number },
  side: PortSide,
): { x: number; y: number } {
  const anchor = PORT_ANCHOR[side]
  return {
    x: anchor.x === 'left' ? node.x : node.x + node.w,
    y: node.y + node.h / 2,
  }
}

/**
 * 端点拖线建连（产品文档 §6.14「建立连接」）。
 *
 * 交互：从输出端点（或输入端点反向）按下 → 拖出贝塞尔草稿线 → 松手落在对端节点范围内即建边。
 * 合法性交给 domain 的 canConnect（同一份规则，视图层不重复实现）：
 * 不合法时草稿线转 --danger 色，松手不建边。
 *
 * 产物只有一条命令：edge.connect。视图 / hook 都不直接改图（架构 §4.3 / §4.7）。
 */
export function useEdgeDrag(store: CanvasStore) {
  const [draft, setDraft] = useState<LinkDraft | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)

  const begin = useCallback(
    (_e: ReactPointerEvent, nodeId: string, side: PortSide, container: HTMLElement) => {
      const graph = store.getSnapshot()
      const node = graph.nodes.find((n) => n.id === nodeId)
      if (!node) return
      containerRef.current = container
      const rect = container.getBoundingClientRect()
      const worldRect = { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
      // 端点锚点用世界坐标：画板子节点的 local 坐标需叠加父级偏移（§6.13 画板内连线）
      const parent = node.parentId ? graph.nodes.find((n) => n.id === node.parentId) : undefined
      const world = toWorldRect(node, parent)
      const anchor = portAnchorWorld(world, side)

      setDraft({
        side,
        nodeId,
        from: anchor,
        to: anchor,
        hoverNodeId: null,
        invalid: false,
      })

      const move = coalescePointerMove((ev: PointerEvent) => {
        const to = screenToWorld({ x: ev.clientX, y: ev.clientY }, store.getViewport(), worldRect)
        const hovered = nodeAtPoint(to, store.getSnapshot())
        const ok = hovered ? checkConnect(store, nodeId, side, hovered) : null
        setDraft({
          side,
          nodeId,
          from: anchor,
          to,
          hoverNodeId: ok?.ok ? hovered : null,
          invalid: hovered !== null && ok !== null && !ok.ok,
        })
      })

      const up = (ev: PointerEvent) => {
        move.flush()
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        const to = screenToWorld({ x: ev.clientX, y: ev.clientY }, store.getViewport(), worldRect)
        const hovered = nodeAtPoint(to, store.getSnapshot())
        setDraft(null)
        if (!hovered) return
        const check = checkConnect(store, nodeId, side, hovered)
        if (!check.ok) return
        const source = side === 'output' ? nodeId : hovered
        const target = side === 'output' ? hovered : nodeId
        store.dispatch({ kind: 'edge.connect', source, target })
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [store],
  )

  return { draft, begin }
}

/**
 * 命中指针所在的世界坐标下的最上层节点（画板子节点用世界矩形判定，§6.13 画板内连线）。
 *
 * 收 `GraphSnapshot` 而非 store：命中是纯几何判断，不依赖 store 的任何行为，
 * 因而可单测——「结果缩略图抢走落点」这类 bug 就得靠这种测锁住。
 */
export function nodeAtPoint(point: { x: number; y: number }, graph: GraphSnapshot): string | null {
  // id → 节点 索引：toWorldRect 需要的是「父节点本体」；
  // 若误建 parentId → 子节点 的映射，子节点世界矩形会双重偏移、永远命中不到（G21 冒烟教训）
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const n = graph.nodes[i]
    /**
     * 父节点不在 nodes 表里的节点**不参与命中**。
     *
     * 典型就是结果组子节点（`parentId` 指向 resultGroups 表里的组）：它的 x/y
     * 是组内 local 坐标，拿不到父级偏移就只能当世界坐标用，于是在画布原点
     * 占下一块隐形命中区——用户把线松在提示词节点上，连上的却是它。
     * 「这个节点连不了」由 domain 的 canConnect 判（它在那儿定死），
     * 这里要的是「它压根不该挡在光标下面」，否则落点会被一个看不见的东西吃掉。
     */
    if (n.parentId && !index.has(n.parentId)) continue
    const r = toWorldRect(n, n.parentId ? index.get(n.parentId) : null)
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
      return n.id
    }
  }
  return null
}

/** 复用 domain 规则判定连通性，并按拖线方向归一成 source → target */
function checkConnect(
  store: CanvasStore,
  dragNodeId: string,
  side: PortSide,
  hoveredId: string,
): { ok: true } | { ok: false; reason: string } {
  const graph = store.getSnapshot()
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const dragNode = index.get(dragNodeId)
  const hovered = index.get(hoveredId)
  if (!dragNode || !hovered) return { ok: false, reason: '节点不存在' }
  const source = side === 'output' ? dragNode : hovered
  const target = side === 'output' ? hovered : dragNode
  // 反向拖入时，hovered 必须有输出端点、dragNode 必须有输入端点，交由 canConnect 统一判定
  return canConnect(source, target, graph)
}

/** 端点是否可拖线（无输出端点 / 无输入端点的节点不参与，§6.14 端点位置） */
export function nodeHasPort(type: Parameters<typeof getSpec>[0], side: PortSide): boolean {
  const spec = getSpec(type)
  if (!spec) return false
  return side === 'output' ? spec.ports.output : spec.ports.input
}

export type { Size }
