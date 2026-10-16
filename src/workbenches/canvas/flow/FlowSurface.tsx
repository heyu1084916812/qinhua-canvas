import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useViewport,
  useUpdateNodeInternals,
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
import { FlowChildEdgeLayer } from './FlowChildEdgeLayer'
import { FlowGroupBoardLayer } from './FlowGroupBoardLayer'
import { isChildEdge } from './childEdges'
import { FlowPortLayer } from './FlowPortLayer'
import { FlowDraftLayer } from './FlowDraftLayer'
import { FlowSnapLayer } from './FlowSnapLayer'
import { EmptyCanvasGuide } from '../surface/EmptyCanvasGuide'
import { MultiSelectBar } from '../toolbar/MultiSelectBar'
import { sourcePortOf, targetPortOf } from '../../../domain/canvas/model/edge'
import { describeError } from '../../../shared/result'
import { flowViewportToStore, storeViewportToFlow } from './viewportBridge'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { useCanvasStyle } from '../../../app/providers/CanvasStyleProvider'
import { useFonts } from '../../../app/providers/FontProvider'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { useEdgeDrag } from '../../../features/canvas/useEdgeDrag'
import { useSpaceHeld } from '../../../features/canvas/useSpaceHeld'
/* 与 RF 自己的 `useViewport` 同名不同物：那个读 RF 视口，这个给「空格 + 拖拽」平移用 */
import { useViewport as useCanvasViewport } from '../../../features/canvas/useViewport'
/*
 * 「素材文件夹」那四个动作已抽到 `features/canvas/useAssetFolderActions`：
 * 选目录 / 导出在「全局设置 → 存储」，从文件夹加载在空白处右键菜单（对账 #293）。
 * 这里不再直接 import 那两个实现 —— 否则同一件事会在两处各接线一次。
 */
import { useNodeDownload } from '../../../features/canvas/useNodeDownload'
import {
  clipboardMediaFiles,
  draggedFiles,
  hasDraggedFiles,
  importDroppedFiles,
} from '../../../features/canvas/dropImport'
import { batchSlotOf, dropPointOf, resolveDropOutcome } from '../../../features/canvas/dropReparent'
import { computeSnap, SNAP_THRESHOLD_SCREEN_PX } from '../../../domain/canvas/layout/snap'
import { useNodeDrag } from '../../../features/canvas/useNodeDrag'
import {
  useClipboardHotkeys,
  rememberPointer,
  pastePoint,
} from '../../../features/canvas/useClipboard'
import { isTextEntryElement } from '../../../features/shared/textTarget'
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
 * 「点空白清选中」的**豁免名单**（浮在画布上、不属于画布空白的东西）。
 *
 * 三段历史教训都写在这儿，别再踩一次：
 *
 * ① **情绪面板必须在名单里**（`[data-emotion-panel]`，2026-10-08 补）。
 *    它与创作面板是同一个位置上的两种模式，但从创作面板里搬出来时漏了一笔 ——
 *    后果不是"少点一下"，而是**点它里面任何东西都会把自己关掉**：
 *    面板虽然在 `onPointerDown` 里停了传播，可按下锚是在**捕获阶段**记的
 *    （`onPointerDownCapture`）⇒ 松手时那个 `click` 照样落到这里、被判成点空白 ⇒
 *    清选中 ⇒ 面板随 `selectedNode` 一起卸载（实测 g105 / g108 两条红）。
 *
 * ② **端点命中层也必须算"不是空白"**（`[data-flow-port-hit]`）：它挂在节点**外面**
 *    （与节点元素是兄弟），`closest('[data-node-id]')` 找不到节点；不排除它的话，
 *    "点一下端点没拖动"会被当成点空白、把选中清掉 ⇒ 跟随栏整条消失，后面
 *    「排列与整理」再也点不到（G15）。
 *
 * ③ **空画布模板卡片**（`[data-empty-canvas-guide]`，对账 #388）：同样是浮在画布上的一层。
 *
 * ⚠️ **写成数组再 `join(', ')`，不要再拼字符串**：
 * 2026-10-09 实测踩过一次 —— 少写一个逗号会把两条选择器拼成**后代组合**（`A B`），
 * `closest()` **不报错**、只是永远不匹配；表现就是 G15 红：点端点被当成点空白、
 * 组的选中被清掉、跟随栏再也不回来。枚举式名单本来就容易漏，改成数组至少让
 * "少一个逗号"这种手滑在 diff 里一眼可见。
 */
