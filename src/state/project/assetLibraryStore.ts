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
 *  2. **取消收藏是本地先减、关系库后删**。删的只是收藏关系，不碰 `assets`
 *     字节；先减让界面立刻响应，仓储失败时按关系库恢复列表。
 *
 * 列表只来自 `assetLibrary`（用户手动收藏），不再拼接项目名，卡片也不展示来源。
 */
import { createStore as createVanilla } from 'zustand/vanilla'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import {
  filterLibraryAssets,
  sortLibraryAssets,
  type AssetKind,
} from '../../domain/shared/assetLibrary'
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
  loading: boolean
  loaded: boolean
  query: string
  filter: AssetFilter
}

export interface AssetLibraryActions {
  load: () => Promise<void>
  save: (asset: LibraryAsset) => Promise<void>
  setQuery: (query: string) => void
  setFilter: (filter: AssetFilter) => void
  remove: (hash: string) => Promise<void>
}

export type AssetLibraryStore = MiniStore<AssetLibraryState> & AssetLibraryActions

function deriveVisible(assets: LibraryAsset[], query: string, filter: AssetFilter): LibraryAsset[] {
  return filterLibraryAssets(assets, query, filter)
}

export function createAssetLibraryStore(repo: AssetLibraryRepository): AssetLibraryStore {
  const store = createVanillaStore<AssetLibraryState>(() => ({
    assets: [],
    visible: [],
    loading: false,
    loaded: false,
    query: '',
    filter: 'all',
  }))

  const load: AssetLibraryActions['load'] = async () => {
    store.setState({ loading: true })
    const assets = await repo.list()
    const { query, filter } = store.getState()
    store.setState({
      assets,
      visible: deriveVisible(assets, query, filter),
      loading: false,
      loaded: true,
    })
  }

  const setQuery: AssetLibraryActions['setQuery'] = (query) => {
    store.setState((s) => ({ query, visible: deriveVisible(s.assets, query, s.filter) }))
  }

  const setFilter: AssetLibraryActions['setFilter'] = (filter) => {
    store.setState((s) => ({ filter, visible: deriveVisible(s.assets, s.query, filter) }))
  }

  const save: AssetLibraryActions['save'] = async (asset) => {
    await repo.save(asset)
    store.setState((s) => {
      const next = sortLibraryAssets([...s.assets.filter((a) => a.hash !== asset.hash), asset])
      return { assets: next, visible: deriveVisible(next, s.query, s.filter) }
    })
  }

  const remove: AssetLibraryActions['remove'] = async (hash) => {
    const snapshot = store.getState().assets
    // 先减：素材行含几 MB 字节，删掉就是没了，界面不该等库往返
    store.setState((s) => {
      const assets = s.assets.filter((a) => a.hash !== hash)
      return { assets, visible: deriveVisible(assets, s.query, s.filter) }
    })
    try {
      await repo.remove(hash)
    } catch {
      // 失败以库为准恢复：静默留下「看起来删了其实还在」是假动作
      store.setState((s) => ({
        assets: snapshot,
        visible: deriveVisible(snapshot, s.query, s.filter),
      }))
      throw new Error('删除素材失败')
    }
  }

  return { ...store, load, save, setQuery, setFilter, remove }
}
