import { useEffect } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { groupNodes } from '../../features/canvas/groupNodes'
import { isActivationTarget, isTextEntryElement } from '../../features/shared/textTarget'
import { heightFromContentOf, resizeLockOf } from '../../domain/canvas/nodeSpecs/resizeLock'
import {
  KEY_STEP,
  KEY_STEP_FAST,
  keyDelta,
  resizedByKey,
  sameRect,
} from '../../domain/canvas/nodeSpecs/boxKeys'
import {
  firstNodeId,
  lastNodeId,
  nearestInDirection,
  nextNodeId,
  type NavDir,
} from '../../domain/canvas/navigation/spatial'
import { fitCanvasView } from './surface/fitView'
import { minSizeOf } from './nodeMinSize'
import { getSpec } from '../../domain/canvas/nodeSpecs/registry'
import { portDeclOf } from '../../domain/canvas/nodeSpecs/ports'
import { toWorldRectInGraph } from '../../domain/canvas/geometry/coords'

/**
 * 给键盘用户打开「可连接菜单」（对账 #472）：**拖端点连线只有指针一条路**。
 *
 * 实测（`probe-keyboard-connect.mjs`）：键盘能建节点（工具栏菜单 Tab 可达）、
 * 也能选中节点（Tab + 方向键），但到"连接"这一步就断了 —— 端点是 `tabIndex=-1`
 * （不可聚焦）、`Shift+F10` 不开菜单、菜单里也没有"连接"项。
 *
 * 这条函数复用**同一个** `LinkMenu`：候选、落位、连边语义与拖线一字不差
 * （`linkMenuSections` + `wireAll` 是同一份实现）。坐标口径也照旧 ——
 * `setLinkMenu` 收的是 **surface 局部屏幕坐标**，锚点取节点右边缘中部。
 */
function openLinkMenuForKeyboard(store: CanvasStore, nodeId: string): boolean {
  const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
  if (!surface) return false
  const graph = store.getSnapshot()
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return false
  const rect = toWorldRectInGraph(node, graph)
  const vp = store.getViewport()
  const x = (rect.x + rect.w - vp.x) * vp.zoom
  const y = (rect.y - vp.y) * vp.zoom
  /** 多选时把其余节点一并交给菜单（与拖线那条路的 `also` 同义：新建节点要连**整个选区**） */
  const also = store.getSelection().filter((id) => id !== nodeId)
  store.setLinkMenu(x, y, nodeId, 'output', 'output', also, true)
  return true
}

/**
 * `Alt + 方向键` 的两档（§4.5「拖拽替代」/ §6.20）：**拖拽的键盘替代**。
 *
 * - 不按 Ctrl/⌘：把**选中的顶层节点**整体微移（`Shift` 加速 ×10）；
 * - 按住 Ctrl/⌘：改**最后选中的那个**顶层节点的尺寸（一次一步，撤销也是干净的一步）。
 *
 * 为什么只动顶层节点：容器子节点的 x/y 是**局部坐标**、尺寸由容器布局决定
 * （它们连缩放手柄都不渲染）。键盘这条若单独放行，批量网格里就会出现
 * "有一个格子不听网格"的假象 —— 与方向键导航、框选同一条口径（都只认顶层）。
 */
