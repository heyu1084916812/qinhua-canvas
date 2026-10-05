import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useViewport,
  type Connection,
  type FinalConnectionState,
  type Node as RFNode,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import styles from './FlowSurface.module.css'
import { useCanvasStore, useGraph, useSelection, useViewportState } from '../storeContext'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import { useCanvasPageEvents } from '../../../features/canvas/useCanvasPageEvents'
import { FlowChildFrame, FlowFlowNode, type FlowNodeData } from './FlowNode'
import { childrenByParent, isContainerType, topLevelNodes } from './flowGraph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { RunMode } from '../../../domain/canvas/model/runRecord'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeViewEvent } from '../nodes/registry'
import { useNodeDerivedMaps } from '../useNodeDerivedMaps'
import type { FlowNodeDerivedProps } from './FlowNode'
import { QhEdge } from './FlowEdge'
import { canConnect } from '../../../domain/canvas/graph/canConnect'
import { sourcePortOf, targetPortOf } from '../../../domain/canvas/model/edge'
import { describeError } from '../../../shared/result'
import { flowViewportToStore, storeViewportToFlow } from './viewportBridge'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { describeLoadResult, loadAssetsFromFolder } from '../../../features/canvas/loadFromFolder'
import { useNodeDownload } from '../../../features/canvas/useNodeDownload'
import { draggedFiles, importDroppedFiles } from '../../../features/canvas/dropImport'
import { dropPointOf, resolveDropOutcome } from '../../../features/canvas/dropReparent'
import { useNodeDrag } from '../../../features/canvas/useNodeDrag'
import { useClipboardHotkeys, rememberPointer } from '../../../features/canvas/useClipboard'
import { IMPORT_ACCEPT } from '../../../features/canvas/importAsset'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { Point } from '../../../domain/canvas/geometry/rect'
import { PanelLayer } from '../panels/PanelLayer'
import { NodeFollowBar } from '../toolbar/NodeFollowBar'
import { ContextMenu } from '../menu/ContextMenu'
import { CanvasNotice } from '../surface/CanvasNotice'
import { UndoBar } from '../surface/UndoBar'

/**
 * 引擎替换 P0：用 React Flow 渲染**真实图**。
 *
 * 边界（这条最重要）：**store 仍是唯一真相**。
 * - 位置 / 连线 / 选中由 React Flow 产出事件 → 立刻回写 store（`node.move` / `edge.connect` / `setSelection`）；
 * - store 的其它变更（数据 / 增删）→ 由 `useGraph()` 推回 React Flow。
 * 两边**不各存一份位置**，这正是 liblib.tv 自己踩过的「双源 stale」。
 *
 * P0 尚未接管（见《轻画-画布引擎替换方案.md》P1–P4）：
 * 面板 / 工具栏 / 标注 / 旋转 / 宫格 / 跟随栏 / 右键菜单 / 拖入导入 / 快捷键 / 容器与结果组。
 * 因此它挂在 `?engine=rf` 后面，默认仍是老画布。
 */
export function FlowSurface({
  projectId,
  onOpenSettings,
  onOpenSkills,
}: {
  projectId: string
  onOpenSettings?: () => void
  onOpenSkills?: () => void
}) {
  return (
    <ReactFlowProvider>
      <FlowSurfaceInner projectId={projectId} onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} />
    </ReactFlowProvider>
  )
}

const NODE_TYPES = { qh: FlowFlowNode }
const EDGE_TYPES = { qh: QhEdge }
const EDGE_OPTIONS = { type: 'default' } as const

/**
 * 世界坐标落在哪个节点身上（**连线**用的命中，与拖动归属是两件事）。
 *
 * 为什么需要自己算：React Flow 只在**手柄附近**（`connectionRadius`）才把 `toNode` 给你；
 * 产品文档 §6.14 要求"松手落在下游节点范围内也完成连接"，所以落在节点身上时得自己命中。
 * 后出现的节点优先（渲染时在上层）。结果组子节点的父不在 `nodes` 表 ⇒ 不作为边端点，跳过。
 */
function nodeAtWorldPoint(graph: GraphSnapshot, world: { x: number; y: number }): NodeSnapshot | null {
  let hit: NodeSnapshot | null = null
  for (const n of graph.nodes) {
    const parent = n.parentId ? graph.nodes.find((p: NodeSnapshot) => p.id === n.parentId) : null
    if (n.parentId && !parent) continue
    const x = (parent?.x ?? 0) + n.x
    const y = (parent?.y ?? 0) + n.y
    if (world.x >= x && world.x <= x + n.w && world.y >= y && world.y <= y + n.h) hit = n
  }
  return hit
}

