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
  normalizeTags,
  sameTag,
  sortLibraryAssets,
  tagCounts,
  type TagCount,
} from '../../domain/shared/assetLibrary'
import {
  countAssets,
  filterHistory,
  groupHistory,
  modelCounts,
  type GroupMode,
  type HistoryCounts,
  type HistoryGroup,
  type HistoryItem,
  type HistoryKind,
  type QuickFilter,
} from '../../domain/shared/assetHistory'
import type { AssetLibraryRepository } from './assetLibraryRepository'
import type { AssetHistoryRepository } from './assetHistoryRepository'

/** 与 listStore 同源：绕开 zustand 5 与 TS 6 的泛型推断冲突 */
type MiniStore<T> = {
  getState: () => T
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}
type StoreFactory = <T>(init: () => T) => MiniStore<T>
const createVanillaStore = createVanilla as unknown as StoreFactory

/**
 * 页面上那一排类型档（参考图五：全部 / 图 / 视频 / 音频）。
 *
 * 与历史共用一份 `HistoryKind` —— 素材库里不会有音频（保存链路只收图 / 视频），
 * 选中「音频」时素材库自然为空，不需要为它单开一个类型。
 */
export type AssetFilter = HistoryKind

/** 页签（用户 2026-10-06 第 8 条：「下面分全部历史 / 素材库」） */
export type AssetsTab = 'history' | 'library'

/** 瀑布流 / 网格 / 列表（参考图五右上角那个切换） */
export type AssetsView = 'masonry' | 'grid' | 'list'

export interface AssetLibraryState {
  assets: LibraryAsset[]
  visible: LibraryAsset[]
  /** 全部生成历史（含未收藏与失败）—— 与素材库共用同一套筛选条件 */
  history: HistoryItem[]
  historyVisible: HistoryItem[]
  /** 分组视图（日期 / 模型 / 不分组） */
  groups: HistoryGroup[]
  /** 顶部那排数字与左侧"快速筛选"的计数（对全量算） */
  counts: HistoryCounts
  /** 左侧"模型生成分组" */
  models: { model: string; count: number }[]
  /**
   * 素材库里出现过的**标签 + 计数**（左侧「标签」那一栏读它，对账 #303）。
   * 只数收藏库（历史条目没收藏就没有标签），对全量算 —— 与其它计数同一条口径。
   */
  tags: TagCount[]
  loading: boolean
  loaded: boolean
  query: string
  filter: AssetFilter
  tab: AssetsTab
  quick: QuickFilter
  /** 点中左侧模型分组的那一档；`null` = 不限 */
  model: string | null
  /** 点中左侧标签那一档；`null` = 不限 */
  tag: string | null
  group: GroupMode
  view: AssetsView
  /**
   * 这一次加载的"现在"。
   *
   * 日期分组标题（今天 / 昨天）与"最近 7 天"都要一个时间基准 —— 每次渲染现取
   * `Date.now()` 会让同一屏里的分组标题在跨零点时互相打架，也让单测没法钉。
   */
  now: number
}

export interface AssetLibraryActions {
  load: () => Promise<void>
  save: (asset: LibraryAsset) => Promise<void>
  setQuery: (query: string) => void
  setFilter: (filter: AssetFilter) => void
  setTab: (tab: AssetsTab) => void
  setQuick: (quick: QuickFilter) => void
  setModelFilter: (model: string | null) => void
  /** 点标签（再点一次同一个 = 取消，由调用方传 null） */
  setTag: (tag: string | null) => void
  /** 给一条**已收藏**的素材写标签（对账 #303）：落库 + 两张列表同步 */
  setTags: (hash: string, tags: readonly string[]) => Promise<void>
  setGroup: (group: GroupMode) => void
  setView: (view: AssetsView) => void
  remove: (hash: string) => Promise<void>
}

export type AssetLibraryStore = MiniStore<AssetLibraryState> & AssetLibraryActions

type Derived = Pick<
  AssetLibraryState,
  'visible' | 'historyVisible' | 'groups' | 'counts' | 'models' | 'tags'
>