const FLOATING_SELECTORS = [
  '[data-creation-panel]',
  '[data-emotion-panel]',
  '[data-node-follow-bar]',
  '[data-multi-select-bar]',
  '[data-context-menu]',
  '[data-link-menu]',
  '[data-canvas-notice]',
  '[data-undo-bar]',
  '[data-lightbox]',
  '[data-minimap]',
  '[data-flow-hud]',
  '[data-canvas-toolbar]',
  '[data-edge]',
  '.react-flow__edge',
  '.react-flow__handle',
  '[data-flow-port-hit]',
  '[data-empty-canvas-guide]',
].join(', ')

/**
 * 给这一次按下所在的节点打一帧 `nodrag`（松手自动摘掉）。
 *
 * 为什么需要它：RF 的节点拖动是 **d3-drag 挂在节点元素上的原生监听**，它的过滤条件里有一条
 * 「目标的祖先里有没有 `nodrag`」；React 的 `stopPropagation` 挡不住它（`resizeHandle` 那条教训）。
 * 捕获阶段早于节点上的原生监听 ⇒ 这一帧打上，它这次就判定"不可拖"。
 *
 * 两处用它：**Alt + 拖动**（原地复制）、**空格 + 拖动**（平移画布）。
 *
 * ⚠️ **必须盯着它被抹掉再补回来**：`nodrag` 是手写在 DOM 上的类，而 React 每次提交都会把
 * 那个元素的 `className` 整块重写（这一帧正好会重渲染：`node.duplicate` / 选中变化都会改
 * 节点元素的类名）—— 而 d3-drag 的过滤条件是在**它自己的按下监听器**里才读这个类，
 * 那时 React 已经提交过一轮。漏了这一步的实测后果（第 16 批探针）：按下瞬间类还在、
 * 一进拖动就没了 ⇒ 原件被 RF 拖走、副本留在原地，正好把「Alt 复制」做反
 *（用户看到的是"两个节点都跑到新位置去了"）。
 * `MutationObserver` 的回调与 React 的提交在**同一个微任务检查点**里跑，
 * 补回去的时刻仍早于 d3 的按下监听器。
 */
