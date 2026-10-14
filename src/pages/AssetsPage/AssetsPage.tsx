import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { toLogicalName } from '../../domain/project/modelCatalog'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import type { GroupMode, HistoryOutput, QuickFilter } from '../../domain/shared/assetHistory'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { noticeA11y, type NoticeTone } from '../../domain/ui/notice'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import { createAssetHistoryRepository } from '../../state/project/assetHistoryRepository'
import { createAssetLibraryStore } from '../../state/project/assetLibraryStore'
import type { AssetsView } from '../../state/project/assetLibraryStore'
import { AssetCard } from './AssetCard'
import { AssetPreview } from './AssetPreview'
import { MasonryGrid } from './MasonryGrid'
import styles from './AssetsPage.module.css'

/** 左侧"快速筛选"（参考图那一栏：全部素材 / 收藏内容 / 最近 7 天 / 生成失败） */
const QUICK_FILTERS: readonly { id: QuickFilter; label: string }[] = [
  { id: 'all', label: '全部素材' },
  { id: 'saved', label: '收藏内容' },
  { id: 'recent', label: '最近 7 天' },
  { id: 'failed', label: '生成失败' },
]

/**
 * 分组方式（参考图右上角的"日期分组"）。
 *
 * 用户 2026-10-14：「分组方式砍成两档」—— 原来的「模型分组」与左侧那栏
 * 「模型生成分组」是同一个入口的两种形态，同时摆着只让人多想一步。
 */
const GROUP_MODES: readonly { id: GroupMode; label: string }[] = [
  { id: 'date', label: '日期分组' },
  { id: 'none', label: '不分组' },
]

/**
 * 网格 / 列表两种容器。
 *
 * 网格走 `MasonryGrid`（最短列堆砌，对账 #502）；列表仍是单列 DOM。
 * 抽出来是为了让历史列表与素材库两处共用同一条选择，
 * 不在 JSX 里各写一次三目 —— 以后再加视图形态只改这一处。
 */
function CardsLayout({ view, children }: { view: AssetsView; children: ReactNode }) {
  if (view === 'grid') return <MasonryGrid>{children}</MasonryGrid>
  return (
    <div className={styles.list} data-assets-grid>
      {children}
    </div>
  )
}

/**
 * 我的素材（`/assets`）。
 *
 * 用户 2026-10-06 第 8 条 + 同日答复定下的结构（参考图五）：
 * - **两个页签**：全部历史（含未收藏、含生成失败）/ 素材库（用户收藏过的）；
 * - **左侧**：快速筛选（全部 / 收藏 / 最近 7 天 / 生成失败）+ 模型生成分组（那一栏会**同时**当筛选器用）；
 * - **顶部**：搜索 + 类型档（带数量）+ 分组方式 + 网格 / 列表切换；
 * - 大标题仍是**「我的素材」**（用户明确保留，不跟着参考图改叫"素材管理"）。
 *
 * 数据来源仍是两张表：`assetLibrary` 是"用户点头留下的"，`runRecords` 是"跑过的全部"
 *（历史里也列**没收藏的**与**失败的** —— 那才是"全部历史"四个字的意思）。
 */
