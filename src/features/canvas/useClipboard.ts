import { useEffect } from 'react'
import type { Point } from '../../domain/canvas/geometry/rect'
import type { ClipboardPayload } from '../../domain/canvas/clipboard'
import { clipboardFromSelection, pasteEdges, pasteNodes } from '../../domain/canvas/clipboard'
import { screenToWorld } from '../../domain/canvas/geometry/coords'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { createId } from '../../shared/id'
import { isTextEntryElement } from '../shared/textTarget'

/**
 * 画布剪贴板的**持有者与执行入口**（产品文档 §4.2「复制与粘贴」）。
 *
 * 分工：
 * - `domain/canvas/clipboard.ts` 是纯函数——怎么拍快照、怎么算落点；
 * - 本模块负责「快照存在哪」与「按键 / 菜单项来了怎么走」——因此它认识 store 与 DOM。
 *
 * 为什么是**模块级单例**而不是塞进 store：
 * 1. 剪贴板必须活过原件的删除（这是它存在的理由），也得活过项目切换——
 *    store 是「一个项目一份」的，跟着它走会让「从 A 项目复制、到 B 项目粘贴」失效；
 * 2. 它是**瞬时态**：不进撤销栈、不落库，与 store 里那些要持久化的图数据不是一类东西。
 */

let payload: ClipboardPayload | null = null

/**
 * 最近一次指针的**屏幕坐标**。
 *
 * 存屏幕而不是世界：从「看到指针」到「按下 Ctrl+V」之间用户可能缩放 / 平移过，
 * 世界坐标会过期；屏幕坐标在粘贴那一刻才换算，永远对得上眼睛看到的位置。
 */
let pointerClient: Point | null = null

export function writeClipboard(next: ClipboardPayload): void {
  payload = next
}

export function readClipboard(): ClipboardPayload | null {
  return payload
}

export function hasClipboard(): boolean {
  return payload !== null
}

export function clearClipboard(): void {
  payload = null
}

/** 由画布表面（`FlowSurface`）的指针移动持续喂入；供「落位在当前鼠标位置」使用 */
export function rememberPointer(client: Point): void {
  pointerClient = client
}

/** 测试用：抹掉指针记忆，避免用例之间互相污染 */
export function forgetPointer(): void {
  pointerClient = null
}

/**
 * 粘贴落点的世界坐标。
 *
 * 没动过鼠标（纯键盘流程：Tab 选中 → Ctrl+C → Ctrl+V）时退回**可视区中心**——
 * 比粘到画布原点外（用户当前视野之外，看起来像「没反应」）合理得多。
 */
export function pastePoint(store: CanvasStore): Point | null {
  const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const client = pointerClient ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  return screenToWorld(client, store.getViewport(), { x: r.left, y: r.top, w: r.width, h: r.height })
}

/** 复制当前选中；返回被拍进剪贴板的节点数（0 = 没选中任何东西，剪贴板保持不变） */
export function copySelection(store: CanvasStore): number {
  const next = clipboardFromSelection(store.getSnapshot(), store.getSelection())
  if (!next) return 0
  payload = next
  return next.nodes.length
}

/**
 * 粘贴剪贴板内容。
 *
 * 新 id 在这里现造（`node.create` / `node.duplicate` 同款约定：reducer 保持纯函数，
 * 不在里面调 `Date.now()` / 随机数）。返回新节点的**顶层** id，供调用方选中——
 * 粘出来却没选中，用户会以为没粘上，下一步的「拖动到别处 / 删除」也就无从下手。
 */
export function pasteClipboard(store: CanvasStore, at?: Point): string[] {
  const current = payload
  if (!current) return []
  const point = at ?? pastePoint(store)
  if (!point) return []

  const newIds = current.nodes.map(() => createId('node'))
  const nodes = pasteNodes(current, point, newIds)
  const edges = pasteEdges(current, newIds)
  store.dispatch({ kind: 'node.paste', nodes, edges })
  const roots = nodes.filter((n) => n.parentId === null).map((n) => n.id)
  store.setSelection(roots)
  return roots
}

/**
 * `Ctrl/Cmd + C` / `V`（§4.2 / §6.20）。
 *
 * 两条纪律（与 RunHotkeys 同口径）：
 * - **文本框内一律放行**：节点正文常驻 textarea，用户在里面按 Ctrl+C 是要复制自己写的字，
 *   不是要复制节点；`isTextEntryElement` 也覆盖了 contentEditable；
 * - **剪贴板空时不 preventDefault**：空操作不该吞掉浏览器原生行为。
 */
export function useClipboardHotkeys(store: CanvasStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (isTextEntryElement(e.target as { tagName?: string; isContentEditable?: boolean } | null)) {
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'c') {
        if (copySelection(store) === 0) return
        e.preventDefault()
      } else if (key === 'v') {
        if (!hasClipboard()) return
        e.preventDefault()
        pasteClipboard(store)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
