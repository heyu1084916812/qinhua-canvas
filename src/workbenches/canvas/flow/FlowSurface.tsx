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
  ReactFlow,
  ReactFlowProvider,
  useViewport,
  type Edge as RFEdge,
  type EdgeChange,
  type Node as RFNode,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import styles from './FlowSurface.module.css'
import {
  useCanvasStore,
  useEdgeSelection,
  useGraph,
  useSelection,
  useViewportState,
} from '../storeContext'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import { useCanvasPageEvents } from '../../../features/canvas/useCanvasPageEvents'
import { FlowChildFrame, FlowFlowNode, type FlowNodeData } from './FlowNode'
import { childrenByParent, isContainerType, topLevelNodes } from './flowGraph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { RunMode } from '../../../domain/canvas/model/runRecord'
import type { NodeViewEvent } from '../nodes/registry'
import { useNodeDerivedMaps } from '../useNodeDerivedMaps'
import type { FlowNodeDerivedProps } from './FlowNode'
import { QhEdge, type QhEdgeData } from './FlowEdge'
import { FlowPortLayer } from './FlowPortLayer'
import { FlowDraftLayer } from './FlowDraftLayer'
import { MultiSelectBar } from '../toolbar/MultiSelectBar'
import { sourcePortOf, targetPortOf } from '../../../domain/canvas/model/edge'
import { describeError } from '../../../shared/result'
import { flowViewportToStore, storeViewportToFlow } from './viewportBridge'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { useEdgeDrag } from '../../../features/canvas/useEdgeDrag'
import { useSpaceHeld } from '../../../features/canvas/useSpaceHeld'
/* 与 RF 自己的 `useViewport` 同名不同物：那个读 RF 视口，这个给「空格 + 拖拽」平移用 */
import { useViewport as useCanvasViewport } from '../../../features/canvas/useViewport'
import { describeLoadResult, loadAssetsFromFolder } from '../../../features/canvas/loadFromFolder'
import { describeExportReport, exportAssetsToFolder } from '../../../features/canvas/exportAssetsToFolder'
import { useNodeDownload } from '../../../features/canvas/useNodeDownload'
import { draggedFiles, importDroppedFiles } from '../../../features/canvas/dropImport'
import { dropPointOf, resolveDropOutcome } from '../../../features/canvas/dropReparent'
import { useNodeDrag } from '../../../features/canvas/useNodeDrag'
import { useClipboardHotkeys, rememberPointer } from '../../../features/canvas/useClipboard'
import { useCanvasKeyboard } from '../useCanvasKeyboard'
import { IMPORT_ACCEPT } from '../../../features/canvas/importAsset'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { Point } from '../../../domain/canvas/geometry/rect'
import { PanelLayer } from '../panels/PanelLayer'
import { NodeFollowBar } from '../toolbar/NodeFollowBar'
import { ContextMenu } from '../menu/ContextMenu'
import { LinkMenu } from '../menu/LinkMenu'
import { CanvasNotice } from '../surface/CanvasNotice'
import { Minimap } from '../surface/Minimap'
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
 * 给这一次按下所在的节点打一帧 `nodrag`（松手自动摘掉）。
 *
 * 为什么需要它：RF 的节点拖动是 **d3-drag 挂在节点元素上的原生监听**，它的过滤条件里有一条
 * 「目标的祖先里有没有 `nodrag`」；React 的 `stopPropagation` 挡不住它（`resizeHandle` 那条教训）。
 * 捕获阶段早于节点上的原生监听 ⇒ 这一帧打上，它这次就判定"不可拖"。
 *
 * 两处用它：**Alt + 拖动**（原地复制）、**空格 + 拖动**（平移画布）。
 */