function blockNativeNodeDrag(target: EventTarget | null): void {
  const frame = target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null
  if (!frame) return
  const ensure = () => {
    if (!frame.classList.contains('nodrag')) frame.classList.add('nodrag')
  }
  ensure()
  const observer = new MutationObserver(ensure)
  observer.observe(frame, { attributes: true, attributeFilter: ['class'] })
  const cleanup = () => {
    observer.disconnect()
    frame.classList.remove('nodrag')
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
  }
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
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
  /**
   * 项目级画布外观（对账 #379 C4/C5）：背景样式 / 色调 / 节点内容字号。
   * 它存在项目行里、随项目导出（见 domain/project/canvasStyle 的说明），
   * 运行时由 CanvasStyleProvider 统一供给 —— 设置浮层改了这里当帧就变。
   */
  const { style: canvasStyle } = useCanvasStyle()
  /** 界面偏好（本机）：小地图显示开关（#379 剩余项） */
  const { appearance } = useFonts()
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
   * 这一次按下的**屏幕坐标**：给 `onSurfaceClick` 判"是点了一下还是拖过一段"用
   *（见那里的注释：框选 / 平移松手后浏览器仍会补一个 `click`）。
   */
  const pressAtRef = useRef<{ x: number; y: number } | null>(null)
  /**
   * 本次事件里**刚落下过"节点选中"变更**。
   *
   * 框选时 RF 会先发"选中这些节点"、**紧接着**再发"选中挂在这些节点上的线"
   * （`commitUserSelectionRect` 里那两段是连着调的）—— 见 `onEdgesChange` 里为什么需要它。
   */
  const nodeSelectStampRef = useRef(false)

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

  /** 容器子节点按下：与老表面 `画布表面.onNodePointerDown` 同一套选中语义 + 拖动 */
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
      /**
       * ★ **批量**里的子节点：位置由格位决定 ⇒ 拖动开始时先把坐标**归一成它的格位**。
       * 这样"拖动位移 = 坐标 − 格位"成立，视图才画得出拖动（用户第 15 批 #335-③：
       * 「批量节点内部的子节点可以点击+拖动出批量节点，但是我看不到拖动」）。
       * 事务与随后那串 `node.move` 合并（同一个 coalesce key）⇒ 一次撤销全退。
       */
      const slot = batchSlotOf(childId, store.getSnapshot())
      if (slot) {
        store.dispatch(
          { kind: 'node.reparent', id: childId, toParent: slot.parentId, at: slot.at },
          { mode: 'coalesce', groupId: `move:${childId}`, label: '移动节点' },
        )
      }
      drag.begin(e, childId)
    },
    [store, drag],
  )

  /**
   * ★★ 点容器（分组 / 批量）里的子节点：**选中判给子节点，不是容器**
   * （用户第 15 批 #333：「分组功能选择不了里面的节点…我需要的是分组里面的节点也可以单独操作」；
   *  #335-②：「批量节点也无法真正的选中里面的子节点，会跳转到选中批量节点上」）。
   *
   * 为什么必须在这一层兜：子节点是容器节点的 **DOM 后代**，而 React Flow 的
   * `handleNodeClick` 绑在**容器**那个节点元素上（它只知道"这次点击属于哪个 RF 节点"）
   * ⇒ 点子节点时 RF 一定会把容器选上。按下阶段我们已经按子节点规则选过一次
   *（`onChildPointerDown`），这里是**等 RF 覆盖之后再改回来**：
   * React 的合成事件按 React 树的深度派发，容器节点比这层 surface **更深、先跑**，
   * 所以挂在 surface 上的 `onClick` 天然是"最后一个说话的人"。
   *
   * 三条口径（与 `onChildPointerDown` 完全一致，别各写一份）：
   * ① 普通点 = 选中这一个子节点；② Shift 点 = 增 / 减选；
   * ③ 顺带把**被点节点的父容器**从选中集合里摘掉 —— RF 刚才把它选上了。
   *（容器不嵌套 ⇒ 祖先最多一层，直接看 `parentId` 就够。）
   */
  const onSurfaceClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      /**
       * ★★ **拖过一段就不算"点空白"**（用户第 17 批 #1：「上面三个图**有时候**框选多选不了」）。
       *
       * 浏览器的 `click` 只要**按下与松手在同一个元素**上就会触发，不管中间拖了多远 ——
       * 而框选（Ctrl+拖）与平移（空白处拖）都恰好是"按在画布上、松手也在画布上"
       * ⇒ 松手那一瞬间会跟着来一个 `click`，把刚框好的选中**整片清掉**。
       * 用户说的"有时候"就是这么来的：起点与终点落在同一个元素上才触发
       *（落在连线上 / 落在另一个节点上就不触发 —— 于是看起来像"跟连线有关"）。
       *
       * 阈值取 4px，与 RF 自己的 `paneClickDistance` 同一口径（它也是拿"有没有移动过"区分点击）。
       */
      const press = pressAtRef.current
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) return
      const target = e.target as HTMLElement
      const hit = target.closest('[data-node-id]')
      const childId = hit?.getAttribute('data-node-id')
      if (!childId) {
        /**
         * ★★ 点**画布空白**：把选中清掉（用户第 16 批 #4：「批量节点和分组背景里面的节点
         * 选中后弹出的框点击画布空白区域无法隐藏」）。
         *
         * 为什么必须自己清：容器子节点**不是 RF 节点**，RF 的"点空白清选中"只清它自己
         * 认得的那些 ⇒ 子节点会一直赖在选中集合里，创作面板也就一直开着。
         * 只在**画布本身**上清：点面板 / 菜单 / 跟随栏 / 连线等浮层一律不插手
         *（那是它们自己的交互，清了反而坏事）。
         */
        if (target.closest(FLOATING_SELECTORS)) return
        if (store.getSelection().length > 0) store.setSelection([])
        return
      }
      const graph = store.getSnapshot()
      const node = graph.nodes.find((n) => n.id === childId)
      /** 顶层节点：RF 自己就选对了，不插手 */
      if (!node?.parentId) return
      const sel = store.getSelection()
      const kept = node.parentId ? sel.filter((id) => id !== node.parentId) : sel
      const next = kept.includes(childId)
        ? kept
        : e.shiftKey
          ? [...kept, childId]
          : [childId]
      const same = next.length === sel.length && next.every((id, i) => id === sel[i])
      if (!same) store.setSelection(next)
    },
    [store],
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
      pressAtRef.current = { x: e.clientX, y: e.clientY }
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

  /**
   * 导入一批素材文件 —— **拖入**与**从系统剪贴板粘贴**共用这一条。
   *
   * 抽出来的理由与「下载」那条一样：两个入口各写一遍，迟早在其中一处漏掉
   * 已经修好的行为（选中新节点 / 一次撤销 / 被拒文件要说一声）。
   */
  const importFiles = useCallback(
    async (files: readonly File[], world: Point): Promise<void> => {
      const { ids, rejected } = await importDroppedFiles(
        { platform, store, projectId },
        files,
        world,
      )
      if (rejected > 0) store.notify(`跳过 ${rejected} 个文件：只支持图片 / 视频素材`, 'error')
      if (ids.length > 0) {
        store.setSelection(ids)
        store.showUndoBar(`已导入 ${ids.length} 个素材`)
      }
    },
    [platform, store, projectId],
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
    await importFiles(files, world)
  }

  /**
   * **从系统剪贴板粘贴素材进画布**（用户 2026-10-16：「软件外的内容无法复制进画布」）。
   *
   * 这条链路此前**完全不存在**：画布的 `Ctrl+V` 只认「应用内复制的节点快照」，
   * 从截图工具 / 浏览器复制来的图没有任何人接手 —— 于是用户手里唯一能进图的入口
   * 就只剩生成节点的「上传」（对账 #551）。
   *
   * 两条纪律（与 `useClipboardHotkeys` 同口径）：
   * - **文本框内放行**：节点正文 / 面板里粘字才是用户的本来意图，不能抢；
   * - **剪贴板里没有媒体就放行**：粘文字、粘路径这些正常粘贴一律不吞。
   *
   * 落点复用「粘贴落点」：鼠标在哪儿就落在哪儿（没动过鼠标则落在视口中心）。
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTextEntryElement(e.target as { tagName?: string; isContentEditable?: boolean } | null)) {
        return
      }
      const files = clipboardMediaFiles(e.clipboardData)
      if (files.length === 0) return
      const at = pastePoint(store)
      if (!at) return
      e.preventDefault()
      void importFiles(files, at)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [store, importFiles])

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
               * 与老画布那套「容器子节点按网格渲染」同一套语义，网格布局与拖出归属都不用重写。
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
      const list = graph.edges
        /**
         * 牵涉容器子节点的边**摘出去**交给 `FlowChildEdgeLayer` 画：
         * RF 按 `source / target` 找它自己的节点，子节点不在其中 ⇒ 这类边在 RF 里
         * 找不到端点、会静默消失（图上连着、屏幕上看不见）。
         */
        .filter((e) => !isChildEdge(graph, e))
        .map((e) => ({
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
      return list
    },
    /*
     * ⚠️ 依赖里必须是**整个 `graph`**，不能只写 `graph.edges`：
     * 上面那个 `isChildEdge` 读的是**节点**的 `parentId`（"这条边牵涉容器子节点吗"），
     * 而"节点进出容器"只换 `graph.nodes`、**`graph.edges` 这个数组还是原来那一个引用**
     * ⇒ 只依赖 `graph.edges` 的话这份列表**不会重算**，用户会看到
     * 「拖出分组的节点连着的线整条消失，直到下次点空白（选中变化）才回来」
     *（第 16 批 #7 探针实测：拖出后 `list.length = 0`、`childEdges = 2`；
     *  点一下空白才变成 `2 / 0` —— 差的就是这一次重算）。
     */
    [graph, selection, edgeSelection, store],
  )

  /**
   * **连线偶发不显示**的兜底重测（2026-10-10 全量冒烟抓到：G2 / G51 / G107 各红一次，
   * 探针复现率 2/6~2/8）。
   *
   * 实测事实（探针读的是**同一个 store 快照**，不是猜测）：
   * - 库里 2 条边、`store.getSnapshot().edges.length === 2`、3 个节点也都渲染出来了；
   * - 但 `.react-flow__edge` / `[data-edge]` 是 **0**，滚轮缩放 / 点空白 / 改窗口都救不回来，
   *   只有刷新页面才恢复。
   *
   * 结论：不是数据问题，是 React Flow 的**节点测量**漏了一拍 —— 它要拿到端点的
   * `handleBounds` 才肯画边，而首帧正好撞上「模板灌入 + `fitCanvasView` 改视口」
   * （两帧 rAF），测量一旦落空就再没人重测。这里在节点集合变化后补一次
   * `updateNodeInternals`（延后到视口自适应之后），把这一拍补上。
   */
  const updateNodeInternals = useUpdateNodeInternals()
  const nodeIdsKey = graph.nodes.map((n) => n.id).join('|')
  useEffect(() => {
    if (!nodeIdsKey) return
    const ids = nodeIdsKey.split('|')
    /** 双 rAF + 一小段延迟：等节点进 DOM、且 `fitCanvasView` 的两帧 rAF 跑完再量 */
    const rafs: number[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    rafs.push(
      requestAnimationFrame(() => {
        rafs.push(
          requestAnimationFrame(() => {
            timer = setTimeout(() => updateNodeInternals(ids), 120)
          }),
        )
      }),
    )
    return () => {
      for (const raf of rafs) cancelAnimationFrame(raf)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [nodeIdsKey, updateNodeInternals])

  /**
   * **吸附判定**（对账 #257）：喂"没有吸附的原始位移"，拿回"修正量 + 要画的提示"。
   *
   * 三件事按用户口径定死：
   * 1. **只吸同级顶层节点**（`topLevelNodes`）—— 容器子节点不参与，也不吸它：
   *    用户明确说「容器内节点本身有自动整理功能」，两套排布规则叠在一起只会打架；
   * 2. **触发距离 8px 是屏幕像素** ⇒ 除以缩放换成世界单位（缩到 50% 时不该只吸 4 个屏幕像素）；
   * 3. 拖动起点取 `dragAnchorRef`（pointerdown 那一刻的位置）—— 吸附是"对着起点算绝对位置"，
   *    拿上一帧的位置累积会漂。
   */
  const snapAt = useCallback(
    (
      ids: string[],
      starts: Map<string, { x: number; y: number }>,
      raw: { dx: number; dy: number },
      zoom: number,
    ) => {
      const graph = store.getSnapshot()
      const byId = new Map(graph.nodes.map((n) => [n.id, n]))
      const moving = ids.flatMap((id) => {
        const start = starts.get(id)
        const node = byId.get(id)
        return start && node
          ? [{ x: start.x + raw.dx, y: start.y + raw.dy, w: node.w, h: node.h }]
          : []
      })
      const dragging = new Set(ids)
      const others = topLevelNodes(graph)
        .filter((n) => !dragging.has(n.id))
        .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
      return computeSnap({ moving, others, threshold: SNAP_THRESHOLD_SCREEN_PX / zoom })
    },
    [store],
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
      if (selectionChanged) {
        store.setSelection([...selected])
        /**
         * 打一个"这一帧刚选过节点"的戳：RF 紧接着还会发一批"选中挂在这些节点上的线"，
         * 而"选线"会把节点选中清掉（见 `onEdgesChange`）⇒ 那批必须丢掉。
         * 戳在微任务里清掉 —— RF 那两个回调是**同一次**同步调用里连着来的。
         */
        nodeSelectStampRef.current = true
        queueMicrotask(() => {
          nodeSelectStampRef.current = false
        })
      }

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
      let dx = first.position.x - base.x
      let dy = first.position.y - base.y

      /**
       * **吸附**（对账 #257）：以"拖动起点 → 现在"这段**原始位移**算该吸到哪，
       * 再把修正量并进这一帧的位移。
       *
       * 没有起点锚时（程序化改位、容器子节点那条路）**不吸也不猜** ——
       * 用户口径本来就是"容器内不做吸附"。
       */
      const anchor = dragAnchorRef.current
      const start = anchor?.nodes.get(first.id)
      if (anchor && start) {
        const snap = snapAt(
          ids,
          anchor.nodes,
          { dx: first.position.x - start.x, dy: first.position.y - start.y },
          anchor.zoom,
        )
        dx += snap.dx
        dy += snap.dy
        store.setSnapHints(snap.guides.length > 0 || snap.gaps.length > 0 ? { guides: snap.guides, gaps: snap.gaps } : null)
      }
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
      store.setDragging(true, ids[0] ?? null)
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

        /**
         * **终点也要吸附一次**：上面那步是"把节点拉回指针处"，它会把拖动中吸好的位置
         * 原样抹掉 —— 用户看到的是"松手瞬间又跳开了"。
         *
         * 所以松手前用**同一份起点锚 + 同一套判定**再吸一次，落到最终位置。
         */
        const snap = snapAt(ids, anchor.nodes, { dx: movedX, dy: movedY }, anchor.zoom)
        if (snap.dx !== 0 || snap.dy !== 0) {
          moved = true
          store.dispatch({ kind: 'node.move', ids, dx: snap.dx, dy: snap.dy, phase: 'move' })
        }
      }
      store.dispatch({ kind: 'node.move', ids, dx: 0, dy: 0, phase: 'end' })
      store.setDragging(false)
      /* 参考线 / 间距徽标只属于"拖动进行中"：松手即撤，不留残影 */
      store.setSnapHints(null)
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
        store.notify(outcome.reason, 'error')
        return
      }
      if (outcome.kind === 'ok') {
        /** `at` 一起带上：进**批量**要吸到格位（分组会忽略它 —— 它保的是世界位置） */
        store.dispatch({
          kind: 'node.reparent',
          id: node.id,
          toParent: outcome.drop.toParent,
          at: outcome.drop.at,
        })
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
   * ★★ **Del / Backspace 统一在这里处理**（用户第 16 批 #6：
   * 「批量节点和分组背景的里面的节点无法按 del 删除键删除」）。
   *
   * 原来这一键交给 React Flow 的 `deleteKeyCode` —— 而它只认 **RF 节点**，
   * 容器（分组 / 批量）里的子节点**不是** RF 节点 ⇒ 选中子节点按 Del 什么都不会发生。
   * 所以改成自己听一次键盘，选区里有什么就删什么：
   * 节点走 `node.delete`（容器会级联处理后代与它的框），选中的连线走 `edge.remove`；
   * RF 那侧的 `deleteKeyCode` 同时关掉，免得同一个键删两遍。
   *
   * 焦点在输入框 / 文本域里时**不接管**（那里 Backspace 是打字，不是删节点）。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      const nodes = store.getSelection()
      const edges = store.getEdgeSelection()
      if (nodes.length === 0 && edges.length === 0) return
      e.preventDefault()
      for (const id of edges) store.dispatch({ kind: 'edge.remove', id })
      if (nodes.length > 0) {
        store.dispatch({ kind: 'node.delete', ids: nodes })
        store.setSelection([])
        store.showUndoBar('已删除节点')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

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
      if (same) return
      /**
       * ★★ **框选捎带上的"连线选中"要丢掉**（用户第 17 批 #1：
       * 「图一上面三个图**有时候**框选多选不了，好像是因为连线的原因」—— 猜对了）。
       *
       * RF 的框选不只选节点：`commitUserSelectionRect` 里还会**把选中节点挂着的线一起选中**
       * 并调 `onEdgesChange`。而我们的 `setEdgeSelection` 契约是「选线 = 取消节点选中」
       *（§6.14 互斥，见 store 里那条）⇒ 后到的这一批把**刚框好的节点整片清掉**，
       * 用户读到的是"框选没反应"。有没有连线决定成不成功 —— 所以症状看着像"跟连线有关"。
       *
       * 判据取"同一帧里刚处理过节点选中"（`nodeSelectStampRef`），而不是"这批全是新增"：
       * 后者会把"点一条线"也误伤（那也是新增，但语义就是"改选线"）。
       * 丢掉这批**不丢任何画面**：连线该有的高亮与删除按钮走 `related`
       *（选中任一端节点即算相关，见 `edges` 那份装配）。
       */
      if (nodeSelectStampRef.current) return
      store.setEdgeSelection(next)
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
      /* 背景样式与色调：CSS 只认这两个属性（见 FlowSurface.module.css 里的六条映射），
         组件里不出现任何色值 —— 主题守卫会拦字面量颜色。 */
      data-canvas-background={canvasStyle.background}
      data-canvas-tone={canvasStyle.tone}
      /* 节点内容字号：挂在**画布根**上，节点自己的 CSS 用 var(..., 兜底) 取。
         兜底值让单测 / SSR 这些"没有画布根"的场景仍然拿得到原来的字号。 */
      style={
        {
          '--node-title-size': `${canvasStyle.titleSize}px`,
          '--node-body-size': `${canvasStyle.bodySize}px`,
        } as CSSProperties
      }
      // 拖入素材：dragover 必须 preventDefault，否则浏览器按「不可放置」处理、根本不派发 drop
      onDragOver={(e) => {
        /*
         * ⚠️ 判据必须是 `types` 而不是 `files`：dragover 阶段浏览器**不给**文件列表
         * （安全限制，`dataTransfer.files` 恒为空）。用 files 判断会让这一支直接 return、
         * 不 preventDefault ⇒ 浏览器认定这里不接收 ⇒ **drop 永远不来**（对账 #551）。
         */
        if (!hasDraggedFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setImportHover(true)
      }}
      onDragLeave={() => setImportHover(false)}
      onDrop={(e) => void onDropFiles(e)}
      data-import-hover={importHover ? 'true' : 'false'}
      data-import-accept={IMPORT_ACCEPT}
      /*
       * 点容器里的子节点：把选中判给**子节点**（见 `onSurfaceClick`）。
       * 必须挂在 surface 上 —— React 的合成事件从内往外派发，容器节点比这层更深、先跑，
       * 所以这里是"最后一个说话的人"，能把 RF 刚选上的容器改回来。
       */
      onClick={onSurfaceClick}
      // 只记坐标、不 setState：粘贴落点要用「当前鼠标位置」（§4.2）
      onPointerMove={(e) => rememberPointer({ x: e.clientX, y: e.clientY })}
      // 按下阶段：清「拖动后不弹面板」标记 + 记拖动起点锚（见 onSurfacePointerDown）
      onPointerDownCapture={onSurfacePointerDown}
      onContextMenu={onContextMenu}
    >
      {/* 拖线草稿（§6.14）：画在节点层**下面**（与老表面 EdgeLayer 同序），层本身不吃指针 */}
      {/*
        分组背景板（第 14 批第 1 条）：**最早渲染 = 最底层** ⇒ 分组底色在连线之下。
        分组节点自己是透明的，见 `FlowGroupBoardLayer` 里的说明。
      */}
      <FlowGroupBoardLayer />
      {/*
        牵涉容器子节点的边（视觉层）：与 RF 自带边同一层序（节点之下），
        命中区在下面单独再画一层（`hitOnly`）。
      */}
      <FlowChildEdgeLayer />
      <FlowDraftLayer draft={edgeDrag.draft} />
      {/* 吸附提示（对账 #257）：参考线 + 间距数字。屏幕空间、不吃指针，拖动结束即消失 */}
      <FlowSnapLayer />
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
        /*
         * 框选「碰到就选中」（用户 2026-10-06 第 13 批第 10 条：「多选功能不需要把节点全部选中，
         * 只需要触碰到就能多选」）。
         *
         * React Flow 默认是 `'full'`：矩形必须**完全包住**节点才算选中 —— 于是"拖一个框划过去"
         * 经常一个都选不上，用户读到的是"框选坏了"（第 3 条报的"两个上游选不上"大概率就是这一条：
         * 包不严 = 没选中，与"有没有下游连线"无关）。
         */
        selectionMode={SelectionMode.Partial}
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
        /**
         * ⚠️ 这一键**不再交给 RF**（`deleteKeyCode={null}`）：RF 只认它自己的节点，
         * 而容器里的子节点不是 RF 节点 ⇒ 选中子节点按 Del 会"什么都不发生"
         *（用户第 16 批 #6）。改成 surface 自己听键盘（见 `onKeyDown` 那段 effect）。
         */
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onEdgesChange={onEdgesChange}
        onEdgeDoubleClick={onEdgeDoubleClick}
        deleteKeyCode={null}
        /*
         * **关掉 React Flow 的署名水印**（用户 2026-10-06 第 13 条：「水印关掉，关掉后记得把小地图改好位置」）。
         *
         * 它默认画在画布右下角（正好在小地图下方），而这一款是**自用工具**、不是对外分发的产品；
         * xyflow 是 MIT 许可、技术上允许移除（官方只是请求保留署名）。写在这里，是为了下一个人
         * 知道"这不是漏了，是刻意关的"——想恢复就把这一行删掉。
         */
        proOptions={{ hideAttribution: true }}
        /*
         * ⚠️ **关掉 React Flow 自带的键盘无障碍**（2026-10-12，对账 #449 实测）。
         *
         * RF 在"有选中节点"时会渲染一个 NodesSelection 框并**自动 focus 它**，那个框的
         * `onKeyDown` 里有它自己的一套"方向键移动选中节点"：速度写死 **5px**
         * （`useMoveSelectedNodes`：`const xVelo = snapToGrid ? snapGrid[0] : 5`），
         * `Shift` 再 **×4 = 20px**，而且**完全不看 Alt / Ctrl**。
         *
         * 后果不是"多点一下"，是**数据被悄悄改**（探针 `.playwright-verify/probe-rf-arrow-move.mjs`
         * 读的是库里持久化的 x/y，不是屏幕坐标 —— 屏幕坐标会被视口平移污染）：
         * - 按一下**普通** `→`（产品口径是"按邻近关系切换选中"，§6.3）：选中换人 **+ 节点 x +5px**；
         * - `Alt + →`（§6.20 微移 1px）：实测 **+6px**（我们的 1px + RF 的 5px）；
         * - `Ctrl + Alt + →`（改尺寸）：宽度确实只 +1，但**位置被顺手挪了 5px**。
         *
         * 为什么现在才关：本项目的键盘模型**一直是自己那一套**（窗口级监听 +
         * 选中集合充当 roving focus + `CanvasNotice` / 页面状态行自己做 aria-live，
         * 见 §4.5 / §6.3 / §6.20），从来没请 RF 管键盘。它那套是**第二份实现**，
         * 少了这一行就会与我们的键位互相叠加（同一个按键触发两件事，且其中一件没人知道）。
         * 关掉它**只去掉竞争**：节点仍可选、可拖、可连线，键盘全部走我们自己的链路。
         */
        disableKeyboardA11y
      >
        {/* 细网格 / 点阵 / 纯色（项目偏好）：纯色档**不渲染背景层** ——
            画一块纯色再用同色网格去盖，等于白画一层。 */}
        {canvasStyle.background === 'solid' ? null : (
          <Background
            variant={canvasStyle.background === 'grid' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            gap={22}
            size={1.4}
            color="var(--canvas-grid-line)"
          />
        )}
      </ReactFlow>
      <Hud count={graph.nodes.length} ids={nodes.map((n) => n.id)} />
      {/* 空画布 + 还没看过新手引导时，给三个模板直达（对账 #388 / E7） */}
      <EmptyCanvasGuide />
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
      {/* 小地图显示开关（本机偏好）：关掉只是少一个导航控件，画布本身不受影响 */}
      {appearance.showMinimap ? <Minimap /> : null}
      {/* 端点命中层：在所有节点之上收拖线手势（见 FlowPortLayer 里的长注释） */}
      <FlowPortLayer onPortDown={beginEdgeDrag} />
      {/* 子节点连线的**命中区**（双击删线）：必须在最上层才收得到指针，视觉是透明的 */}
      <FlowChildEdgeLayer hitOnly />
    </div>
  )
}

function Hud({ count, ids }: { count: number; ids: string[] }) {
  const { x, y, zoom } = useViewport()
  const storeVp = useViewportState()

  /**
   * ⚠️ 这里**只留节点数与缩放**（用户 2026-10-06 第 13 条：「只保留节点和缩放」）。
   *
   * 去掉的两样与它们的去向：
   *  · 「引擎 React Flow（P1）」—— 开发期标签（引擎名 + 阶段），给用户看没有意义；
   *  · 「素材：内置库 / 从文件夹加载 / 导出素材到文件夹」—— 它们是**功能入口**，不是状态读数：
   *    前两个（选文件夹 / 导出）搬去了「全局设置 → 存储」（`useAssetFolderActions`），
   *    「从文件夹加载」留在画布但降级为**空白处右键菜单**里的一项（那是"往当前画布加节点"的动作，
   *    设置浮层里没有 canvas store 可用）。
   */
  return (
    <div
      className={styles.hud}
      data-flow-hud
      data-flow-store-vp={`${Math.round(storeVp.x)},${Math.round(storeVp.y)}@${storeVp.zoom.toFixed(2)}`}
      data-flow-rf-vp={`${Math.round(x)},${Math.round(y)}@${zoom.toFixed(2)}`}
      data-flow-rf-nodes={ids.join(',')}
    >
      <span>节点 {count}</span>
      {/*
       * ⚠️ **不要再挂 `data-canvas-zoom`**：那是 §6.2 定的「小地图附近的缩放读数」，
       * 而小地图自带该锚点。挂两处会让冒烟 `page.locator('[data-canvas-zoom]')`
       * 变成 strict-mode violation（解析到 2 个元素直接抛）—— G46 实测崩过一次。
       * 这里的 `data-flow-zoom` 只给探针读，不冒充产品锚点。
       */}
      <span data-flow-zoom>{Math.round(zoom * 100)}%</span>
    </div>
  )
}
