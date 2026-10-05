import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Connection,
  type Node as RFNode,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import styles from './FlowSurface.module.css'
import { useCanvasStore, useGraph, useSelection, useViewportState } from '../storeContext'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import { useCanvasPageEvents } from '../../../features/canvas/useCanvasPageEvents'
import { FlowFlowNode, type FlowNodeData } from './FlowNode'
import { sourcePortOf, targetPortOf } from '../../../domain/canvas/model/edge'
import { describeError } from '../../../shared/result'
import { flowViewportToStore, storeViewportToFlow } from './viewportBridge'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { describeLoadResult, loadAssetsFromFolder } from '../../../features/canvas/loadFromFolder'
import { useNodeDownload } from '../../../features/canvas/useNodeDownload'
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
const EDGE_OPTIONS = { type: 'default' } as const

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
  const rf = useReactFlow()
  const exec = useCanvasExecution()
  const { emitNodeEvent } = useCanvasPageEvents(store, onOpenSettings)
  const platform = usePlatform()
  const handleDownload = useNodeDownload(platform, store)

  /**
   * 视口**受控**（`viewport` + `onViewportChange`），不用 `defaultViewport`：
   * 后者会让 React Flow 与 store 各存一份视口 ⇒ 工具栏按 store 视口中心新建的节点
   * 会落在 React Flow 的视野之外，被 `onlyRenderVisibleElements` 裁掉
   * （第一次跑就实测到了：store 3 个节点、DOM 只画 2 个）。
   * 这里 store 是唯一真相，React Flow 只是它的一个视图。
   */
  useEffect(() => {
    const id = requestAnimationFrame(() => rf.fitView({ padding: 0.2, maxZoom: 1 }))
    return () => cancelAnimationFrame(id)
  }, [rf])

  const nodes = useMemo<RFNode<FlowNodeData>[]>(
    () =>
      graph.nodes
        .filter((n) => !n.parentId)
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
              emit: (event) => {
                if (event.type === 'requestRun') {
                  void exec.runNode(n.id)
                  return
                }
                if (event.type === 'requestRunCancel') {
                  exec.cancel()
                  return
                }
                emitNodeEvent(n.id, event)
              },
            } satisfies FlowNodeData,
          }
        }),
    [graph, selection, exec, emitNodeEvent],
  )

  const edges = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
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
       */
      const selected = new Set(store.getSelection())
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
      store.dispatch({ kind: 'node.move', ids, dx, dy, phase: 'move' })
    },
    [store],
  )

  const onNodeDragStart = useCallback(
    (_e: unknown, _n: RFNode, dragged: RFNode[]) => {
      const ids = dragged.length > 0 ? dragged.map((n) => n.id) : [_n.id]
      store.setDragging(true)
      store.dispatch({ kind: 'node.move', ids, dx: 0, dy: 0, phase: 'begin' })
    },
    [store],
  )

  const onNodeDragStop = useCallback(
    (_e: unknown, _n: RFNode, dragged: RFNode[]) => {
      const ids = dragged.length > 0 ? dragged.map((n) => n.id) : [_n.id]
      store.dispatch({ kind: 'node.move', ids, dx: 0, dy: 0, phase: 'end' })
      store.setDragging(false)
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

  const onNodesDelete = useCallback(
    (deleted: RFNode[]) => {
      const ids = deleted.map((n) => n.id)
      if (ids.length > 0) store.dispatch({ kind: 'node.delete', ids })
    },
    [store],
  )

  const onEdgesDelete = useCallback(
    (deleted: { id: string }[]) => {
      for (const edge of deleted) store.dispatch({ kind: 'edge.remove', id: edge.id })
    },
    [store],
  )

  return (
    <div className={styles.surface} data-canvas-surface data-canvas-engine="rf">
      <ReactFlow
        className={styles.flow}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
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
        viewport={flowViewport}
        onViewportChange={(next) => store.setViewport(flowViewportToStore(next))}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        /*
         * 不自己接 `onPaneClick` 清选中：React Flow **默认就会**在点空白时清（且能区分"拖过不算点"）。
         * 我一度自己加了一条无条件清空 —— 结果**点节点也会被它清掉**（选中立刻变 0，创作面板打不开）。
         * 教训：默认行为已经对时，多余的"显式"实现只会引入偏差。
         */
        onlyRenderVisibleElements
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
    </div>
  )
}
