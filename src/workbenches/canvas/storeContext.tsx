import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { CanvasStore, SnapHints } from '../../state/workbenches/canvas/store'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { Viewport } from '../../domain/canvas/geometry/coords'

/**
 * 画布 store 的 React 绑定。
 * store 本身是 zustand vanilla（框架无关，可在 node 下单测），
 * 这里只通过 useSyncExternalStore 把订阅接进 React，不引入任何业务逻辑。
 *
 * 注意：features 层不能反向依赖 workbenches，因此交互 hook 以 store 实例为参数，
 * 而非通过本 context（见 features/canvas/useNodeDrag.ts）。
 */
const CanvasStoreContext = createContext<CanvasStore | null>(null)

export function CanvasStoreProvider({
  store,
  children,
}: {
  store: CanvasStore
  children: ReactNode
}) {
  return <CanvasStoreContext.Provider value={store}>{children}</CanvasStoreContext.Provider>
}

export function useCanvasStore(): CanvasStore {
  const store = useContext(CanvasStoreContext)
  if (!store) throw new Error('CanvasStoreProvider 未挂载')
  return store
}

/** 只读图快照（nodes / edges / resultGroups）。图变更时整对象换引用，触发重渲。 */
export function useGraph(): GraphSnapshot {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useSelection(): string[] {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getSelection, store.getSelection)
}

/**
 * 正在被拖的那个节点 id（没有在拖就是 null）。
 *
 * 容器（批量 / 分组）的视图用它把"子节点正在被拖"这件事画出来
 * （用户第 15 批 #335-③：「子节点可以点击+拖动出批量节点，但是我看不到拖动」）。
 */
export function useDraggingId(): string | null {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getDraggingId, store.getDraggingId)
}

/** 当前选中的连线 id 列表（§6.14） */
export function useEdgeSelection(): string[] {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getEdgeSelection, store.getEdgeSelection)
}

/** 当前视口值（平移 / 缩放只改这里，不触发节点重渲） */
export function useViewportState(): Viewport {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getViewport, store.getViewport)
}

/**
 * 画布级瞬时提示（§6.12「另一种类型拖入被拒绝并给出弱提示」/ §6.10 对比超 2 张）。
 * 纯展示态：不落库、不进撤销栈。
 */
/**
 * 瞬时提示。类型**从 store 推导**（`ReturnType<CanvasStore['getNotice']>`）而不是手写一份 ——
 * 提示上后来多了 `tone`（§4.5 分档播报），手写的那份就会漂成"少一个字段"。
 */
export function useNotice(): ReturnType<CanvasStore['getNotice']> {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getNotice, store.getNotice)
}

/** 撤销条（§6.12「底部撤销条保留 6 秒」）：删除等可撤销操作后弹出，提供「撤销 / 重做」。 */
export function useUndoBar(): { id: string; text: string } | null {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getUndoBar, store.getUndoBar)
}

/**
 * 拖动吸附的提示（对账 #257）：参考线 + 间距读数。
 * 纯展示态：拖动一结束就被清空（`node.move` 的 `end` 阶段），因此这里不需要做任何缓存。
 */
export function useSnapHints(): SnapHints | null {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getSnapHints, store.getSnapHints)
}