export function AssetsPage() {
  const platform = usePlatform()
  /**
   * 渠道列表：左侧「模型生成分组」要把**上游 ID 归一成前端显示名**
   * （用户 2026-10-14：「模型生成分组的哪里，我需要显示前端模型，而不是后端的模型 id」）。
   *
   * 用 `toLogicalName` 而不是固定清单的 `presetIdForUpstream`：只有**用户自己的
   * `modelMap`**（例如 `GPT Image 2.5 Sunburst → gpt-image-2.5`）才知道这串 ID 是谁。
   * 认不出来就原样显示，不编造一个名字。
   */
  const channelStore = useChannels()
  const allChannels = useSyncExternalStore(
    channelStore.subscribe,
    channelStore.getState,
    channelStore.getState,
  ).channels

  const repoRef = useRef<ReturnType<typeof createAssetLibraryRepository> | null>(null)
  if (!repoRef.current) repoRef.current = createAssetLibraryRepository(platform.storage)
  const historyRepoRef = useRef<ReturnType<typeof createAssetHistoryRepository> | null>(null)
  if (!historyRepoRef.current) historyRepoRef.current = createAssetHistoryRepository(platform.storage)
  const storeRef = useRef<ReturnType<typeof createAssetLibraryStore> | null>(null)
  if (!storeRef.current) storeRef.current = createAssetLibraryStore(repoRef.current, historyRepoRef.current)
  const store = storeRef.current

  /**
   * 整份状态一次订阅（而不是十来个 `useSyncExternalStore`）。
   *
   * 这一页的可交互筛选有**五个**（页签 / 关键字 / 快捷 / 模型 / 分组），
   * 「素材类型」那一排在 2026-10-14 按用户口径移除（多余），
   * 逐个订阅要写十二份样板，且新增一档就会漏订阅一处 —— 表现为"点了没反应"。
   * 画廊页本来就要整页重渲染，这里没有性能理由去拆。
   */
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const {
    visible: assets,
    loading,
    query,
    quick,
    model: modelFilter,
    group,
    view,
    counts,
    models,
    groups,
    tags,
    tag: tagFilter,
  } = state
  const total = state.assets.length
  const historyTotal = state.history.length
  /**
   * 左侧「收藏内容」就是素材库（用户 2026-10-14：「图二框住的地方可以不要了，
   * 左边的收藏内容就是素材库」）⇒ 顶部「全部历史 / 素材库」两个页签删掉，
   * 由这一个快速筛选决定右内容读历史还是读素材库。
   */
  const showLibrary = quick === 'saved'
  /** 收藏过的 hash（对账 #303：标签只挂在收藏关系上，灯箱据此决定给不给打标签的入口） */
  const libraryHashes = new Set(state.assets.map((a) => a.hash))

  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [preview, setPreview] = useState<LibraryAsset | null>(null)
  const [menuHash, setMenuHash] = useState<string | null>(null)
  const [confirmHash, setConfirmHash] = useState<string | null>(null)
  const [status, setStatusText] = useState('')
  /** 这一条状态是"正常结果"还是"失败"（产品文档 §4.5：失败要 `role=alert`） */
  const [statusTone, setStatusTone] = useState<NoticeTone>('info')
  /** 写状态行的唯一入口：默认 info，失败显式传 'error'（语气跟着这次写入走，不会残留） */
  const setStatus = useCallback((text: string, tone: NoticeTone = 'info') => {
    setStatusText(text)
    setStatusTone(tone)
  }, [])

  useEffect(() => {
    void store.load()
  }, [store])

  const selectAsset = (hash: string) => {
    setSelectedHash(hash)
    setMenuHash(null)
    setConfirmHash(null)
  }

  const openAsset = (asset: LibraryAsset) => {
    setSelectedHash(asset.hash)
    setPreview(asset)
    setMenuHash(null)
    setConfirmHash(null)
  }

  const handleDownload = async (hash: string) => {
    setMenuHash(null)
    const result = await downloadAsset({ assets: platform.assets, files: platform.files }, hash)
    if (result.ok) {
      setStatus(result.via === 'tab' ? '远端素材已在新标签页打开：用浏览器自带的下载保存' : '已下载')
    } else {
      setStatus(result.reason === 'missing' ? '这张素材已不在素材库里' : '下载失败', 'error')
    }
  }

  const handleRemove = async (hash: string) => {
    setConfirmHash(null)
    setMenuHash(null)
    if (preview?.hash === hash) setPreview(null)
    if (selectedHash === hash) setSelectedHash(null)
    try {
      await store.remove(hash)
      setStatus('已取消收藏，原素材仍保留在画布中')
    } catch {
      setStatus('取消收藏失败', 'error')
    }
  }

  /**
   * 改标签（对账 #303）。
   *
   * **先落库再改界面**（与"取消收藏"那条相反，理由也不同）：取消收藏是本地先减、
   * 因为那一下删的是关系、界面必须立刻响应；而标签是一次**写入**，
   * 写完界面才显示"它真的存下来了"，比"先显示再可能回滚"更符合用户对"我打了个标签"的预期。
   * 失败时说清楚（不静默）。
   */
  const handleTagsChange = async (hash: string, next: string[]) => {
    try {
      await store.setTags(hash, next)
      setPreview((p) => {
        if (!p || p.hash !== hash) return p
        const patched = { ...p }
        if (next.length > 0) patched.tags = next
        else delete patched.tags
        return patched
      })
      setStatus(next.length > 0 ? '标签已更新' : '标签已清空')
    } catch {
      setStatus('标签没存下来，稍后再试', 'error')
    }
  }

  /**
   * 历史卡片 → 收藏。
   *
   * 历史条目里已经带着**当时**的提示词 / 模型 / 比例 / 像素（来自运行记录与素材行），
   * 所以这里直接写关系表 —— 不必再回画布节点去拼一份快照（那条路是"从节点保存"用的）。
   */
  const handleSave = async (item: HistoryOutput) => {
    setMenuHash(null)
    try {
      await store.save({ ...cardAssetOf(item), savedAt: Date.now() })
      setStatus('已收藏到素材库')
    } catch {
      setStatus('收藏失败', 'error')
    }
  }

  return (
    <div className={styles.page} data-assets-page>
      {/*
        ── 三排结构（用户 2026-10-06 第 11 条 + 参考图十二，对账 #291）──
        ① 标题区；② **整行**筛选规则（横跨全宽、下面一条分隔线）；③ 左侧筛选 + 右侧内容。

        改之前是"标题与左栏并排"（左栏从标题那一行就开始），所以看着不像三排。
        现在标题与工具行都搬到 `.page` 这一层（不再是 `.main` 的子元素），
        左栏与内容一起下移到 `.body` 那一排里。
      */}
      <header className={styles.head}>
        {/* 标题仍是「我的素材」（用户 2026-10-06 明确保留） */}
        <h1 className={styles.title} data-assets-heading>
          我的素材
        </h1>
        <p className={styles.subtitle}>每一次创作，都在这里。浏览、整理与复用你的生成素材。</p>
      </header>

      {/* 第 2 排：整行筛选规则。`data-assets-*` 锚点一个不动 —— 它们是既有接口 */}
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="搜索素材、提示词或模型…"
          aria-label="搜索素材"
          value={query}
          data-assets-search
          onChange={(event) => store.setQuery(event.target.value)}
        />
        <div className={styles.segmented} data-assets-group>
          {GROUP_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={group === item.id ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              data-assets-group-mode={item.id}
              aria-pressed={group === item.id}
              onClick={() => store.setGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className={styles.segmented} data-assets-view>
          {(['grid', 'list'] as AssetsView[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={view === mode ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              data-assets-view-mode={mode}
              aria-pressed={view === mode}
              aria-label={mode === 'grid' ? '网格视图' : '列表视图'}
              title={mode === 'grid' ? '网格视图' : '列表视图'}
              onClick={() => store.setView(mode)}
            >
              {mode === 'grid' ? '网格' : '列表'}
            </button>
          ))}
        </div>
      </div>

      {/* 第 3 排：左筛选 + 右内容 */}
      <div className={styles.body} data-assets-body>
      {/*
        左侧栏（参考图五）：快速筛选 + 模型生成分组。
        两个区块都对**全量**计数 —— 数字不随当前筛选跳，用户才能拿它当"库里有什么"的读表。
      */}
      <aside className={styles.rail} data-assets-rail>
        <div className={styles.railGroup}>
          <div className={styles.railLabel}>快速筛选</div>
          {QUICK_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={quick === item.id ? `${styles.railItem} ${styles.railItemOn}` : styles.railItem}
              data-assets-quick={item.id}
              aria-pressed={quick === item.id}
              onClick={() => store.setQuick(item.id)}
            >
              <span className={styles.railItemLabel}>{item.label}</span>
              <span className={styles.railItemCount} data-assets-quick-count={item.id}>
                {counts[item.id === 'all' ? 'all' : item.id]}
              </span>
            </button>
          ))}
        </div>

        <div className={styles.railGroup}>
          <div className={styles.railLabel}>模型生成分组</div>
          {models.length === 0 ? (
            <p className={styles.railEmpty}>还没有生成记录</p>
          ) : (
            models.map((entry) => (
              <button
                key={entry.model}
                type="button"
                className={
                  modelFilter === entry.model
                    ? `${styles.railItem} ${styles.railItemOn}`
                    : styles.railItem
                }
                data-assets-model={entry.model}
                aria-pressed={modelFilter === entry.model}
                onClick={() => {
                  /** 再点一次同一个 = 取消这一档（否则用户没有"退回全部"的路） */
                  store.setModelFilter(modelFilter === entry.model ? null : entry.model)
                  /**
                   * 模型只存在于生成历史里；若当前在「收藏内容」（素材库视图），
                   * 点模型要切回历史，否则素材库不认模型、点了像没反应。
                   */
                  if (showLibrary) store.setQuick('all')
                }}
              >
                {/* 显示**前端名**（上游 ID 经用户的 modelMap 归一），筛选值仍是原始 ID */}
                <span className={styles.railItemLabel}>
                  {toLogicalName(allChannels, entry.model)}
                </span>
                <span className={styles.railItemCount}>{entry.count}</span>
              </button>
            ))
          )}
        </div>

        {/*
          标签（对账 #303）：只列**素材库里真出现过的**标签 + 计数。
          点一档就只看带它的（再点一次取消）—— 与「模型生成分组」同一套交互，用户不用学第二遍。
        */}
        <div className={styles.railGroup}>
          <div className={styles.railLabel}>标签</div>
          {tags.length === 0 ? (
            <p className={styles.railEmpty} data-assets-tags-empty>
              还没有标签 —— 双击一张素材，在灯箱里给它打上
            </p>
          ) : (
            tags.map((entry) => (
              <button
                key={entry.tag}
                type="button"
                className={
                  tagFilter === entry.tag
                    ? `${styles.railItem} ${styles.railItemOn}`
                    : styles.railItem
                }
                data-assets-tag={entry.tag}
                aria-pressed={tagFilter === entry.tag}
                onClick={() => {
                  /**
                   * **不替用户切页签**（与「模型生成分组」那条不同）：模型只存在于历史里，
                   * 而标签两页都有（素材库那张是它的源头）。在这里切页签只会让人觉得"我点了个筛选，
                   * 怎么被踢到另一个列表去了"。
                   */
                  store.setTag(tagFilter === entry.tag ? null : entry.tag)
                }}
              >
                <span className={styles.railItemLabel}>{entry.tag}</span>
                <span className={styles.railItemCount} data-assets-tag-count={entry.tag}>
                  {entry.count}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className={styles.main} data-assets-stage>
        <p className={styles.count} data-assets-count>
          {loading
            ? '载入中…'
            : !showLibrary
              ? `筛选出 ${state.historyVisible.length} / ${historyTotal} 条生成记录`
              : assets.length === total
                ? `共 ${total} 个素材`
                : `筛选出 ${assets.length} / ${total} 个素材`}
        </p>

        {loading ? (
          <div className={styles.empty}>载入中…</div>
        ) : !showLibrary ? (
          state.historyVisible.length === 0 ? (
            <div className={styles.empty} data-assets-empty={historyTotal > 0 ? 'filtered' : 'none'}>
              <p className={styles.emptyTitle} data-assets-empty-title>
                {historyTotal > 0 ? '没有符合条件的记录' : '还没有生成记录'}
              </p>
              <p className={styles.emptyHint} data-assets-empty-hint>
                {historyTotal > 0
                  ? '换个关键字或筛选条件试试。'
                  : '在画布里生成一次图片，这里就会有记录。'}
              </p>
            </div>
          ) : (
            <div className={styles.groups} data-assets-history>
              {groups.map((group) => (
                <section className={styles.group} key={group.key} data-assets-group-section={group.key}>
                  {group.label && <h3 className={styles.groupLabel}>{group.label}</h3>}
                  <CardsLayout view={view}>
                    {group.items.map((item) =>
                      item.kind === 'failed' ? (
                        <div className={styles.failedCard} key={item.id} data-history-failed={item.id}>
                          <span className={styles.failedBadge}>生成失败</span>
                          <p className={styles.failedPrompt}>
                            {item.prompt?.trim() ? item.prompt : '（这一条没有留下提示词）'}
                          </p>
                          <p className={styles.failedMeta}>
                            {[item.model, item.projectName, timeLabelOf(item.createdAt)]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                      ) : (
                        <AssetCard
                          key={item.hash}
                          asset={cardAssetOf(item)}
                          saved={item.saved}
                          selected={selectedHash === item.hash}
                          onSelect={() => selectAsset(item.hash)}
                          onOpen={() => openAsset(cardAssetOf(item))}
                          confirming={confirmHash === item.hash}
                          menuOpen={menuHash === item.hash}
                          onToggleMenu={() =>
                            setMenuHash((current) => (current === item.hash ? null : item.hash))
                          }
                          onSave={() => void handleSave(item)}
                          onRequestRemove={() => {
                            setConfirmHash(item.hash)
                            setMenuHash(null)
                          }}
                          onConfirmRemove={() => void handleRemove(item.hash)}
                          onCancelRemove={() => setConfirmHash(null)}
                          onDownload={() => void handleDownload(item.hash)}
                        />
                      ),
                    )}
                  </CardsLayout>
                </section>
              ))}
            </div>
          )
        ) : (
        <section className={styles.section}>
          {assets.length === 0 ? (
            <AssetsEmptyState hasAny={total > 0} />
          ) : (
            <CardsLayout view={view}>
              {assets.map((asset) => (
                <AssetCard
                  key={asset.hash}
                  asset={asset}
                  selected={selectedHash === asset.hash}
                  onSelect={() => selectAsset(asset.hash)}
                  onOpen={() => openAsset(asset)}
                  confirming={confirmHash === asset.hash}
                  menuOpen={menuHash === asset.hash}
                  onToggleMenu={() =>
                    setMenuHash((current) => (current === asset.hash ? null : asset.hash))
                  }
                  onRequestRemove={() => {
                    setConfirmHash(asset.hash)
                    setMenuHash(null)
                  }}
                  onConfirmRemove={() => void handleRemove(asset.hash)}
                  onCancelRemove={() => setConfirmHash(null)}
                  onDownload={() => void handleDownload(asset.hash)}
                />
              ))}
            </CardsLayout>
          )}
        </section>
        )}
      </main>
      </div>

      {/* 语气 → role / aria-live：一处决定（`domain/ui/notice.ts`） */}
      <div className={styles.status} data-status-tone={statusTone} {...noticeA11y(statusTone)}>
        {status}
      </div>

      {(menuHash !== null || confirmHash !== null) && (
        <div
          className={styles.backdrop}
          onClick={() => {
            setMenuHash(null)
            setConfirmHash(null)
          }}
        />
      )}

      {preview && (
        <AssetPreview
          asset={preview}
          onClose={() => setPreview(null)}
          onDownload={() => void handleDownload(preview.hash)}
          onRemove={() => void handleRemove(preview.hash)}
          /**
           * 能不能打标签，看的是**它有没有被收藏**（标签挂在收藏关系上，对账 #303）：
           * 历史页签里没收藏的那张，灯箱里如实写着"先收藏再打标签"，不摆一个存不下去的输入框。
           */
          canTag={libraryHashes.has(preview.hash)}
          onTagsChange={(next) => void handleTagsChange(preview.hash, next)}
        />
      )}
    </div>
  )
}

function AssetsEmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className={styles.empty} data-assets-empty={hasAny ? 'filtered' : 'none'}>
      <p className={styles.emptyTitle} data-assets-empty-title>
        {hasAny ? '没有符合条件的素材' : '还没有收藏素材'}
      </p>
      <p className={styles.emptyHint} data-assets-empty-hint>
        {hasAny
          ? '换个关键字或类型试试。'
          : '从生成节点保存素材后才会出现在这里。'}
      </p>
    </div>
  )
}

/**
 * 历史条目 → 卡片要的形状。
 *
 * `AssetCard` 认的是 `LibraryAsset`（它只用到 hash / mime / 像素 / 那几项冻结元数据），
 * 所以这里做一次字段映射，而不是让卡片长两套 props —— 卡片是同一张卡片，
 * 差别只在宿主传的 `saved` 与 `onSave`（见 `AssetCard` 的注释）。
 */
function cardAssetOf(item: HistoryOutput): LibraryAsset {
  return {
    hash: item.hash,
    mime: item.mime,
    bytes: item.bytes,
    width: item.width,
    height: item.height,
    /** 卡片本身不显示时间（溯源信息都在双击后的灯箱里），这里给产出时间即可 */
    savedAt: item.createdAt,
    projectId: item.projectId,
    prompt: item.prompt,
    model: item.model,
    quality: item.quality,
    ratio: item.ratio,
    channelId: item.channelId,
    /* 标签来自收藏关系那一份（没收藏就是空）—— 灯箱里要能直接看见与编辑 */
    ...(item.tags && item.tags.length > 0 ? { tags: item.tags } : {}),
  }
}

/** 失败卡片上的时间：同一页里不需要精确到秒，够认出"哪一次"就行 */
function timeLabelOf(at: number): string {
  if (!at) return ''
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}
