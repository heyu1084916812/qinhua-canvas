import { memo, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useGraph, useSelection, useCanvasStore } from '../storeContext'
import { useNodeDrag } from '../../../features/canvas/useNodeDrag'
import { useCanvasPageEvents } from '../../../features/canvas/useCanvasPageEvents'
import { getNodeDefinition, type InputPortAsset } from '../nodes/registry'
import { NodeFrame } from '../frame/NodeFrame'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import { describeError } from '../../../shared/result'
import { indexEdgesByTarget, upstreamsFrom } from '../../../domain/canvas/graph/upstreamOf'
import { hasRunnableDownstream } from '../../../features/canvas/execution/loopRun'
import { upstreamImagesOf } from '../../../domain/canvas/graph/resultImages'
import { indexNodes } from '../../../domain/canvas/model/graph'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { visibleTopLevelIds } from '../../../domain/canvas/layout/culling'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { NodeSnapshot, PromptData } from '../../../domain/canvas/model/node'
import { promptSpec } from '../../../domain/canvas/nodeSpecs/prompt'
import { heightFromContentOf, resizeLockOf } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { portDeclsOf } from '../../../domain/canvas/nodeSpecs/ports'
import { resolveCropContext } from '../../../domain/canvas/fusion/cropContext'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { targetPortOf } from '../../../domain/canvas/model/edge'
import { resultImagesOf } from '../../../domain/canvas/graph/resultImages'
import { imageAssetInputsOf } from '../../../domain/shared/execution/inputs'
import type { NodeInput } from '../../../domain/shared/execution/types'

/** 结果组子节点「拖动即取出」的位移阈值（屏幕 px）：小于它只算点击选中 */
const EXTRACT_THRESHOLD = 4

/**
 * 视口裁剪快照（架构 §5.4「视口外节点不挂载 DOM」+「平移缩放不触发节点重渲染」）。
 *
 * 关键是**引用稳定**：getSnapshot 按 graph / viewport / selection / surface 尺寸的
 * 引用比对做缓存——平移每帧都换 viewport 对象，但可见集合通常不变，
 * 返回同一个数组引用 → useSyncExternalStore 判定无变化 → 不重渲染。
 * 只有节点真正进出视口（含 margin 预热带）或选中集合变化时才换引用触发渲染。
 */
interface VisibleSnapshot {
  nodes: NodeSnapshot[]
  zoom: number
}