/**
 * 指针屏幕坐标 → **世界坐标**（用画布 surface 的矩形 + store 视口换算）。
 *
 * 与「新建节点」「拖入导入」「连线落点」同一条口径。拿不到事件或 surface 时返回 `null`，
 * 由调用方决定是退回节点中心还是放弃 —— 不要在这里猜一个坐标出来。
 */
function pointerWorldPoint(
  ev: MouseEvent | TouchEvent | null | undefined,
  store: CanvasStore,
): Point | null {
  if (!ev || !('clientX' in ev)) return null
  const { clientX, clientY } = ev
  if (typeof clientX !== 'number' || typeof clientY !== 'number') return null
  const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return screenToWorld({ x: clientX, y: clientY }, store.getViewport(), {
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
  })
}

function FlowSurfaceInner({
  projectId,
  onOpenSettings,
  onOpenSkills,
}: {
  projectId: string
  onOpenSettings?: () => void
  onOpenSkills?: () => void
}) {
  const store = useCanvasStore()
  const graph = useGraph()
  const selection = useSelection()
  const viewport = useViewportState()
  /** 两套视口语义不同，必须显式换算（见 viewportBridge.ts；1:1 同步会让新节点落到视野外） */
  const flowViewport = useMemo(() => storeViewportToFlow(viewport), [viewport])
  const exec = useCanvasExecution()
  const { emitNodeEvent } = useCanvasPageEvents(store, onOpenSettings)
  const platform = usePlatform()
  const handleDownload = useNodeDownload(platform, store)
  // Ctrl/Cmd + C/V（§4.2）：剪贴板是模块级单例、不订阅，故不参与本组件重渲染
  useClipboardHotkeys(store)
  const [importHover, setImportHover] = useState(false)
  /** 是否正在拉线（`onConnectStart` → `onConnectEnd`）：防止"在端点上随手一点"被当成落点 */
  const connectingRef = useRef(false)
  /** 本次节点拖动是否**真的发生了位移**（§6.15：「有位移才让面板保持隐藏」） */
  const dragMovedRef = useRef(false)
  /**
   * 拖动起点锚：`{ 指针屏幕坐标, 缩放, 各被拖节点的起始世界坐标 }`，在**我们自己的
   * pointerdown** 上记（见 `onSurfacePointerDown`），不在 RF 的 `onNodeDragStart` 上记。
   *
   * 为什么不能用 `onNodeDragStart` 当基准：它触发时指针**已经走了一步**、而节点还没动
   * （实测差一整步），拿它算"应该落在哪"会把节点整体放偏 —— G71 里正是这个偏移把批量
   * 容器推到了创作面板底下。用途见 `onNodeDragStop` 的**终点对齐**。
   */
  const dragAnchorRef = useRef<{
    clientX: number
    clientY: number
    zoom: number
    nodes: Map<string, { x: number; y: number }>
  } | null>(null)

  /**
   * 容器子节点的拖动**复用老表面的控制器**（`useNodeDrag`）。
   *
   * 容器子节点不是 React Flow 的节点（由容器 View 按网格渲染），RF 拖不动它们；
   * 而「拖动改坐标 → 松手按落点判定归属（拖出容器 / 换容器）」这条语义本来就写在那个控制器里。
   * 再写一遍只会得到两份迟早走样的判定，所以这里直接共用。
   */
  const surfaceEl = useCallback(
    () => document.querySelector<HTMLElement>('[data-canvas-surface]'),
    [],
  )
  const drag = useNodeDrag(store, surfaceEl)

  /** 容器子节点按下：与老表面 `NodeLayer.onNodePointerDown` 同一套选中语义 + 拖动 */
  const onChildPointerDown = useCallback(
    (e: ReactPointerEvent, childId: string) => {
      if (e.shiftKey) {
        const sel = store.getSelection()
        store.setSelection(
          sel.includes(childId) ? sel.filter((id) => id !== childId) : [...sel, childId],
        )
        return
      }
      const sel = store.getSelection()
      if (!(sel.length > 1 && sel.includes(childId))) store.setSelection([childId])
      drag.begin(e, childId)
    },
    [store, drag],
  )

  /**
   * 画布上的 pointerdown（**捕获阶段**）：两件老表面在 pointerdown 上就做完的事。
   *
   * ① §6.15「拖动后，要下一次**显式选中**面板才回来」——RF 对**已经选中**的节点再点一下
   *    不产生任何 select 变更，标记就永远清不掉（G71 实测：拖动生成节点后点它，面板没开、
   *    它自己那句提示词根本没写进去，下游那趟于是空跑）。
   * ② 记**拖动起点锚**：终点对齐（见 `onNodeDragStop`）需要"按下时指针在哪、节点在哪"这对基准；
   *    不能在 RF 的 `onNodeDragStart` 上记 —— 那时指针已经走了一步、节点还没动。
   *
   * 只清标记 / 只记账：**不改选区、不阻断事件**（React Flow 那边照常收得到）。
   * ⚠️ 别改用 RF 的 `onNodeClick`：它会改变 RF 对节点的指针处理，
   * G71 那条「从端点拖出去连线」的手势会直接失效（实测边数 2 → 2）。
   */
  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const nodeId = (e.target as HTMLElement).closest('[data-node-id]')?.getAttribute('data-node-id')
      if (!nodeId) return
      if (store.isPanelDismissed()) store.setPanelDismissed(false)
      const tops = new Set(topLevelNodes(store.getSnapshot()).map((n) => n.id))
      if (!tops.has(nodeId)) return
      // 多选整组拖动：按下的是选区内的一员 → 锚要覆盖整组（与 RF 的拖动集合一致）
      const sel = store.getSelection().filter((id) => tops.has(id))
      const ids = sel.length > 1 && sel.includes(nodeId) ? sel : [nodeId]
      /**
       * 锚点取**节点渲染出来的位置**（DOM 的 rect），**不取 store 的 x/y**：
       * 两者在个别情况下会不一致（实测差 101px，见方案 §8.10.2），而"松手时节点该落在哪"
       * 是「用户看到的位置 + 指针位移」—— 用 DOM 才是自洽的（顺带把不一致纠正回来）。
       */
      const vp = store.getViewport()
      const zoom = vp.zoom || 1
      const surface = e.currentTarget.getBoundingClientRect()
      const nodes = new Map<string, { x: number; y: number }>()
      for (const id of ids) {
        const nodeEl = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
        if (!nodeEl) continue
        const r = nodeEl.getBoundingClientRect()
        nodes.set(id, {
          x: (r.left - surface.left) / zoom + vp.x,
          y: (r.top - surface.top) / zoom + vp.y,
        })
      }
      dragAnchorRef.current = { clientX: e.clientX, clientY: e.clientY, zoom, nodes }
    },
    [store],
  )

  /** 从系统拖入图片 / 视频（§6.3）：与老表面共用同一份批量导入规则 */
  const onDropFiles = async (e: ReactDragEvent<HTMLDivElement>) => {
    const files = draggedFiles(e)
    if (files.length === 0) return
    e.preventDefault()
    setImportHover(false)
    const r = e.currentTarget.getBoundingClientRect()
    const world = screenToWorld(
      { x: e.clientX, y: e.clientY },
      store.getViewport(),
      { x: r.left, y: r.top, w: r.width, h: r.height },
    )
    const { ids, rejected } = await importDroppedFiles({ platform, store, projectId }, files, world)
    if (rejected > 0) store.notify(`跳过 ${rejected} 个文件：只支持图片 / 视频素材`)
    if (ids.length > 0) {
      store.setSelection(ids)
      store.showUndoBar(`已导入 ${ids.length} 个素材`)
    }
  }

  /**
   * 画布右键菜单（§4.1）：**空白的按下位置**决定弹哪一份 ——
   * 落在节点上 → 选中它并弹节点菜单；否则弹画布菜单。
   *
   * 坐标必须是 surface 的**局部屏幕坐标**（菜单靠它定位），所以要用 `currentTarget` 的矩形换算。
   * 关闭由 `ContextMenu` 自己处理（window pointerdown / Esc / 滚轮），这里只负责打开。
   */
  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const nodeEl = (e.target as HTMLElement).closest('[data-node-id]')
      const nodeId = nodeEl?.getAttribute('data-node-id') ?? null
      if (nodeId) {
        if (!store.getSelection().includes(nodeId)) store.setSelection([nodeId])
        store.setMenu(x, y, { kind: 'node', nodeId })
      } else {
        store.setMenu(x, y, { kind: 'canvas' })
      }
    },
    [store],
  )

  /**
   * 视口**受控**（`viewport` + `onViewportChange`），不用 `defaultViewport`：
   * 后者会让 React Flow 与 store 各存一份视口 ⇒ 工具栏按 store 视口中心新建的节点
   * 会落在 React Flow 的视野之外，被 `onlyRenderVisibleElements` 裁掉
   * （第一次跑就实测到了：store 3 个节点、DOM 只画 2 个）。
   * 这里 store 是唯一真相，React Flow 只是它的一个视图。
   */
  /**
   * **故意不调 `fitView`**：老表面是"按项目存储的视口打开"，不自动重框。
   * 我一度在挂载时 fit 了一次 —— 结果缩放被改成 0.75，同样的屏幕坐标落到节点上的位置变了
   * （G66 里那一下点在了「上传素材」按钮上，而它 `stopPropagation` ⇒ 节点没选中、面板没开，
   * 表现为"上游缩略图 0"）。换引擎不该顺手改掉"打开时的取景"。
   */

  /** 节点事件出口：视图只能 emit，由这一层翻译成命令（架构 §4.7） */
  const makeEmit = useCallback(
    (nodeId: string) => (event: NodeViewEvent) => {
      if (event.type === 'requestRun') {
        void exec.runNode(nodeId)
        return
      }
      if (event.type === 'requestRunCancel') {
        exec.cancel()
        return
      }
      emitNodeEvent(nodeId, event)
    },
    [exec, emitNodeEvent],
  )

  /** 父 → 子索引（整图一次）：容器本体要拿它把自己的子节点画出来 */
  const childIndex = useMemo(() => childrenByParent(graph), [graph])

  /** 图级派生数据（上游素材 / 提示词数 / 可运行判定 / 图像输入 / 按口分组素材）：与老表面同一批口径 */
  const derived = useNodeDerivedMaps(graph)
  const derivedFor = useCallback(
    (id: string): FlowNodeDerivedProps => ({
      upstreamAssetHashes: derived.upstreamHashes.get(id),
      upstreamPromptCount: derived.upstreamPromptCounts.get(id),
      hasRunnableDownstream: derived.runnableDownstream.get(id),
      upstreamImageInputs: derived.upstreamImageInputs.get(id),
      inputPortAssets: derived.inputPortAssets.get(id),
    }),
    [derived],
  )

  /**
   * 容器子节点的渲染：与顶层节点**同一套** `NodeFrame` + `def.View`，
   * 差别只有坐标归零（由容器网格定位）与端点隐藏（§6.11）。
   */
  const renderFlowChild = useCallback(
    (child: NodeSnapshot) => {
      const state = exec.nodeStateOf(child.id)
      const running = state?.kind === 'queued' || state?.kind === 'running'
      const error = state?.kind === 'failed' ? describeError(state.error) : null
      const runMode: RunMode =
        state && (state.kind === 'queued' || state.kind === 'running' || state.kind === 'canceled')
          ? 'single'
          : 'idle'
      return (
        <FlowChildFrame
          key={child.id}
          child={child}
          selected={selection.includes(child.id)}
          running={running}
          error={error}
          runMode={runMode}
          emit={makeEmit(child.id)}
          resize={(rect, phase) => store.dispatch({ kind: 'node.resize', id: child.id, rect, phase })}
          zoom={viewport.zoom}
          onFramePointerDown={(e) => onChildPointerDown(e, child.id)}
          derived={derivedFor(child.id)}
        />
      )
    },
    [exec, selection, makeEmit, derivedFor, store, viewport.zoom, onChildPointerDown],
  )

  const nodes = useMemo<RFNode<FlowNodeData>[]>(
    () =>
      topLevelNodes(graph)
        .map((n) => {
          const state = exec.nodeStateOf(n.id)
          const running = state?.kind === 'queued' || state?.kind === 'running'
          const error = state?.kind === 'failed' ? describeError(state.error) : null
          const runMode: FlowNodeData['runMode'] =
            state && (state.kind === 'queued' || state.kind === 'running' || state.kind === 'canceled')
              ? 'single'
              : 'idle'
          return {
            id: n.id,
            type: 'qh',
            position: { x: n.x, y: n.y },
            /*
             * 尺寸按官方文档写在**节点对象**上（`width`/`height`），省掉一次测量。
             * ⚠️ 注意别把它当成"新节点不显示"的解药：那个症状的真因是**视口语义**
             * （见 viewportBridge.ts），尺寸给不给都实测 12/12。
             */
            width: n.w,
            height: n.h,
            /* 选中态由 store 决定（store 是唯一真相）：这样工具栏 / agent 程序化选中也能传到画布 */
            selected: selection.includes(n.id),
            style: { width: n.w, height: n.h },
            data: {
              node: n,
              running,
              error,
              runMode,
              emit: makeEmit(n.id),
              resize: (rect, phase) => store.dispatch({ kind: 'node.resize', id: n.id, rect, phase }),
              zoom: viewport.zoom,
              ...derivedFor(n.id),
              /*
               * 容器（分组 / 批量）：把子节点连同渲染函数一起交给容器本体 ——
               * 与老表面 `NodeLayer.renderChild` 同一套语义，网格布局与拖出归属都不用重写。
               */
              ...(isContainerType(n.type)
                ? {
                    childNodes: childIndex.get(n.id) ?? [],
                    renderChild:
                      (childIndex.get(n.id)?.length ?? 0) > 0 ? renderFlowChild : undefined,
                  }
                : {}),
            } satisfies FlowNodeData,
          }
        }),
    [graph, selection, exec, makeEmit, childIndex, renderFlowChild, derivedFor, store, viewport.zoom],
  )

  const edges = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        type: 'qh',
        source: e.source,
        target: e.target,
        sourceHandle: sourcePortOf(e),
        targetHandle: targetPortOf(e),
      })),
    [graph.edges],
  )

  /** 位置变化 → 翻译成 `node.move`（React Flow 给的是绝对坐标，这里换成增量） */
  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode<FlowNodeData>>[]) => {
      /**
       * **选中在受控模式下走 `NodeChange('select')`，不是 `onSelectionChange`**（实测：后者一次都不触发）。
       * 我第一版只处理 `position`、把 `select` 丢掉，于是"点节点选中不了、创作面板打不开"。
       * 这里把选中的增删落到 store，store 再经 `nodes[].selected` 推回画布 —— 保持 store 唯一真相。
       *
       * **基准集合只取 React Flow 认识的节点（顶层）**：容器子节点不在 RF 的节点列表里，
       * RF 就永远不会为它发 `select:false` —— 拖进容器后它会一直留在选中集合里，
       * 再点别的节点就凑成 2 个 ⇒ 创作面板（只认单选）再也不开（G71 实测的红）。
       */
      const rfIds = new Set(topLevelNodes(store.getSnapshot()).map((n) => n.id))
      const selected = new Set(store.getSelection().filter((id) => rfIds.has(id)))
      let selectionChanged = false
      for (const change of changes) {
        if (change.type !== 'select') continue
        if (change.selected) selected.add(change.id)
        else selected.delete(change.id)
        selectionChanged = true
      }
      if (selectionChanged) store.setSelection([...selected])

      const positions: { id: string; position: { x: number; y: number } }[] = []
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          positions.push({ id: change.id, position: change.position })
        }
      }
      if (positions.length === 0) return
      const current = new Map(store.getSnapshot().nodes.map((n) => [n.id, n]))
      const ids = positions.map((c) => c.id)
      const first = positions[0]
      const base = current.get(first.id)
      if (!base) return
      const dx = first.position.x - base.x
      const dy = first.position.y - base.y
      if (dx === 0 && dy === 0) return
      // 真有位移：松手后要让创作面板保持隐藏（§6.15），见 onNodeDragStop
      dragMovedRef.current = true
      store.dispatch({ kind: 'node.move', ids, dx, dy, phase: 'move' })
    },
    [store],
  )

  const onNodeDragStart = useCallback(
    (_e: MouseEvent | TouchEvent, _n: RFNode, dragged: RFNode[]) => {
      const ids = dragged.length > 0 ? dragged.map((n) => n.id) : [_n.id]
      dragMovedRef.current = false
      store.setDragging(true)
      store.dispatch({ kind: 'node.move', ids, dx: 0, dy: 0, phase: 'begin' })
    },
    [store],
  )

  const onNodeDragStop = useCallback(
    (e: MouseEvent | TouchEvent, _n: RFNode, dragged: RFNode[]) => {
      const ids = dragged.length > 0 ? dragged.map((n) => n.id) : [_n.id]
      let moved = dragMovedRef.current
      dragMovedRef.current = false
      /**
       * **终点对齐**：React Flow 的受控拖动会丢最后一帧位移 —— 实测节点停在倒数第二个采样点上，
       * 快速甩一下差一整个采样步（≈30px），于是"松手在哪儿"与"节点落在哪儿"对不上
       * （G71 里那一串下游连线就是被这点偏移带偏的；老表面在 pointerup 里 `move.flush()`
       * 也是为同一件事）。
       *
       * 修正量 = 「起点锚 + 指针位移」 − 「React Flow 给的终点」，多选一起补同一位移。
       * 补完再判定归属 / 落点，后面的几何才是用户看到的那一份。
       */
      const anchor = dragAnchorRef.current
      dragAnchorRef.current = null
      if (anchor && 'clientX' in e) {
        const movedX = (e.clientX - anchor.clientX) / anchor.zoom
        const movedY = (e.clientY - anchor.clientY) / anchor.zoom
        const current = new Map(store.getSnapshot().nodes.map((n) => [n.id, n]))
        for (const id of ids) {
          const from = anchor.nodes.get(id)
          const now = current.get(id)
          if (!from || !now) continue
          const fixX = from.x + movedX - now.x
          const fixY = from.y + movedY - now.y
          // 半像素以内不补：免得每次拖完都多落一条无意义的位移记录
          if (Math.abs(fixX) < 0.5 && Math.abs(fixY) < 0.5) continue
          moved = true
          store.dispatch({ kind: 'node.move', ids: [id], dx: fixX, dy: fixY, phase: 'move' })
        }
      }
      store.dispatch({ kind: 'node.move', ids, dx: 0, dy: 0, phase: 'end' })
      store.setDragging(false)
      // §6.15：有位移的拖动松手后创作面板保持隐藏，直到下一次显式选中（与老表面同一条口径）
      if (moved) store.setPanelDismissed(true)

      /**
       * 归属判定（§6.11 / §6.12）：React Flow 自己接管拖动，老的 `resolveDropOutcome`
       * **不在链路上** —— 不补这一步，"把节点拖进容器"就只会改坐标、不发生归属
       * （P3 留下的最大缺口）。与老表面一致，**只在单节点拖动时判定**：
       * 多选落进容器的归属有歧义（谁进谁不进），不做猜测。
       */
      if (ids.length !== 1) return
      const graph = store.getSnapshot()
      const node = graph.nodes.find((n) => n.id === ids[0])
      if (!node) return
      // 落点：指针位置（指针不在节点内 —— 真的甩出去了 —— 时退回节点中心），与老表面同一判定。
      // 上面那步终点对齐保证了"节点已在松手的地方"，所以这里不会再被丢帧带偏。
      const worldPoint = dropPointOf(pointerWorldPoint(e, store), node, graph)
      const outcome = resolveDropOutcome(node.id, worldPoint, graph)
      if (outcome.kind === 'rejected') {
        store.notify(outcome.reason)
        return
      }
      if (outcome.kind === 'ok') {
        store.dispatch({ kind: 'node.reparent', id: node.id, toParent: outcome.drop.toParent })
      }
    },
    [store],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      store.dispatch({
        kind: 'edge.connect',
        source: c.source,
        target: c.target,
        sourcePort: c.sourceHandle ?? undefined,
        targetPort: c.targetHandle ?? undefined,
      })
    },
    [store],
  )

  /** 连线合法性：交给 `canConnect` 一条口径（RF 拿它决定"能不能松手"的视觉反馈） */
  const isValidConnection = useCallback(
    (c: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }) => {
      if (!c.source || !c.target) return false
      const graph = store.getSnapshot()
      const source = graph.nodes.find((n) => n.id === c.source)
      const target = graph.nodes.find((n) => n.id === c.target)
      if (!source || !target) return false
      return canConnect(source, target, graph, {
        sourcePort: c.sourceHandle ?? undefined,
        targetPort: c.targetHandle ?? undefined,
      }).ok
    },
    [store],
  )

  /**
   * 松手没落在手柄上时**按产品文档 §6.14 补一次归属**：「落在下游节点范围内也完成连接」。
   * React Flow 只认"手柄到手柄"，这条产品行为要自己接 —— 否则用户从端点拖到节点身上松手会**什么都没发生**。
   */
  const onConnectEnd = useCallback(
    (_event: unknown, state: FinalConnectionState) => {
      // 只有"真的在拉线"才继续：否则在端点上随手一点也会被当成落点
      if (!connectingRef.current) return
      connectingRef.current = false
      if (state.isValid) return // 已落在合法手柄上 → onConnect 会处理
      /**
       * ⚠️ `state.from` / `state.to` 是**坐标**（`XYPosition`），不是节点 id ——
       * 起点节点要从 `state.fromNode` 取（类型文件里写得很清楚，别按名字猜）。
       */
      const fromNode = state.fromNode
      if (!fromNode) return
      const graph = store.getSnapshot()
      const source = graph.nodes.find((n) => n.id === fromNode.id)
      if (!source) return
      /**
       * 目标：先信 React Flow 给的 `toNode`（落在手柄附近），否则**自己按下落点命中**
       * —— 产品文档 §6.14「松手落在下游节点范围内也完成连接」就是这么要求的。
       */
      let target: NodeSnapshot | undefined = state.toNode
        ? graph.nodes.find((n) => n.id === state.toNode?.id)
        : undefined
      if (!target) {
        const world = pointerWorldPoint(_event as MouseEvent | null, store)
        if (!world) return
        target = nodeAtWorldPoint(graph, world) ?? undefined
      }
      if (!target || target.id === source.id) return
      const sourcePort = state.fromHandle?.id ?? undefined
      const check = canConnect(source, target, graph, { sourcePort })
      if (!check.ok) {
        store.notify(check.reason)
        return
      }
      store.dispatch({ kind: 'edge.connect', source: source.id, target: target.id, sourcePort })
    },
    [store],
  )

  const onNodesDelete = useCallback(
    (deleted: RFNode[]) => {
      const ids = deleted.map((n) => n.id)
      if (ids.length === 0) return
      store.dispatch({ kind: 'node.delete', ids })
      // 与右键菜单 / 跟随栏的删除同一句（老表面的键盘删除也会弹撤销条）
      store.showUndoBar('已删除节点')
    },
    [store],
  )

  /**
   * 给 React Flow 的**视口层**挂上老锚点 `data-world`。
   *
   * 为什么值得专门接：冒烟的 `readViewport()` 读的就是 `[data-world]` 的 style，从中解析
   * `translate(…px,…px) scale(…)` 来算坐标 —— 全量里大量组依赖它。而 RF 的
   * `.react-flow__viewport` 用的**正是同一种格式**（`translate(x,y) scale(z)`，
   * 其中 x = -vp.x*zoom，与老 `.world` 的 `translate(-vp.x*zoom,…)` 数值一致），
   * 所以挂上锚点后，那套坐标数学**一个字都不用改**。
   */
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-canvas-surface] .react-flow__viewport')
    if (!el) return
    el.setAttribute('data-world', '')
    return () => el.removeAttribute('data-world')
  }, [])

  const onEdgesDelete = useCallback(
    (deleted: { id: string }[]) => {
      for (const edge of deleted) store.dispatch({ kind: 'edge.remove', id: edge.id })
    },
    [store],
  )

  return (
    <div
      className={styles.surface}
      data-canvas-surface
      data-canvas-engine="rf"
      // 拖入素材：dragover 必须 preventDefault，否则浏览器按「不可放置」处理、根本不派发 drop
      onDragOver={(e) => {
        if (draggedFiles(e).length === 0) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setImportHover(true)
      }}
      onDragLeave={() => setImportHover(false)}
      onDrop={(e) => void onDropFiles(e)}
      data-import-hover={importHover ? 'true' : 'false'}
      data-import-accept={IMPORT_ACCEPT}
      // 只记坐标、不 setState：粘贴落点要用「当前鼠标位置」（§4.2）
      onPointerMove={(e) => rememberPointer({ x: e.clientX, y: e.clientY })}
      // 按下阶段：清「拖动后不弹面板」标记 + 记拖动起点锚（见 onSurfacePointerDown）
      onPointerDownCapture={onSurfacePointerDown}
      onContextMenu={onContextMenu}
    >
      <ReactFlow
        className={styles.flow}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        minZoom={0.1}
        maxZoom={5}
        /*
         * 手势对齐产品文档 §6.3（**不改现有习惯**）：
         * - 空白处左键拖 = 平移（React Flow 的 `panOnDrag` 默认行为）
         * - Ctrl / ⌘ + 拖 = 框选（默认是 Shift，这里改掉）
         * - Shift = 增/减选中（默认是 ⌘/Ctrl，这里改掉）
         */
        selectionKeyCode={['Control', 'Meta']}
        multiSelectionKeyCode={['Shift']}
        /* §6.3：中键拖拽也平移（左键拖拽是默认行为，空格 + 拖拽由 React Flow 自带） */
        panOnDrag={[0, 1]}
        viewport={flowViewport}
        onViewportChange={(next) => store.setViewport(flowViewportToStore(next))}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={() => {
          connectingRef.current = true
        }}
        isValidConnection={isValidConnection}
        onConnectEnd={onConnectEnd}
        /*
         * 不自己接 `onPaneClick` 清选中：React Flow **默认就会**在点空白时清（且能区分"拖过不算点"）。
         * 我一度自己加了一条无条件清空 —— 结果**点节点也会被它清掉**（选中立刻变 0，创作面板打不开）。
         * 教训：默认行为已经对时，多余的"显式"实现只会引入偏差。
         *
         * ⚠️ `onlyRenderVisibleElements` **暂不开**：开着时"生成 4 张"这类**刚创建、落在视口外**的节点
         * 不进 DOM，G9 实测当场只画 2 个（数据是对的、刷新后 4 个都在）。老表面的裁剪带 280px 预热，
         * 语义上更接近"都挂上"。等 P5 收口、冒烟全部按 RF 面改写之后再作为规模优化单独评估。
         */
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--grid-line)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="var(--stroke)" maskColor="transparent" />
      </ReactFlow>
      <Hud store={store} projectId={projectId} count={graph.nodes.length} ids={nodes.map((n) => n.id)} />
      {/*
       * 工作区浮层：**直接复用老表面那一套**（它们都自成一体、只读 store），
       * 换引擎不该把创作面板、跟随栏、右键菜单、提示与撤销条重写一遍。
       * 仍未接的：多选浮层的左右端点（那要桥接自研拖线控制器）、标注/旋转/宫格（挂在跟随栏里，见 P4）。
       */}
      <PanelLayer onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} />
      <NodeFollowBar onOpenSettings={onOpenSettings} onDownload={handleDownload} />
      <ContextMenu />
      <CanvasNotice />
      <UndoBar />
    </div>
  )
}

