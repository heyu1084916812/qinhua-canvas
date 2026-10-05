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
export function FlowSurface({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <ReactFlowProvider>
      <FlowSurfaceInner onOpenSettings={onOpenSettings} />
    </ReactFlowProvider>
  )
}

const NODE_TYPES = { qh: FlowFlowNode }
const EDGE_OPTIONS = { type: 'default' } as const

function FlowSurfaceInner({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const store = useCanvasStore()
  const graph = useGraph()
  const selection = useSelection()
  const viewport = useViewportState()
  /** 两套视口语义不同，必须显式换算（见 viewportBridge.ts；1:1 同步会让新节点落到视野外） */
  const flowViewport = useMemo(() => storeViewportToFlow(viewport), [viewport])
  const rf = useReactFlow()
  const exec = useCanvasExecution()
  const { emitNodeEvent } = useCanvasPageEvents(store, onOpenSettings)

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

  const onSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: RFNode[] }) => {
      const ids = selected.map((n) => n.id)
      const cur = store.getSelection()
      if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return
      store.setSelection(ids)
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
        onSelectionChange={onSelectionChange}
        /* §6.15「单击画布空白 = 取消选中，收起面板」；「拖过就不算点空白」由 React Flow 自己区分点击与拖动 */
        onPaneClick={() => store.setSelection([])}
        onlyRenderVisibleElements
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--grid-line)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="var(--stroke)" maskColor="transparent" />
      </ReactFlow>
      <Hud count={graph.nodes.length} ids={nodes.map((n) => n.id)} />
    </div>
  )
}

function Hud({ count, ids }: { count: number; ids: string[] }) {
  const { x, y, zoom } = useViewport()
  const storeVp = useViewportState()
  const platform = usePlatform()
  const folder = platform.assetFolder
  const [folderName, setFolderName] = useState<string | null>(folder?.current()?.name ?? null)
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
    </div>
  )
}