/**
 * 一份状态 → 全部派生值（**只有这一处**算派生）。
 *
 * 散着算的话，"改了筛选忘了重算分组"这类 bug 会一次只错一半（列表变了、计数没变），
 * 而界面上那半错最难被认出来。所有 setter 都走它。
 */
function derive(state: AssetLibraryState): Derived {
  const historyVisible = filterHistory(state.history, {
    query: state.query,
    kind: state.filter,
    quick: state.quick,
    model: state.model,
    tag: state.tag,
    now: state.now,
  })
  return {
    /** 素材库的过滤只认图 / 视频两类，故「音频」落到 `other`（库里本来就没有这类行） */
    visible: filterLibraryAssets(
      state.assets,
      state.query,
      state.filter === 'audio' ? 'other' : state.filter,
      state.tag,
    ),
    historyVisible,
    groups: groupHistory(historyVisible, state.group, state.now),
    /*
     * ⚠️ **整个库的全量**（生成历史 ∪ 素材库、按 hash 去重），不是只数生成历史 ——
     * 用户 2026-10-06 第 11 批第 5 条：素材库里有图、但生成历史为空时，
     * 那些数字**全成了 0**（"明明有图，但是有些数字还是 0"）。
     * 口径由用户拍定：「生成历史没用收藏的算全部素材，整个库的全量」⇒ 见 `countAssets`。
     */
    counts: countAssets(state.history, state.assets, state.now),
    models: modelCounts(state.history),
    tags: tagCounts(tagRowsOf(state)),
  }
}

/** 同一 hash 在素材库与历史里各有一行，标签计数只能按 hash 去重一次。 */
function tagRowsOf(state: Pick<AssetLibraryState, 'assets' | 'history'>): { tags?: string[] }[] {
  const rows = new Map<string, { tags?: string[] }>()
  for (const asset of state.assets) rows.set(asset.hash, asset)
  for (const item of state.history) {
    if (item.kind !== 'output') continue
    const prev = rows.get(item.hash)
    if (prev?.tags?.length) continue
    rows.set(item.hash, item)
  }
  return [...rows.values()]
}

/**
 * 素材页 store：**收藏库 + 全部生成历史**两张列表共用一套筛选。
 *
 * 第二个仓储（历史）是可选的：老调用点（AgentPanel 保存素材）只关心收藏，
 * 传空就不读那四张表 —— 但**页面一定要传**，否则历史页签永远是空的。
 */
