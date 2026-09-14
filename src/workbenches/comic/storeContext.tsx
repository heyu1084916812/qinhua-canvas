import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { ComicStore } from '../../state/workbenches/comic/store'
import type { ComicProject } from '../../domain/comic/model/comicProject'

/**
 * comic 工作台 store 的 React 绑定（与 canvas 同构，但不共用——架构 §5.10
 * 跨工作台代码互引禁止，两侧 storeContext 各自独立）。
 *
 * store 本身是 zustand vanilla（可在 node 下单测），
 * 这里只通过 useSyncExternalStore 把订阅接进 React，不引入业务逻辑。
 */
const ComicStoreContext = createContext<ComicStore | null>(null)

export function ComicStoreProvider({
  store,
  children,
}: {
  store: ComicStore
  children: ReactNode
}) {
  return <ComicStoreContext.Provider value={store}>{children}</ComicStoreContext.Provider>
}

export function useComicStore(): ComicStore {
  const store = useContext(ComicStoreContext)
  if (!store) throw new Error('ComicStoreProvider 未挂载')
  return store
}

/** 漫画剧数据快照（project 变更时整对象换引用，触发重渲） */
export function useComicProject(): ComicProject {
  const store = useComicStore()
  return useSyncExternalStore(store.subscribe, store.getProject, store.getProject)
}