function applyBoxKeys(store: CanvasStore, dir: NavDir, step: number, resize: boolean): void {
  const graph = store.getSnapshot()
  const selection = store.getSelection()
  const topLevelOf = (id: string | undefined) =>
    graph.nodes.find((n) => n.id === id && !n.parentId)

  if (!resize) {
    const ids = selection.filter((id) => topLevelOf(id) !== undefined)
    if (ids.length === 0) return
    const { dx, dy } = keyDelta(dir, step)
    store.dispatch({ kind: 'node.move', ids, dx, dy, phase: 'end' })
    return
  }

  const node = topLevelOf(selection[selection.length - 1])
  if (!node) return
  const children = graph.nodes.filter((n) => n.parentId === node.id)
  /* 下限 / 比例锁 / 等比基准与 `FlowNode` 喂给缩放手柄的是同一份（见 `minSizeOf`） */
  const minSize = minSizeOf(node, children)
  const rect = resizedByKey({ x: node.x, y: node.y, w: node.w, h: node.h }, dir, step, {
    minSize,
    resizeLock: resizeLockOf(node),
    lockAspect: node.type === 'batch' ? minSize : undefined,
    heightFromContent: heightFromContentOf(node),
    liveHeight: node.h,
  })
  /* 已经到边界（最小尺寸 / 高度归内容 / 批量网格比例）：**不派发空命令** ——
     否则撤销栈里会攒下"按了十下方向键、要按十下 Ctrl+Z 才退回去"的空操作 */
  if (sameRect(rect, { x: node.x, y: node.y, w: node.w, h: node.h })) return
  store.dispatch({ kind: 'node.resize', id: node.id, rect, phase: 'end' })
}

/**
 * 画布级快捷键。
 *
 * **这是唯一一份**：P5 收口已把老画布与其重复实现一起删掉（见方案 §8.11），
 * 画布只要一套键位。
 *
 * 这些键原先只长老画布那层，于是换到 RF 面之后整层都不见了 ——
 * 而它们**不是装饰**：`Z` 复位视图、`Ctrl+Z` 撤销、Tab / 方向键在节点间移动焦点。
 * 症状很有欺骗性：G12 的「视图复位后连线回原位」红了，根因却是它上面那条"平移"
 * 没被复位回来，于是后面点工具栏「撤销」时那颗按钮正好被创作面板盖住 —— 报错信息
 * 指向面板，与快捷键毫无字面关系。
 *
 * 管这些键：
 * - `Ctrl/Cmd + G`：把选中的节点打成一组（与多选功能栏共用 `groupNodes`，一次事务）
 * - `Z` / `Shift+Z` / `Ctrl+Z` / `Ctrl+Shift+Z`：复位视图 / 重做 / 撤销 / 重做
 * - `Tab` / `方向键` / `Home` / `End`：节点间键盘导航（空间最近邻）
 * - `Alt + 方向键`：把选中的顶层节点微移 1px（`Shift` ×10）
 * - `Ctrl/⌘ + Alt + 方向键`：改最后选中那个顶层节点的尺寸（同上加速档；见 `applyBoxKeys`）
 *
 * **刻意不在这里管**（各表面自己拥有，理由见各自的调用点）：
 * - `Delete` / `Backspace`：老表面手写、RF 面走 `deleteKeyCode` 自带的删除通道；
 * - 空格平移 / 滚轮缩放：RF 面由 React Flow 自带的 `panActivationKeyCode` / `zoomOnScroll`
 *   承担，老表面是自己实现的 —— 两边语义一致（§6.3），没必要为"统一"再包一层。
 *
 * 文本框 / 激活类控件内一律让位（无障碍 §4.5）：组内不抢浏览器自己的撤销、Tab 与空格。
 */