function useVisibleNodes(
  store: CanvasStore,
  surfaceEl: { current: HTMLElement | null },
): VisibleSnapshot {
  // 窗口尺寸变化不经过 store，监听后强制重算快照
  const [, bump] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    const onResize = () => bump()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const getSnapshot = useMemo(() => {
    let cache: {
      graph: GraphSnapshot
      vp: Viewport
      sel: readonly string[]
      w: number
      h: number
      out: VisibleSnapshot
    } | null = null
    return () => {
      const graph = store.getSnapshot()
      const vp = store.getViewport()
      const sel = store.getSelection()
      const w = surfaceEl.current?.clientWidth ?? 0
      const h = surfaceEl.current?.clientHeight ?? 0
      const c = cache
      if (c && c.graph === graph && c.vp === vp && c.sel === sel && c.w === w && c.h === h) {
        return c.out
      }
      const topLevel = graph.nodes.filter((n) => !n.parentId)
      const ids = visibleTopLevelIds(topLevel, vp, w, h)
      // 选中节点始终挂载（创作面板锚定 / 键盘导航 / 拖动落点判定依赖 DOM）
      for (const id of sel) ids.add(id)
      const nodes = topLevel.filter((n) => ids.has(n.id))
      /**
       * 引用稳定化的**第二道**：可见集合与缩放都没变时，复用上一次的快照对象。
       *
       * 少了这道，平移每一帧都会拿到新快照对象 ⇒ useSyncExternalStore 判「变了」
       * ⇒ 节点层整层重渲，而节点的世界坐标**一个都没动**（动的是 `.world` 的
       * transform）。架构 §5.4「平移 / 缩放不触发节点重渲染」在平移这条路上
       * 其实一直是空的：300 节点平移实测每帧 22.8ms，其中绝大部分就是这轮
       * 白跑的重渲（M6-29 Profiler 里它表现为一片 React 协调开销）。
       *
       * 缩放仍会换引用——`zoom` 参与快照、且它变了节点确实要按新比例重排。
       */
      const prev = cache
      if (prev && prev.out.zoom === vp.zoom && sameNodeList(prev.out.nodes, nodes)) {
        cache = { graph, vp, sel, w, h, out: prev.out }
        return prev.out
      }
      const out: VisibleSnapshot = { nodes, zoom: vp.zoom }
      cache = { graph, vp, sel, w, h, out }
      return out
    }
  }, [store, surfaceEl])

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** 两个节点数组是否**逐项同一个对象**（长度相同且每项 `===`） */
function sameNodeList(a: readonly NodeSnapshot[], b: readonly NodeSnapshot[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 「内容」是否等价：连线的端点、节点的 id / 类型 / 父级 / **数据对象**全都一致。
 *
 * 判据刻意**不含坐标**：拖动与缩放每帧都换掉整个 `graph` 引用（nodes 数组与
 * 节点对象都是新的），而 `x/y/w/h` 与下面这些派生值毫无关系。按 `graph` 引用
 * 做 memo 会让「只挪了一下位置」也触发整图上游重算——300 节点 / 500 边时那
 * 是 15 万次比较，实测把拖动帧预算撑到 34ms（M6-29）。
 *
 * `data` 走引用比较：图是 immutable 更新，产物回写 / 提示词改动都会换掉
 * `data` 对象，因此「引用相同」等价于「内容相同」，不需要深比较。
 */
function sameGraphContent(a: GraphSnapshot, b: GraphSnapshot): boolean {
  if (a === b) return true
  if (a.edges !== b.edges) return false
  if (a.nodes.length !== b.nodes.length) return false
  for (let i = 0; i < a.nodes.length; i += 1) {
    const x = a.nodes[i]
    const y = b.nodes[i]
    if (x === y) continue
    if (x.id !== y.id || x.type !== y.type || x.parentId !== y.parentId || x.data !== y.data) {
      return false
    }
  }
  return true
}

/**
 * 按**内容**而非引用缓存派生值（不是按引用，见 `sameGraphContent`）。
 *
 * 用 ref 而不是 `useMemo([graph])`：依赖里写 `graph` 就必然每帧重算，
 * 写别的内容键又会与 `graph` 不一致、被 exhaustive-deps 判违规。
 * ref 缓存是 React 官方认可的 memo 写法，且没有依赖数组要对齐。
 */
function useStableGraphMemo<T>(graph: GraphSnapshot, compute: (g: GraphSnapshot) => T): T {
  const cache = useRef<{ g: GraphSnapshot; v: T } | null>(null)
  const c = cache.current
  if (!c || !sameGraphContent(c.g, graph)) {
    const v = compute(graph)
    cache.current = { g: graph, v }
    return v
  }
  return c.v
}

/**
 * 节点层：把图快照里**视口内的顶层节点**渲染成 NodeFrame + 对应 View。
 * 选中 / 拖动 / 缩放 / 改名 / emit 事件都在本层接线，复用 features 的控制器。
 * 运行态（running / error / runMode）由画布执行宿主按 nodeId 反查后注入。
 *
 * memo：CanvasSurface 因平移每帧重渲，但本层 props（稳定回调 + ref）不变时跳过；
 * 可见集合变化由内部 useSyncExternalStore 驱动。
 */
export const NodeLayer = memo(function NodeLayer({
  onPortPointerDown,
  surfaceRef,
  onOpenSettings,
}: {
  /** 端点按下开始拖线建连（§6.14），由 CanvasSurface 注入 */
  onPortPointerDown?: (e: ReactPointerEvent, nodeId: string, portId: string) => void
  /** 画布表面容器：拖动松手时用它把屏幕坐标换回世界坐标（§6.11 归属判定）+ 裁剪取视口尺寸 */
  surfaceRef?: { current: HTMLElement | null }
  /** 宿主导航（去后台设置）：节点视图只 emit，路由由页面容器持有 */
  onOpenSettings?: () => void
} = {}) {
  const graph = useGraph()
  const selection = useSelection()
  const store = useCanvasStore()
  const vis = useVisibleNodes(store, surfaceRef ?? { current: null })
  const drag = useNodeDrag(store, () => surfaceRef?.current ?? null)
  const { emitNodeEvent } = useCanvasPageEvents(store, onOpenSettings)
  const exec = useCanvasExecution()

  const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const visibleNodes = vis.nodes
  // 父 → 子 索引：整图建一次（O(N)）。此前在渲染循环里对每个容器 `filter` 整表，
  // 容器一多就是 O(N²)——与上游派生同一类「每帧整图扫」的浪费。
  const childrenByParent = new Map<string, NodeSnapshot[]>()
  for (const n of graph.nodes) {
    if (!n.parentId) continue
    const bucket = childrenByParent.get(n.parentId)
    if (bucket) bucket.push(n)
    else childrenByParent.set(n.parentId, [n])
  }

  // 上游素材 hash：整图构建一次（此前每节点重建全图索引，300 节点 = O(N²)）
  //
  // 对比节点走**展开口径**（`expandResults`）：一次「跑 4 张」的产物在结果组里，
  // 只按上游自身 assetHash 读会让「批量出图 → 对比」永远只有 A 没有 B。
  // 其余节点仍按「每个上游 1 张」——生成节点若也展开，面板会显示 4 张
  // 而请求只发 1 张，正是要避免的口径割裂。
  const upstreamHashes = useStableGraphMemo(graph, (g) => {
    const idx = indexNodes(g.nodes)
    const byTarget = indexEdgesByTarget(g.edges)
    const out = new Map<string, string[]>()
    for (const n of g.nodes) {
      const upstreamIds = upstreamsFrom(byTarget, n.id)
      if (upstreamIds.length === 0) continue
      const hashes = upstreamImagesOf(upstreamIds, g, n.type === 'compare', idx).map((i) => i.assetHash)
      if (hashes.length > 0) out.set(n.id, hashes)
    }
    return out
  })
  // 上游提示词节点数量：整图构建一次（§6.7 本体「上游已链接提示词节点」胶囊）
  const upstreamPromptCounts = useStableGraphMemo(graph, (g) => {
    const idx = indexNodes(g.nodes)
    const byTarget = indexEdgesByTarget(g.edges)
    const out = new Map<string, number>()
    for (const n of g.nodes) {
      let c = 0
      for (const id of upstreamsFrom(byTarget, n.id)) {
        if (idx.get(id)?.type === 'prompt') c += 1
      }
      if (c > 0) out.set(n.id, c)
    }
    return out
  })
  /**
   * **分发器**节点（循环 / 批量）的「下游有没有可运行的生成节点」。
   *
   * 只给这两类算（其他类型不读这个值），但做成整图一次遍历、
   * 与上面的 upstream* 同款 memo，避免每个节点各自扫一遍图。
   */
  const runnableDownstream = useStableGraphMemo(graph, (g) => {
    const out = new Map<string, boolean>()
    for (const n of g.nodes) {
      if (n.type !== 'loop' && n.type !== 'batch') continue
      /**
       * 复用 `hasRunnableDownstream` 而不是在这里再写一遍判断。
       *
       * 一开始这里抄了一份 `canBuildRequest(d)`，结果与执行侧口径不一致：
       * `canBuildRequest` 只问「节点类型是否可生成」，不看渠道 / 模型配没配，
       * 于是按钮亮着、点下去空跑。**同一个事实只允许一个来源**。
       */
      out.set(n.id, hasRunnableDownstream(n, g))
    }
    return out
  })
  /**
   * 提示词节点的上游**图像素材项**（§6.7 反推：把图当素材送进 LLM）。
   *
   * 刻意复用 `promptSpec.collectInputs` 而不是在这里另扫一遍上游：
   * 「界面显示有图」与「请求真的带图」必须是同一份数据，否则又是一处
   * 「连上线就算生效」的假接通（与 M6-12 修掉的 `inputs` 同类）。
   * 只为 prompt 节点计算——其他类型用不到，白算就是浪费。
   */
  const upstreamImageInputs = useStableGraphMemo(graph, (g) => {
    if (!g.nodes.some((n) => n.type === 'prompt')) return new Map<string, NodeInput[]>()
    const out = new Map<string, NodeInput[]>()
    for (const n of g.nodes) {
      if (n.type !== 'prompt') continue
      const images = imageAssetInputsOf(
        promptSpec.collectInputs({ node: n as NodeSnapshot<PromptData>, graph: g }),
      )
      if (images.length > 0) out.set(n.id, images)
    }
    return out
  })
  /**
   * **按输入口分组**的上游素材（§6.23）：只有声明了多只输入口的节点会进这张表。
   *
   * 为什么不能复用 `upstreamHashes`：那份是「所有上游的并集」，fusion 用它会把
   * 左侧原图算成第 1 张局部修改图，整条链路从第一张就错位。
   */
  const inputPortAssets = useStableGraphMemo(graph, (g) => {
    const out = new Map<string, Record<string, InputPortAsset[]>>()
    const idx = indexNodes(g.nodes)
    /**
     * 每个节点「这一路有没有局部选区上下文」（§6.23）。整图算一次 O(N·E)，
     * 且只在这个 memo 重建时算（内容变了才重建）—— 不能放进每帧的渲染路径。
     */
    const hasContext = new Map<string, boolean>()
    const contextOf = (id: string): boolean => {
      const cached = hasContext.get(id)
      if (cached !== undefined) return cached
      const value = resolveCropContext(id, g, idx).kind === 'local'
      hasContext.set(id, value)
      return value
    }
    for (const n of g.nodes) {
      const spec = getSpec(n.type)
      if (!spec) continue
      /**
       * **共用口（`both`）也算输入口**：融合节点右侧那只口就是 `both`，
       * 只认 `kind === 'input'` 会让它整条被跳过 ⇒ 视图拿不到按口分组的素材，
       * 表现为「线连上了、节点里却写着『把一张完整原图连到左侧』」（实测踩到）。
       */
      const inputs = portDeclsOf(spec.ports).filter((p) => p.kind === 'input' || p.kind === 'both')
      // 单口节点：upstreamAssetHashes 已经表达了同一件事，不必再算一份
      if (inputs.length < 2) continue
      const byPort: Record<string, InputPortAsset[]> = {}
      for (const p of inputs) byPort[p.id] = []
      for (const e of g.edges) {
        if (e.target !== n.id) continue
        const bucket = byPort[targetPortOf(e)]
        if (!bucket) continue
        const hash = resultImagesOf(idx.get(e.source))[0]
        if (hash) bucket.push({ hash, hasContext: contextOf(e.source) })
      }
      out.set(n.id, byPort)
    }
    return out
  })
  const zoom = vis.zoom

  /**
   * 结果组子节点：**拖动 = 取出**（§6.9 / M6-25）。
   *
   * 组内**没有位置语义**——格位是 `resultGroupCells` 算出来的，允许在组内自由摆放
   * 只会换来「下次生成时版面又跳回去」的错位。于是组内拖动越过阈值后立刻
   * `node.reparent` 到根层：坐标 local → world、尺寸按 `naturalSize` 恢复真实比例
   * （§6.16），此后的拖动增量照常跟手（拖动控制器按增量移动，不认坐标来源）。
   *
   * 阈值（4px）存在的唯一理由：让「点一下选中」不会顺手把节点拖出组。
   * 监听器注册在 `drag.begin` **之后**，因此同一帧里先由拖动改 local 坐标、
   * 再由本函数换算落库——取出点与光标之间没有跳变。
   */
  const armExtractOnMove = (e: ReactPointerEvent, nodeId: string) => {
    const startX = e.clientX
    const startY = e.clientY
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < EXTRACT_THRESHOLD) return
      cleanup()
      const current = store.getSnapshot().nodes.find((n) => n.id === nodeId)
      if (!current?.parentId) return
      store.dispatch({ kind: 'node.reparent', id: nodeId, toParent: null })
    }
    const onUp = () => cleanup()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * 节点按下：选中语义 + 发起拖动（§6.15）。
   * - Shift + 按下 = 增减选中，不发起拖动（避免「想加选却把节点拖走了」）
   * - 普通按下：不在选区内 → 单选；已在多选选区内 → 保持选区（随后整组拖动）
   */
  const onNodePointerDown = (e: ReactPointerEvent, nodeId: string) => {
    if (e.shiftKey) {
      const sel = store.getSelection()
      store.setSelection(
        sel.includes(nodeId) ? sel.filter((id) => id !== nodeId) : [...sel, nodeId],
      )
      return
    }
    const sel = store.getSelection()
    if (!(sel.length > 1 && sel.includes(nodeId))) store.setSelection([nodeId])
    drag.begin(e, nodeId)
    // 结果组子节点（父不在 nodes 表）：拖动即取出
    const node = index.get(nodeId)
    if (node?.parentId && !index.has(node.parentId)) armExtractOnMove(e, nodeId)
  }

  /**
   * 容器（分组 / 批量）内的子节点由容器本体按网格渲染，
   * 这里只把 frame 递归交给容器视图，让它在自己的坐标系里摆放（§6.11 固定比例容器）。
   * 子节点的 local x/y 由网格决定，因此渲染时归零、位置交给外层单元容器。
   * 结果组的子节点仍由 ResultGroupLayer 呈现，不走本函数。
   */
  const renderChild = (child: NodeSnapshot) => {
    const def = getNodeDefinition(child.type)
    const st = exec.nodeStateOf(child.id)
    const running = st?.kind === 'queued' || st?.kind === 'running'
    const error = st?.kind === 'failed' ? describeError(st.error) : null
    // 分组 / 批量：由容器网格定位，child 坐标归零。
    const frameNode = { ...child, x: 0, y: 0 }
    // 分组 / 批量子节点隐藏端点。
    // 结果组子节点也隐藏：它的父不在 nodes 表（指向 resultGroups），端点会拖出
    // 一条 `canConnect` 必拒的线（§6.9「结果组不作为边端点」）。
    const parent = child.parentId ? index.get(child.parentId) : undefined
    const inResultGroup = !!child.parentId && !index.has(child.parentId)
    const portsHidden =
      inResultGroup || (!!parent && (parent.type === 'group' || parent.type === 'batch'))
    return (
      <NodeFrame
        key={child.id}
        node={frameNode}
        selected={selection.includes(child.id)}
        scale={zoom}
        ports={def.ports}
        minSize={def.sizing.min}
        portsHidden={portsHidden}
        resizeLock={resizeLockOf(child)}
        heightFromContent={heightFromContentOf(child)}
        onFramePointerDown={(e) => onNodePointerDown(e, child.id)}
        onResize={(rect, phase) => store.dispatch({ kind: 'node.resize', id: child.id, rect, phase })}
        onRename={(title) => store.dispatch({ kind: 'node.rename', id: child.id, title })}
        onPortPointerDown={(e, portId) => onPortPointerDown?.(e, child.id, portId)}
      >
        <def.View
          node={child}
          size={{ w: child.w, h: child.h }}
          scale={zoom}
          selected={selection.includes(child.id)}
          running={running}
          globalRunning={exec.isRunning && !running}
          runMode={st && (st.kind === 'queued' || st.kind === 'running' || st.kind === 'canceled') ? 'single' : 'idle'}
          error={error}
          upstreamAssetHashes={upstreamHashes.get(child.id)}
          upstreamPromptCount={upstreamPromptCounts.get(child.id)}
          hasRunnableDownstream={runnableDownstream.get(child.id)}
          emit={(ev) => emitNodeEvent(child.id, ev)}
        />
      </NodeFrame>
    )
  }

  return (
    <>
      {visibleNodes.map((node) => {
        const def = getNodeDefinition(node.type)
        const selected = selection.includes(node.id)
        const View = def.View
        const st = exec.nodeStateOf(node.id)
        const running = st?.kind === 'queued' || st?.kind === 'running'
        const error = st?.kind === 'failed' ? describeError(st.error) : null
        const runMode: 'idle' | 'single' =
          st && (st.kind === 'queued' || st.kind === 'running' || st.kind === 'canceled') ? 'single' : 'idle'
        // 容器类节点（分组 / 批量）：把子节点递归渲染成 frame，交给容器视图网格化定位
        const containerChildren =
          node.type === 'group' || node.type === 'batch' ? (childrenByParent.get(node.id) ?? []) : []
        return (
          <NodeFrame
            key={node.id}
            node={node}
            selected={selected}
            scale={zoom}
            ports={def.ports}
            minSize={def.sizing.min}
            resizeLock={resizeLockOf(node)}
            heightFromContent={heightFromContentOf(node)}
            onFramePointerDown={(e) => onNodePointerDown(e, node.id)}
            onResize={(rect, phase) => store.dispatch({ kind: 'node.resize', id: node.id, rect, phase })}
            onRename={(title) => store.dispatch({ kind: 'node.rename', id: node.id, title })}
            onPortPointerDown={(e, portId) => onPortPointerDown?.(e, node.id, portId)}
          >
            <View
              node={node}
              size={{ w: node.w, h: node.h }}
              scale={zoom}
              selected={selected}
              running={running}
              globalRunning={exec.isRunning && !running}
              runMode={runMode}
              error={error}
              upstreamAssetHashes={upstreamHashes.get(node.id)}
              upstreamPromptCount={upstreamPromptCounts.get(node.id)}
              hasRunnableDownstream={runnableDownstream.get(node.id)}
              upstreamImageInputs={upstreamImageInputs.get(node.id)}
              inputPortAssets={inputPortAssets.get(node.id)}
              childNodes={containerChildren}
              renderChild={containerChildren.length > 0 ? renderChild : undefined}
              emit={(ev) => {
                if (ev.type === 'requestRun') {
                  void exec.runNode(node.id)
                  return
                }
                if (ev.type === 'requestRunCancel') {
                  exec.cancel()
                  return
                }
                emitNodeEvent(node.id, ev)
              }}
            />
          </NodeFrame>
        )
      })}
    </>
  )
})
