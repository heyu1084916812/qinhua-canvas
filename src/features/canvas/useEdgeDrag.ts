import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import { canConnect } from '../../domain/canvas/graph/canConnect'
import { getSpec } from '../../domain/canvas/nodeSpecs/registry'
import {
  INPUT_PORT,
  OUTPUT_PORT,
  portDeclOf,
  portDeclsOf,
  type PortDecl,
} from '../../domain/canvas/nodeSpecs/ports'
import { DEFAULT_SOURCE_PORT } from '../../domain/canvas/model/edge'
import { screenToWorld, toWorldRect } from '../../domain/canvas/geometry/coords'
import { coalescePointerMove } from '../../shared/rafThrottle'

export type PortSide = 'input' | 'output'

/** 拖线进行中的瞬时状态（不进 store：纯视觉，不参与撤销） */
export interface LinkDraft {
  side: PortSide
  nodeId: string
  /** 被拖的那只口的 id（融合节点的 `patch` 与 `output` 同在右侧，只看 side 分不出来） */
  portId: string
  /** 被拖口所在的一侧：草稿曲线的控制点朝哪边伸由它决定（右侧的输入口朝右伸） */
  fromSide: 'left' | 'right'
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

/**
 * 端点世界坐标（§6.14 端点位置 / §6.23 多端口）。
 *
 * 位置由**端口声明**给出（`side` + 纵向比例 `y`），不再写死「左中 / 右中」——
 * 融合节点的 `patch` 就在右侧、但纵向偏上，写死的版本会把它画到中点、与
 * `output` 重合。
 *
 * 兼容旧调用：传 `'input' / 'output'` 字符串时用默认口的位置。
 */
export function portAnchorWorld(
  node: { x: number; y: number; w: number; h: number },
  port: PortDecl | PortSide,
): { x: number; y: number } {
  const decl = typeof port === 'string' ? (port === 'input' ? INPUT_PORT : OUTPUT_PORT) : port
  return {
    x: decl.side === 'left' ? node.x : node.x + node.w,
    y: node.y + node.h * decl.y,
  }
}

/**
 * 松手时落在**哪一只口**上（产品文档 §6.23）。
 *
 * 节点可能有不止一个输入口，而「松手」只给出一个节点 —— 必须再挑一只。
 * 挑法：在候选口里取**离指针世界坐标最近**的那只。只有一只候选时就是它，
 * 与历史行为完全一致（那时每个节点最多一只输入口）。
 */
export function nearestInputPort(
  node: { x: number; y: number; w: number; h: number },
  type: Parameters<typeof getSpec>[0],
  point: { x: number; y: number },
): PortDecl | null {
  const spec = getSpec(type)
  if (!spec) return null
  const inputs = portDeclsOf(spec.ports).filter((p) => p.kind === 'input')
  if (inputs.length === 0) return null
  let best = inputs[0]
  let bestDist = Infinity
  for (const p of inputs) {
    const a = portAnchorWorld(node, p)
    const d = Math.hypot(a.x - point.x, a.y - point.y)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
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
    (_e: ReactPointerEvent, nodeId: string, portId: string, container: HTMLElement) => {
      const graph = store.getSnapshot()
      const node = graph.nodes.find((n) => n.id === nodeId)
      if (!node) return
      const decl = portDeclOf(getSpec(node.type)?.ports ?? { input: false, output: false }, portId)
      if (!decl) return
      const side: PortSide = decl.kind
      containerRef.current = container
      // 新的一次拖线先收掉可能还开着的连线菜单（§6.14：菜单关闭不改变已有连线）
      store.closeLinkMenu()
      const rect = container.getBoundingClientRect()
      const worldRect = { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
      // 端点锚点用世界坐标：画板子节点的 local 坐标需叠加父级偏移（§6.13 画板内连线）
      const parent = node.parentId ? graph.nodes.find((n) => n.id === node.parentId) : undefined
      const world = toWorldRect(node, parent)
      const anchor = portAnchorWorld(world, decl)

      setDraft({
        side,
        nodeId,
        portId,
        fromSide: decl.side,
        from: anchor,
        to: anchor,
        hoverNodeId: null,
        invalid: false,
      })

      const move = coalescePointerMove((ev: PointerEvent) => {
        const to = screenToWorld({ x: ev.clientX, y: ev.clientY }, store.getViewport(), worldRect)
        const hovered = nodeAtPoint(to, store.getSnapshot())
        const ok = hovered ? checkConnect(store, nodeId, decl, hovered, to) : null
        setDraft({
          side,
          nodeId,
          portId,
          fromSide: decl.side,
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
        /**
         * 空白处松手：**不取消**，改为在指针处弹出可连接菜单（§6.14「空白松手菜单」）。
         *
         * 此前这里是 `if (!hovered) return`——拖了半天线，松手在空白上就什么也没发生，
         * 等于逼用户把节点先挪近再连。文档从一开始就写了这个菜单，代码里却从未有过
         * 消费者（又一次「文档写了 = 已实现」）。
         * 坐标换成 surface 局部屏幕坐标（与右键菜单同口径：浮层不随画布变换）。
         */
        if (!hovered) {
          store.setLinkMenu(ev.clientX - worldRect.x, ev.clientY - worldRect.y, nodeId, side, portId)
          return
        }
        const check = checkConnect(store, nodeId, decl, hovered, to)
        if (!check.ok) return
        const wired = check.ports
        store.dispatch({
          kind: 'edge.connect',
          source: wired.source,
          target: wired.target,
          sourcePort: wired.sourcePort,
          targetPort: wired.targetPort,
        })
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

/**
 * 复用 domain 规则判定连通性，并把方向归一成 source → target（含两端端口）。
 *
 * 两条方向语义（§6.14）：
 * - 从**输出口**往外拖 → 被拖的节点是 source，落点是 target；落点那一侧用
 *   `nearestInputPort` 在它的输入口里挑一只（融合节点的 `patch` 就是这么接上的）；
 * - 从**输入口**反向拖 → 落点是 source（走它的默认输出口），被拖的节点是 target，
 *   用的是**被拖的那只口**。
 */
function checkConnect(
  store: CanvasStore,
  dragNodeId: string,
  dragPort: PortDecl,
  hoveredId: string,
  point: { x: number; y: number },
): { ok: true; ports: WiredPorts } | { ok: false; reason: string } {
  const graph = store.getSnapshot()
  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const dragNode = index.get(dragNodeId)
  const hovered = index.get(hoveredId)
  if (!dragNode || !hovered) return { ok: false, reason: '节点不存在' }

  let wired: WiredPorts
  if (dragPort.kind === 'output') {
    const world = toWorldRect(hovered, hovered.parentId ? index.get(hovered.parentId) : undefined)
    const targetPort = nearestInputPort(world, hovered.type, point)
    if (!targetPort) return { ok: false, reason: `${hovered.type} 没有输入端点` }
    wired = {
      source: dragNode.id,
      target: hovered.id,
      sourcePort: dragPort.id,
      targetPort: targetPort.id,
    }
  } else {
    wired = {
      source: hovered.id,
      target: dragNode.id,
      sourcePort: DEFAULT_SOURCE_PORT,
      targetPort: dragPort.id,
    }
  }

  const source = index.get(wired.source)
  const target = index.get(wired.target)
  if (!source || !target) return { ok: false, reason: '节点不存在' }
  const check = canConnect(source, target, graph, {
    sourcePort: wired.sourcePort,
    targetPort: wired.targetPort,
  })
  return check.ok ? { ok: true, ports: wired } : check
}

export interface WiredPorts {
  source: string
  target: string
  sourcePort: string
  targetPort: string
}

/** 端点是否可拖线（无输出端点 / 无输入端点的节点不参与，§6.14 端点位置） */
export function nodeHasPort(type: Parameters<typeof getSpec>[0], side: PortSide): boolean {
  const spec = getSpec(type)
  if (!spec) return false
  return portDeclsOf(spec.ports).some((p) => p.kind === side)
}

export type { Size }