export function useCanvasKeyboard(store: CanvasStore): void {
  // —— Ctrl / Cmd + G：把选中的节点打成一组 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'g' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (isTextEntryElement(e.target as { tagName?: string } | null)) return
      const sel = store.getSelection()
      if (sel.length === 0) return
      e.preventDefault()
      if (groupNodes(store, sel)) store.showUndoBar('已打组')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  // —— 撤销 / 重做 / 视图复位 / Tab 空间导航 / 方向键切换 / Home End（§6.20） ——
  useEffect(() => {
    const topLevelNavNodes = () => {
      const g = store.getSnapshot()
      return g.nodes
        .filter((n) => !n.parentId)
        .map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, w: n.w, h: n.h } }))
    }
    /** 小地图有自己的一套导航（方向键平移 / Home 复位），焦点在它里面时这里整体让位 */
    const inMinimap = (target: EventTarget | null) =>
      target instanceof Element && target.closest('[data-canvas-minimap]') !== null
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      const inText = isTextEntryElement(target)

      // —— 撤销 / 重做 / 复位视图 ——
      // 文本输入元素内不拦截 Ctrl/Cmd+Z，让浏览器处理本地文本撤销
      if (e.code === 'KeyZ') {
        if (inText) return
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          if (e.shiftKey) store.redo()
          else store.undo()
        } else if (e.shiftKey) {
          store.redo()
        } else {
          // 单独 Z = 复位视图（§6.20）：缩放到全部节点可见（§6.3）
          fitCanvasView(store)
        }
        return
      }

      // —— 文本框 / 激活类控件（按钮等）内不接管 Tab，保留原生焦点移动（无障碍 §4.5） ——
      if (inMinimap(e.target)) return
      /**
       * —— `L` = 给**选中的节点**开「连接」菜单（对账 #472）——
       *
       * 这是"拉端点连线"的键盘替代操作（WCAG 2.2 AA 那条「所有拖拽提供可见替代操作」）：
       * 复用同一个 `LinkMenu`，所以候选节点、新建并连接的落位、连边语义与拖线完全一致。
       * 没有输出端点的节点（或压根没选中）静默不动 —— 与其它画布快捷键同一条口径。
       */
      if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inText || isActivationTarget(target)) return
        const graph = store.getSnapshot()
        const node = graph.nodes.find((n) => n.id === store.getSelection()[0])
        if (!node) return
        const ports = getSpec(node.type)?.ports ?? { input: false, output: false }
        if (!portDeclOf(ports, 'output')) return
        if (!openLinkMenuForKeyboard(store, node.id)) return
        e.preventDefault()
        return
      }
      if (e.key === 'Tab') {
        if (inText || isActivationTarget(target)) return
        const nodes = topLevelNavNodes()
        if (nodes.length === 0) return
        e.preventDefault()
        const sel = store.getSelection()
        const next = nextNodeId(nodes, sel.length ? sel[sel.length - 1] : null)
        if (next) store.setSelection([next])
        return
      }

      const dirMap: Record<string, NavDir> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      if (e.key in dirMap) {
        if (inText || isActivationTarget(target)) return
        const dir = dirMap[e.key]
        /**
         * `Alt + 方向键` 微移 / `Ctrl(⌘) + Alt + 方向键` 改尺寸 —— 必须在普通方向键
         * **之前**分支：普通方向键已被 §6.3「按邻近关系切换选中」占用，而移动 / 改尺寸
         * 是**编辑**，编辑这一档只认 `Alt`。
         *
         * ⚠️ **这一档一律 `preventDefault`**：Chromium 把 `Alt + ←/→` 当**后退 / 前进**，
         * 不吞就会把整个应用导航走（症状是"按一下画布没了"，而且不报任何错）。
         * 正因为要吞的是浏览器行为，没选中节点时也吞。
         */
        if (e.altKey) {
          e.preventDefault()
          applyBoxKeys(store, dir, e.shiftKey ? KEY_STEP_FAST : KEY_STEP, e.ctrlKey || e.metaKey)
          return
        }
        const nodes = topLevelNavNodes()
        const sel = store.getSelection()
        // 尚无选中：方向键进入画布选中首个节点（与 Tab 一致）
        if (sel.length === 0) {
          const first = firstNodeId(nodes)
          if (first) {
            e.preventDefault()
            store.setSelection([first])
          }
          return
        }
        e.preventDefault()
        const next = nearestInDirection(nodes, sel[sel.length - 1], dir)
        if (next) store.setSelection([next])
        return
      }

      if (e.key === 'Home' || e.key === 'End') {
        if (inText || isActivationTarget(target)) return
        const nodes = topLevelNavNodes()
        const id = e.key === 'Home' ? firstNodeId(nodes) : lastNodeId(nodes)
        if (id) {
          e.preventDefault()
          store.setSelection([id])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