function Hud({
  store,
  projectId,
  count,
  ids,
}: {
  store: ReturnType<typeof useCanvasStore>
  projectId: string
  count: number
  ids: string[]
}) {
  const { x, y, zoom } = useViewport()
  const storeVp = useViewportState()
  const platform = usePlatform()
  const folder = platform.assetFolder
  const [folderName, setFolderName] = useState<string | null>(folder?.current()?.name ?? null)
  const [loading, setLoading] = useState(false)
  const canPick = folder?.supported() ?? false

  /** 画布里的「素材位置」入口（对账 #196）：选一个文件夹当素材位置；选了就是授权，刷新后要重选 */
  const pickFolder = async () => {
    if (!folder) return
    try {
      const picked = await folder.pick()
      setFolderName(picked?.name ?? folder.current()?.name ?? null)
    } catch (err) {
      platform.logger.log('warn', '[assetFolder] 选目录失败', { error: String(err) })
    }
  }

  /**
   * 「从文件夹加载」：把目录里的素材批量建成节点（对账 #196 · 增量 3）。
   * 落点用**当前视口中心**，换算与工具栏的「新建节点」同一条口径（`screenToWorld` + surface 矩形）。
   */
  const loadFromFolder = async () => {
    const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
    if (!el || !folder?.current()) return
    const r = el.getBoundingClientRect()
    const center = screenToWorld(
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      store.getViewport(),
      { x: r.left, y: r.top, w: r.width, h: r.height },
    )
    setLoading(true)
    try {
      const result = await loadAssetsFromFolder({ platform, store, projectId }, center)
      // 结果如实说：加载几张、跳过几个、失败几个（失败带第一个原因）
      store.notify(describeLoadResult(result))
    } catch (err) {
      store.notify(`从文件夹加载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={styles.hud}
      data-flow-hud
      data-flow-store-vp={`${Math.round(storeVp.x)},${Math.round(storeVp.y)}@${storeVp.zoom.toFixed(2)}`}
      data-flow-rf-vp={`${Math.round(x)},${Math.round(y)}@${zoom.toFixed(2)}`}
      data-flow-rf-nodes={ids.join(',')}
    >
      <span>引擎 React Flow（P1）</span>
      <span>节点 {count}</span>
      {/* `data-canvas-zoom` 是老表面的既有锚点（缩放读数），冒烟按它读画布缩放，故两份都挂 */}
      <span data-flow-zoom data-canvas-zoom>
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        data-asset-folder
        disabled={!canPick}
        title={
          canPick
            ? '选一个文件夹作为素材位置：新素材会镜像进去，读回时优先用它'
            : '当前环境不支持选择文件夹'
        }
        onClick={() => void pickFolder()}
      >
        素材：{folderName ?? '内置库'}
      </button>
      <button
        type="button"
        data-asset-folder-load
        disabled={!folderName || loading}
        title={folderName ? '把该文件夹里的图片 / 视频批量加载到画布' : '先选一个素材文件夹'}
        onClick={() => void loadFromFolder()}
      >
        {loading ? '加载中…' : '从文件夹加载'}
      </button>
    </div>
  )
}