export function createAssetLibraryStore(
  repo: AssetLibraryRepository,
  historyRepo?: AssetHistoryRepository,
): AssetLibraryStore {
  const store = createVanillaStore<AssetLibraryState>(() => ({
    assets: [],
    visible: [],
    history: [],
    historyVisible: [],
    groups: [],
    counts: { all: 0, image: 0, video: 0, audio: 0, saved: 0, recent: 0, failed: 0 },
    models: [],
    tags: [],
    loading: false,
    loaded: false,
    query: '',
    filter: 'all',
    tab: 'history',
    quick: 'all',
    model: null,
    tag: null,
    group: 'date',
    view: 'masonry',
    now: Date.now(),
  }))

  const load: AssetLibraryActions['load'] = async () => {
    store.setState({ loading: true })
    const [assets, rawHistory, tagMap] = await Promise.all([
      repo.list(),
      historyRepo ? historyRepo.list() : Promise.resolve<HistoryItem[]>([]),
      repo.listTagMap(),
    ])
    /**
     * 历史条目的标签是**按 hash 从收藏库拼过来的镜像**（对账 #303）：
     * 标签只有一份真相在 `assetLibrary` 行上，历史那边不另存一份 ——
     * 两份就会分叉（改了标签，历史卡片还挂着旧的）。
     */
    const history = rawHistory.map((item) =>
      item.kind === 'output'
        ? { ...item, tags: normalizeTags(tagMap.get(item.hash)) }
        : item,
    )
    /** 时间基准取**这一次加载**那一瞬：与派生值用同一个数，跨零点也不会自相矛盾 */
    const now = Date.now()
    store.setState({
      assets,
      history,
      now,
      loading: false,
      loaded: true,
      ...derive({ ...store.getState(), assets, history, now }),
    })
  }

  const setQuery: AssetLibraryActions['setQuery'] = (query) => {
    store.setState((s) => ({ query, ...derive({ ...s, query }) }))
  }

  const setFilter: AssetLibraryActions['setFilter'] = (filter) => {
    store.setState((s) => ({ filter, ...derive({ ...s, filter }) }))
  }

  const setTab: AssetLibraryActions['setTab'] = (tab) => {
    store.setState({ tab })
  }

  const setQuick: AssetLibraryActions['setQuick'] = (quick) => {
    store.setState((s) => ({ quick, ...derive({ ...s, quick }) }))
  }

  const setModelFilter: AssetLibraryActions['setModelFilter'] = (model) => {
    store.setState((s) => ({ model, ...derive({ ...s, model }) }))
  }

  const setTag: AssetLibraryActions['setTag'] = (tag) => {
    store.setState((s) => ({ tag, ...derive({ ...s, tag }) }))
  }

  const setTags: AssetLibraryActions['setTags'] = async (hash, tags) => {
    const next = normalizeTags(tags)
    await repo.setTags(hash, next)
    store.setState((s) => {
      const assets = s.assets.map((a) => {
        if (a.hash !== hash) return a
        const patched = { ...a }
        /* 全删光时**把字段去掉**（"没有标签"与"标签是空数组"在库里是同一件事） */
        if (next.length > 0) patched.tags = next
        else delete patched.tags
        return patched
      })
      /* 历史那张卡片跟着变（同一份标签，两处显示——不留旧值） */
      const history = s.history.map((item) =>
        item.kind === 'output' && item.hash === hash ? { ...item, tags: next } : item,
      )
      /**
       * 当前选中的标签**可能刚被删掉**（用户把筛选栏里那一档删空了）：
       * 那就把筛选清掉，否则列表会永远空着、而左侧那一栏又找不到它可以取消。
       */
      const tag = s.tag && !next.some((t) => sameTag(t, s.tag as string)) ? null : s.tag
      return { assets, history, tag, ...derive({ ...s, assets, history, tag }) }
    })
  }

  const setGroup: AssetLibraryActions['setGroup'] = (group) => {
    store.setState((s) => ({ group, ...derive({ ...s, group }) }))
  }

  const setView: AssetLibraryActions['setView'] = (view) => {
    store.setState({ view })
  }

  const save: AssetLibraryActions['save'] = async (asset) => {
    await repo.save(asset)
    if (asset.tags) await repo.setTags(asset.hash, asset.tags)
    store.setState((s) => {
      const next = sortLibraryAssets([...s.assets.filter((a) => a.hash !== asset.hash), asset])
      /**
       * 收藏状态**同时**反映到历史上（那张卡片的星标要立刻点亮）：
       * 不去重读四张表（收藏这一下只改关系表），只在内存里把 `saved` 置上。
       */
      const history = s.history.map((item) =>
        item.kind === 'output' && item.hash === asset.hash
          ? { ...item, saved: true, tags: asset.tags ?? [] }
          : item,
      )
      return { assets: next, history, ...derive({ ...s, assets: next, history }) }
    })
  }

  const remove: AssetLibraryActions['remove'] = async (hash) => {
    const snapshot = store.getState().assets
    // 先减：素材行含几 MB 字节，删掉就是没了，界面不该等库往返
    store.setState((s) => {
      const assets = s.assets.filter((a) => a.hash !== hash)
      const history = s.history.map((item) =>
        /* 取消收藏只改收藏关系；标签是独立整理，不跟着删。 */
        item.kind === 'output' && item.hash === hash ? { ...item, saved: false } : item,
      )
      return { assets, history, ...derive({ ...s, assets, history }) }
    })
    try {
      await repo.remove(hash)
    } catch {
      // 失败以库为准恢复：静默留下「看起来删了其实还在」是假动作
      store.setState((s) => ({
        assets: snapshot,
        history: s.history,
        ...derive({ ...s, assets: snapshot }),
      }))
      throw new Error('删除素材失败')
    }
  }

  return {
    ...store,
    load,
    save,
    setQuery,
    setFilter,
    setTab,
    setQuick,
    setModelFilter,
    setTag,
    setTags,
    setGroup,
    setView,
    remove,
  }
}
