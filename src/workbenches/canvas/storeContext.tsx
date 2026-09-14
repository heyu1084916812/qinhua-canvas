import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
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
export function useNotice(): { id: string; text: string } | null {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getNotice, store.getNotice)
}

/** 撤销条（§6.12「底部撤销条保留 6 秒」）：删除等可撤销操作后弹出，提供「撤销 / 重做」。 */
export function useUndoBar(): { id: string; text: string } | null {
  const store = useCanvasStore()
  return useSyncExternalStore(store.subscribe, store.getUndoBar, store.getUndoBar)
}
