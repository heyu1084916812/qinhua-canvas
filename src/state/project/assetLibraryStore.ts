/**
 * 素材库列表 store（架构 §5.10，zustand vanilla，框架无关，可 node 单测）。
 *
 * 与 `listStore`（项目）同一套形状：原始列表 + 派生 `visible` + 加载态，
 * 页面用 `useSyncExternalStore` 订阅，不把查询逻辑写进 React 组件。
 *
 * 两条刻意的差异：
 *  1. **筛选多一维「类型」**（图片 / 视频 / 全部）。项目列表只有关键字 + 排序，
 *     而素材库里「只看视频」是最常见的动作 —— 视频卡片与图片卡片长得一样，
 *     混在一起翻找很痛苦。
 *  2. **删除是本地先减、库后删**。素材行里就是几 MB 字节，删掉之后
 *     没有第二次列表刷新能把它变回来；先减能让界面立刻响应，
 *     而仓储删失败时会把列表重新读回（不一致以库为准）。
 */
import { createStore as createVanilla } from 'zustand/vanilla'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { filterLibraryAssets, type AssetKind } from '../../domain/shared/assetLibrary'
import type { AssetLibraryRepository } from './assetLibraryRepository'

/** 与 listStore 同源：绕开 zustand 5 与 TS 6 的泛型推断冲突 */
type MiniStore<T> = {
  getState: () => T
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}
type StoreFactory = <T>(init: () => T) => MiniStore<T>
const createVanillaStore = createVanilla as unknown as StoreFactory

export type AssetFilter = AssetKind | 'all'

export interface AssetLibraryState {
  assets: LibraryAsset[]
  visible: LibraryAsset[]
  /** 项目 id → 名称（卡片上的「来自 X」） */
  projectNames: Map<string, string>
  loading: boolean
  loaded: boolean
  query: string
  filter: AssetFilter
}

export interface AssetLibraryActions {
  load: () => Promise<void>
  setQuery: (query: string) => void
  setFilter: (filter: AssetFilter) => void
  remove: (hash: string) => Promise<void>
}

export type AssetLibraryStore = MiniStore<AssetLibraryState> & AssetLibraryActions

/** 未知来源项目的显示名（不是「未命名项目」——那是库里真有的一个名字） */
const UNKNOWN_PROJECT = '—'

function deriveVisible(
  assets: LibraryAsset[],
  query: string,
  filter: AssetFilter,
  projectNames: Map<string, string>,
): LibraryAsset[] {
  return filterLibraryAssets(
    assets,
    query,
    filter,
    (id) => (id ? projectNames.get(id) ?? UNKNOWN_PROJECT : UNKNOWN_PROJECT),
  )
}

export function createAssetLibraryStore(repo: AssetLibraryRepository): AssetLibraryStore {
  const store = createVanillaStore<AssetLibraryState>(() => ({
    assets: [],
    visible: [],
    projectNames: new Map(),
    loading: false,
    loaded: false,
    query: '',
    filter: 'all',
  }))

  const load: AssetLibraryActions['load'] = async () => {
    store.setState({ loading: true })
    const [assets, projectNames] = await Promise.all([repo.list(), repo.projectNames()])
    const { query, filter } = store.getState()
    store.setState({
      assets,
      projectNames,
      visible: deriveVisible(assets, query, filter, projectNames),
      loading: false,
      loaded: true,
    })
  }

  const setQuery: AssetLibraryActions['setQuery'] = (query) => {
    store.setState((s) => ({ query, visible: deriveVisible(s.assets, query, s.filter, s.projectNames) }))
  }

  const setFilter: AssetLibraryActions['setFilter'] = (filter) => {
    store.setState((s) => ({ filter, visible: deriveVisible(s.assets, s.query, filter, s.projectNames) }))
  }

  const remove: AssetLibraryActions['remove'] = async (hash) => {
    const snapshot = store.getState().assets
    // 先减：素材行含几 MB 字节，删掉就是没了，界面不该等库往返
    store.setState((s) => {
      const assets = s.assets.filter((a) => a.hash !== hash)
      return { assets, visible: deriveVisible(assets, s.query, s.filter, s.projectNames) }
    })
    try {
      await repo.remove(hash)
    } catch {
      // 失败以库为准恢复：静默留下「看起来删了其实还在」是假动作
      store.setState((s) => ({
        assets: snapshot,
        visible: deriveVisible(snapshot, s.query, s.filter, s.projectNames),
      }))
      throw new Error('删除素材失败')
    }
  }

  return { ...store, load, setQuery, setFilter, remove }
}