function blockNativeNodeDrag(target: EventTarget | null): void {
  const frame = target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null
  if (!frame) return
  frame.classList.add('nodrag')
  const cleanup = () => {
    frame.classList.remove('nodrag')
    window.removeEventListener('pointerup', cleanup)
  }
  window.addEventListener('pointerup', cleanup)
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
  /** 选中的连线（§6.14）：选中态由 store 决定，RF 只是它的视图 */
  const edgeSelection = useEdgeSelection()
  const viewport = useViewportState()
  /** 两套视口语义不同，必须显式换算（见 viewportBridge.ts；1:1 同步会让新节点落到视野外） */
  const flowViewport = useMemo(() => storeViewportToFlow(viewport), [viewport])
  const exec = useCanvasExecution()
  const { emitNodeEvent } = useCanvasPageEvents(store, onOpenSettings)
  const platform = usePlatform()
  const handleDownload = useNodeDownload(platform, store)
  // Ctrl/Cmd + C/V（§4.2）：剪贴板是模块级单例、不订阅，故不参与本组件重渲染
  useClipboardHotkeys(store)
  /* 画布级快捷键（Z 复位视图 / Ctrl+Z 撤销 / Tab 与方向键导航 / Ctrl+G 打组）：
     与老表面同一份实现（见 `useCanvasKeyboard` 的说明）。少了它，G12 那条"复位视图"
     以及所有依赖 Ctrl+Z 的组在 RF 面全部静默失效。 */
  useCanvasKeyboard(store)
  /**
   * 空格按住 = 平移模式（§6.3）。RF 自己不认这条（见 `onSurfacePointerDown` 的注释），
   * 所以键位状态要在这里跟踪、平移要交给老表面那支 `useViewport.beginPan`。
   */
  const spaceHeld = useSpaceHeld()
  const { beginPan } = useCanvasViewport(store)
  const [importHover, setImportHover] = useState(false)
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
  /**
   * 端点拖线**也复用老表面那套控制器**（`useEdgeDrag`），理由比上面那条更硬：
   *
   * ① 语义只有一份 —— 方向（从输出口拖出 = 出 / 从输入口反拖 = 入）、落点选口
   *    （`nearestInputPort`，融合节点左侧 `input` 与右侧 `patch` 靠它分）、空白松手菜单、
   *    多选"共有端点"一次连多个，全都在这个控制器里，两个引擎不再各写一份；
   * ② 端点命中不受层叠影响 —— RF 的 Handle 会被相邻节点整块盖住（见 `FlowPortLayer` 注释），
   *    而这里由 `FlowPortLayer` 在最上层收指针，命中后调用本函数。
   *
   * 草稿曲线由 `FlowDraftLayer` 画（老表面是 `EdgeLayer` 画），锚点 `data-edge-draft` 不变。
   */
  const edgeDrag = useEdgeDrag(store)
  const edgeDragBegin = edgeDrag.begin
  const beginEdgeDrag = useCallback(
    (e: ReactPointerEvent, nodeId: string, portId: string, also?: readonly string[]) => {
      const surface = surfaceEl()
      if (!surface) return
      edgeDragBegin(e, nodeId, portId, surface, also)
    },
    [edgeDragBegin, surfaceEl],
  )

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
      /**
       * **空格 + 拖拽 = 平移画布**（§6.3）。这条必须在这里自己接：
       * React Flow 的 `panActivationKeyCode='Space'` 只放宽 d3-zoom 的过滤条件，
       * 指针落在**节点**上时 d3-drag 仍然先接管，而节点元素自带 `nopan`、连冒泡到画布的机会都没有
       * ⇒ 空格 + 拖节点 = 拖节点，画布纹丝不动（G4 实测 `(0,0) → (0,0)`）。
       * 老表面就是「捕获阶段 stopPropagation + 自己 `beginPan`」，这里照同一条：
       * 停掉原生传播（RF 的 d3 监听收不到）+ 打一帧 `nodrag` 兜底 + 交给 `useViewport.beginPan`。
       */
      if (e.button === 0 && spaceHeld) {
        e.preventDefault()
        e.stopPropagation()
        blockNativeNodeDrag(e.target)
        beginPan(e)
        return
      }
      const nodeId = (e.target as HTMLElement).closest('[data-node-id]')?.getAttribute('data-node-id')
      if (!nodeId) return
      if (store.isPanelDismissed()) store.setPanelDismissed(false)
      const tops = new Set(topLevelNodes(store.getSnapshot()).map((n) => n.id))
      if (!tops.has(nodeId)) return
      /**
       * **Alt + 拖动 = 原地复制**（§4.2）。这条**交给老表面那套控制器**（`useNodeDrag` 里已经
       * 有"先原地复制、再把副本拖走、松手按落点归属"的完整语义），并且要**掐断 RF 的原生拖动**：
       * RF 的拖动绑在原生 `pointerdown` 上，只靠 React 的 `stopPropagation` 拦不住
       * （见 `resizeHandle` 那条 `nodrag` 的教训）—— 不拦的话原件会被 RF 拖走、副本留在原地，
       * 正好把这条交互做反。捕获阶段停掉**原生**传播，RF 的监听器就不会被调用。
       */
      if (e.altKey) {
        /** 光停 React 的传播不够（理由见 `blockNativeNodeDrag`）：先给这一帧打上 `nodrag` */
        blockNativeNodeDrag(e.target)
        drag.begin(e, nodeId)
        return
      }
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
    [store, spaceHeld, beginPan],
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
    () => {
      const selectedNodes = new Set(selection)
      return graph.edges.map((e) => ({
        id: e.id,
        type: 'qh',
        source: e.source,
        target: e.target,
        sourceHandle: sourcePortOf(e),
        targetHandle: targetPortOf(e),
        /* 选中态从 store 推回来（与节点同一条：store 是唯一真相） */
        selected: edgeSelection.includes(e.id),
        data: {
          sourcePort: sourcePortOf(e),
          targetPort: targetPortOf(e),
          /* 选中节点时，与它相连的线一并高亮 + 出现删除按钮（§6.14，与老表面同一判据） */
          related: selectedNodes.has(e.source) || selectedNodes.has(e.target),
          onDelete: (id: string) => store.dispatch({ kind: 'edge.remove', id }),
        } satisfies QhEdgeData,
      }))
    },
    [graph.edges, selection, edgeSelection, store],
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

  /*
   * 端点拖线**不再走 React Flow 的连接手势**（`onConnect` / `isValidConnection` / `onConnectEnd`
   * 三件套已删）：RF 的 Handle 会被相邻节点整块盖住（见 `FlowPortLayer`），而且它只认"手柄到手柄"，
   * §6.14 的"松手落在节点范围内也完成连接""空白松手菜单""落点选最近输入口"都要自己再实现一遍。
   * 现在统一由 `FlowPortLayer`（命中）+ `useEdgeDrag`（语义）+ `FlowDraftLayer`（草稿）这条链路负责，
   * 两个引擎共用同一份建边规则 —— 不是"少接了一条"，是**刻意只留一份**。
   */

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

  /**
   * 给 RF 的**框选矩形**挂上老锚点 `data-marquee`（冒烟按它确认"Ctrl+拖 = 框选"真的画出来了）。
   *
   * 老表面那个矩形是自己的 div；RF 用内部类名 `.react-flow__selection`，而且元素随框选**动态增删**，
   * 所以不能像 `data-world` 那样挂一次就走 —— 用 MutationObserver 在它出现时打标（消失时随元素一起没了）。
   */
  useEffect(() => {
    const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
    if (!surface) return
    const tag = () => {
      for (const el of surface.querySelectorAll('.react-flow__selection')) {
        if (!el.hasAttribute('data-marquee')) el.setAttribute('data-marquee', '')
      }
    }
    tag()
    const observer = new MutationObserver(tag)
    observer.observe(surface, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const onEdgesDelete = useCallback(
    (deleted: { id: string }[]) => {
      for (const edge of deleted) store.dispatch({ kind: 'edge.remove', id: edge.id })
    },
    [store],
  )

  /**
   * 边的**选中**：与节点同一条路（受控模式下走 `EdgeChange('select')`，见 `onNodesChange` 的注释）。
   *
   * 为什么必须自己接：不接的话 RF 内部知道"这条边选中了"，而我们的 store 不知道
   * ⇒ `edges[].selected` 一直是 false ⇒ §6.14 的删除按钮永远不出现（G12 实测）。
   * 选中连线时 store 会**清掉节点选中**（`setEdgeSelection` 的既有语义，与老表面一致）。
   */
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RFEdge>[]) => {
      let next: string[] | null = null
      const selected = new Set(store.getEdgeSelection())
      for (const change of changes) {
        if (change.type !== 'select') continue
        if (change.selected) selected.add(change.id)
        else selected.delete(change.id)
        next = [...selected]
      }
      /**
       * ⚠️ `setEdgeSelection` 会**连节点选中一起清空**（既有语义：选中连线 = 取消节点选中）。
       * 而"点节点"这一下，RF 会同时发「节点选中」与「上一条连线取消选中」两批变更；
       * 若照单全收，后到的 `setEdgeSelection([])` 会把刚落下的节点选中清掉 ⇒
       * 相关连线的高亮/删除按钮随即消失（G12「节点选中时相关连线出现删除按钮」实测 btn=0）。
       * 既然结果与当前一致（多半是节点选中已经把它清了），就**不要重复下发**。
       */
      if (!next) return
      const before = store.getEdgeSelection()
      const same = next.length === before.length && next.every((id, i) => id === before[i])
      if (!same) store.setEdgeSelection(next)
    },
    [store],
  )

  /** 双击连线直接删除（§6.14）。RF 把 `dblclick` 挂在 `<g class="react-flow__edge">` 上，冒泡即达 */
  const onEdgeDoubleClick = useCallback(
    (_e: ReactMouseEvent, edge: RFEdge) => {
      store.dispatch({ kind: 'edge.remove', id: edge.id })
    },
    [store],
  )

  return (
    <div
      className={spaceHeld ? `${styles.surface} ${styles.spaceMode}` : styles.surface}
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
      {/* 拖线草稿（§6.14）：画在节点层**下面**（与老表面 EdgeLayer 同序），层本身不吃指针 */}
      <FlowDraftLayer draft={edgeDrag.draft} />
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
        /*
         * **关掉 RF 的三处自动平移**（拖线 / 拖节点 / 框选时指针贴边就自己滚画布）。
         * 老表面没有这个行为，而它会以两种方式咬人：
         * ① 落点判定失真 —— 用户明明"松在空白处"，画布已经在拖拽期间滚过，
         *    于是松手点下面滑来了一个节点 ⇒ 变成"连到那个节点上"或"被拒"，§6.14 的
         *    空白松手菜单永远不弹（G13 实测：菜单=0，而它上面一条"空白处松手不建边"照样绿）；
         * ② 换引擎不该顺手给用户加一套新动效 —— 要加，另开一轮单独定规则。
         *
         * 拖线相关的自动平移如今已无对象（RF 不再接管连线手势，见上面那段注释），
         * 但拖节点 / 框选这两条仍然要关 —— 留住整条配置，免得日后有人只删一半。
         */
        autoPanOnConnect={false}
        autoPanOnNodeDrag={false}
        autoPanOnSelection={false}
        viewport={flowViewport}
        onViewportChange={(next) => store.setViewport(flowViewportToStore(next))}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
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
        onEdgesChange={onEdgesChange}
        onEdgeDoubleClick={onEdgeDoubleClick}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--grid-line)" />
      </ReactFlow>
      <Hud store={store} projectId={projectId} count={graph.nodes.length} ids={nodes.map((n) => n.id)} />
      {/*
       * 工作区浮层：**直接复用老表面那一套**（它们都自成一体、只读 store），
       * 换引擎不该把创作面板、跟随栏、右键菜单、提示与撤销条重写一遍。
       * 仍未接的：标注/旋转/宫格（挂在跟随栏里，见 P4）。
       */}
      <PanelLayer onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} />
      <NodeFollowBar onOpenSettings={onOpenSettings} onDownload={handleDownload} />
      {/* 多选浮层（虚线框 + 六键栏 + 左右共有端点）：与老表面同一份实现，
          `onStartLink` 接的就是上面那个「老表面拖线控制器」 */}
      <MultiSelectBar onDownload={handleDownload} onStartLink={beginEdgeDrag} />
      <ContextMenu />
      <LinkMenu />
      <CanvasNotice />
      <UndoBar />
      {/* 小地图（§6.4）：复用老表面那份（自成一体、只读 store），最后渲染以免被别的浮层压住 */}
      <Minimap />
      {/* 端点命中层：在所有节点之上收拖线手势（见 FlowPortLayer 里的长注释） */}
      <FlowPortLayer onPortDown={beginEdgeDrag} />
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
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null)
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

  /**
   * 「导出素材到文件夹」（对账 #196 · 增量 5）：把内置库里的字节**一次性**写到选中的目录。
   *
   * 这是**桌面封装迁移的前置件**（《轻画-桌面封装方案.md》§3）：桌面壳是另一个 origin，
   * 库里的字节不会自己跟过去；先落成一个目录，"从文件夹加载"就能在新壳里把它们读回来。
   * 与"新素材自动镜像"共用同一份写盘实现 ⇒ **幂等**，重复点只是把已有的标成"盘上已有"。
   */
  const exportToFolder = async () => {
    if (!folder?.current() || exporting) return
    setExporting({ done: 0, total: 0 })
    try {
      const report = await exportAssetsToFolder(platform, (done, total) => setExporting({ done, total }))
      store.notify(describeExportReport(report, folder.current()?.name ?? ''))
    } catch (err) {
      store.notify(`导出素材失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(null)
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
      {/*
       * ⚠️ **不要再挂 `data-canvas-zoom`**：那是 §6.2 定的「小地图附近的缩放读数」，
       * 而小地图已经换回老表面那份 `Minimap`（它自带该锚点）。挂两处会让冒烟
       * `page.locator('[data-canvas-zoom]')` 变成 strict-mode violation（解析到 2 个元素直接抛）
       * —— G46 实测从 33/33 崩成「等不到 [data-canvas-zoom]」，真因其实是"拿到了两个"。
       * 这里的 `data-flow-zoom` 只给探针读，不再冒充产品锚点。
       */}
      <span data-flow-zoom>{Math.round(zoom * 100)}%</span>
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
      <button
        type="button"
        data-asset-folder-export
        disabled={!folderName || exporting !== null}
        title={
          folderName
            ? '把内置库里的素材全部导出到这个文件夹（备份 / 换机器用；已有的不会重写）'
            : '先选一个素材文件夹'
        }
        onClick={() => void exportToFolder()}
      >
        {exporting ? `导出中 ${exporting.done}/${exporting.total}…` : '导出素材到文件夹'}
      </button>
    </div>
  )
}
