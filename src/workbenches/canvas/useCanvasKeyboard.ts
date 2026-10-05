import { useEffect } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { groupNodes } from '../../features/canvas/groupNodes'
import { isActivationTarget, isTextEntryElement } from '../../features/shared/textTarget'
import {
  firstNodeId,
  lastNodeId,
  nearestInDirection,
  nextNodeId,
  type NavDir,
} from '../../domain/canvas/navigation/spatial'
import { fitCanvasView } from './surface/fitView'

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
        const next = nearestInDirection(nodes, sel[sel.length - 1], dirMap[e.key])
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
