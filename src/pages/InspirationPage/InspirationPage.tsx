import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useAsset } from '../../workbenches/canvas/hooks/useAsset'
import { filterCases, tagCounts, type InspirationCase } from '../../domain/inspiration/cases'
import { createInspirationRepository } from '../../state/project/inspirationRepository'
import {
  addCustomInspirationSource,
  loadInspirationSources,
  moveInspirationSource,
  removeInspirationSource,
  saveInspirationSources,
  updateInspirationSource,
  type StoredInspirationSource,
} from '../../state/project/inspirationSourceStore'
import { InspirationDetail } from './InspirationDetail'
import {
  InspirationSourcesPanel,
  type NewInspirationSourceInput,
} from './InspirationSourcesPanel'
import styles from './InspirationPage.module.css'

/** 一屏先摆多少张（541 条一次全渲染会把图片请求和 DOM 一起打爆） */
const PAGE_SIZE = 24

/**
 * 收藏存哪：`presets` 表里一行（与 CLI 工具配置同一个做法）。
 *
 * 收藏的是**案例 id**，不是案例本体 —— 案例来自外部仓库，下次刷新可能整批换掉；
 * 存 id 至少能如实回答"这条还在不在"，而存一份副本会在上游更新后变成两份互相矛盾的记录。
 */
const FAV_KEY = 'inspiration:favorites'
const UI_KEY = 'inspiration:ui:v1'

function InspirationShot({
  item,
  repo,
  onCached,
  onOpen,
}: {
  item: InspirationCase
  repo: ReturnType<typeof createInspirationRepository>
  onCached: (sourceId: string, caseId: string, hash: string) => void
  onOpen: () => void
}) {
  const cached = useAsset(item.imageHash ?? '')
  const imageSrc = cached ?? item.imageUrl

  useEffect(() => {
    if (item.imageHash || !item.imageUrl) return
    let alive = true
    void repo.cacheImage(item.sourceId, item.id, item.imageUrl).then((hash) => {
      if (alive && hash) onCached(item.sourceId, item.id, hash)
    })
    return () => {
      alive = false
    }
  }, [item.id, item.imageHash, item.imageUrl, item.sourceId, onCached, repo])

  if (item.videoUrl) {
    return (
      <video
        src={item.videoUrl}
        poster={imageSrc || undefined}
        muted
        playsInline
        preload="metadata"
        data-inspiration-open
        data-inspiration-cached={item.imageHash ? 'true' : undefined}
        onClick={onOpen}
      />
    )
  }
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={item.title}
        loading="lazy"
        data-inspiration-open
        data-inspiration-cached={item.imageHash ? 'true' : undefined}
        onClick={onOpen}
      />
    )
  }
  return <span className={styles.shotEmpty}>没有预览图</span>
}

/**
 * 灵感库（用户 2026-10-14：「我要在左边菜单加一个灵感库，用 github 上开源的库，
 * 直接链接他们的内容」）。
 *
 * ## 三条已经定死的口径
 *
 * 1. **是工具页、不是资源管理**：图一顶部是「工具 / 插件 / 灵感」并列，所以它进左侧一级导航。
 * 2. **只存索引、媒体走外链**：用户明确否掉了"同步到本地"（「里面还有视频」）——
 *    这里落的只有标题 / 提示词 / 标签 / 预览图地址 / 出处，几 MB 的图和视频一个都不下。
 * 3. **骨架抄素材页**：卡片网格 + 顶部搜索 + 左侧分组栏 + 卡片上的复制按钮，
 *    与 `/assets` 同一套浏览习惯（用户：「我的灵感库有什么可以抄我的素材页的」）。
 */
export function InspirationPage() {
  const platform = usePlatform()
  const repo = useMemo(
    () => createInspirationRepository(platform.storage, platform.network),
    [platform],
  )

  const [cases, setCases] = useState<InspirationCase[]>([])
  const [sources, setSources] = useState<StoredInspirationSource[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [modelCategory, setModelCategory] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [tagsCollapsed, setTagsCollapsed] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /** 收藏的案例 id（存 `presets` 表，见 `FAV_KEY`） */
  const [favs, setFavs] = useState<Set<string>>(new Set())
  /** 左侧「我的收藏」那一档：只看收藏过的 */
  const [favOnly, setFavOnly] = useState(false)
  /** 点开的案例（非空 = 灯箱开着） */
  const [detail, setDetail] = useState<InspirationCase | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /** 收藏是**本机偏好**，单独读：来源这次挂掉也不该让收藏丢 */
  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = (await platform.storage.query('presets', { id: FAV_KEY })) as unknown as {
        ids?: unknown
      }[]
      if (!alive) return
      const ids = rows[0]?.ids
      if (Array.isArray(ids)) {
        setFavs(new Set(ids.filter((x): x is string => typeof x === 'string')))
      }
    })()
    return () => {
      alive = false
    }
  }, [platform])

  const toggleFav = useCallback(
    (id: string) => {
      setFavs((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        /** 落库是"顺手"，不 await：收藏要即时，不该等一次 IO */
        void platform.storage.put('presets', { id: FAV_KEY, ids: [...next] })
        return next
      })
    },
    [platform],
  )

  const rememberCachedImage = useCallback(
    (cachedSourceId: string, caseId: string, hash: string) => {
      setCases((prev) =>
        prev.map((item) =>
          item.sourceId === cachedSourceId && item.id === caseId
            ? { ...item, imageHash: hash }
            : item,
        ),
      )
      setDetail((prev) =>
        prev && prev.sourceId === cachedSourceId && prev.id === caseId
          ? { ...prev, imageHash: hash }
          : prev,
      )
    },
    [],
  )

  const persistSources = useCallback(
    (next: StoredInspirationSource[]) => {
      setSources(next)
      void saveInspirationSources(platform.storage, next)
    },
    [platform],
  )

  /** 拉指定来源；首次进页面、管理面板单源刷新、手动刷新都走这一条。 */
  const refreshTargets = useCallback(
    async (targets: readonly StoredInspirationSource[], background = false) => {
      if (targets.length === 0) {
        setLoading(false)
        return
      }
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      if (!background) setRefreshing(true)
      setRefreshingIds(new Set(targets.map((source) => source.id)))
      try {
        const out = await Promise.all(targets.map((source) => repo.refresh(source, ac.signal)))
        if (ac.signal.aborted) return
        const ids = new Set(targets.map((source) => source.id))
        setErrors((prev) => {
          const next = { ...prev }
          for (const id of ids) delete next[id]
          for (const item of out) if (item.error) next[item.sourceId] = item.error
          return next
        })
        setCases((prev) => [
          ...prev.filter((item) => !ids.has(item.sourceId)),
          ...out.flatMap((item) => item.cases),
        ])
        const syncedAt = new Map(
          out.filter((item) => !item.error).map((item) => [item.sourceId, item.fetchedAt]),
        )
        setSources((prev) => {
          const next = prev.map((source) =>
            syncedAt.has(source.id) ? { ...source, syncedAt: syncedAt.get(source.id) } : source,
          )
          void saveInspirationSources(platform.storage, next)
          return next
        })
      } finally {
        if (!ac.signal.aborted) setRefreshing(false)
        setRefreshingIds(new Set())
        setLoading(false)
      }
    },
    [platform, repo],
  )

  /** 首次进入：**先读缓存**（秒开），再后台刷新；没有缓存时才等联网。 */
  useEffect(() => {
    let alive = true
    void (async () => {
      const loaded = await loadInspirationSources(platform.storage)
      if (!alive) return
      setSources(loaded)
      const enabled = loaded.filter((source) => source.enabled)
      const rows = await repo.readAll()
      if (!alive) return
      const byId = new Map(rows.map((row) => [row.sourceId, row]))
      const cached = enabled.flatMap((source) =>
        (byId.get(source.id)?.cases ?? []).map((item) => ({
          ...item,
          modelCategory: item.modelCategory ?? source.modelCategory,
          kind: item.kind ?? source.kind,
        })),
      )
      if (cached.length > 0) {
        setCases(cached)
        setLoading(false)
        void refreshTargets(enabled, true)
      } else {
        await refreshTargets(enabled, false)
      }
    })()
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [platform, repo, refreshTargets])

  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = (await platform.storage.query('presets', { id: UI_KEY })) as unknown as {
        tagsCollapsed?: unknown
      }[]
      if (!alive) return
      if (typeof rows[0]?.tagsCollapsed === 'boolean') setTagsCollapsed(rows[0].tagsCollapsed)
    })()
    return () => {
      alive = false
    }
  }, [platform])

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [query, sourceId, modelCategory, tag, favOnly])

  const enabledSourceIds = useMemo(
    () => new Set(sources.filter((source) => source.enabled).map((source) => source.id)),
    [sources],
  )
  const activeCases = useMemo(
    () => cases.filter((item) => enabledSourceIds.has(item.sourceId)),
    [cases, enabledSourceIds],
  )

  const filtered = useMemo(() => {
    const base = filterCases(activeCases, { query, sourceId, modelCategory, tag })
    /** 「我的收藏」与来源是一组**单选**；标签 / 关键字仍可叠加 */
    return favOnly ? base.filter((c) => favs.has(c.id)) : base
  }, [activeCases, query, sourceId, modelCategory, tag, favOnly, favs])
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])
  const detailIndex = detail
    ? visible.findIndex((item) => item.id === detail.id)
    : -1
  /**
   * 标签只列**当前来源**里真出现过的（用户 2026-10-14：「灵感库下方的标签应该
   * 对应每个来源，而不是显示全部的标签，需要分来源来对应」）。
   * 选「我的收藏」时按收藏集合算；选「全部来源」时仍是全量。
   */
  const tagScopeCases = useMemo(() => {
    if (favOnly) return activeCases.filter((c) => favs.has(c.id))
    return sourceId ? activeCases.filter((c) => c.sourceId === sourceId) : activeCases
  }, [activeCases, favOnly, favs, sourceId])
  const tags = useMemo(() => tagCounts(tagScopeCases).slice(0, 18), [tagScopeCases])
  /** 换来源后旧标签可能已经不在这一档里 —— 降级回「全部标签」，别留一个空结果 */
  useEffect(() => {
    if (tag && !tagScopeCases.some((c) => c.tags.includes(tag))) setTag(null)
  }, [tag, tagScopeCases])
  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cases) m.set(c.sourceId, (m.get(c.sourceId) ?? 0) + 1)
    return m
  }, [cases])
  const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources])
  const modelCategories = useMemo(
    () => [...new Set(enabledSources.map((source) => source.modelCategory).filter(Boolean))],
    [enabledSources],
  )
  useEffect(() => {
    if (modelCategory && !modelCategories.includes(modelCategory)) setModelCategory(null)
  }, [modelCategory, modelCategories])
  const sourceNameOf = useCallback(
    (id: string) => sources.find((source) => source.id === id)?.name ?? id,
    [sources],
  )

  const toggleTagsCollapsed = () => {
    setTagsCollapsed((prev) => {
      const next = !prev
      void platform.storage.put('presets', { id: UI_KEY, tagsCollapsed: next })
      return next
    })
  }

  const addSource = useCallback(
    (input: NewInspirationSourceInput) => {
      const result = addCustomInspirationSource(sources, input)
      if (!result) return false
      persistSources(result.sources)
      void refreshTargets([result.added])
      return true
    },
    [persistSources, refreshTargets, sources],
  )

  const deleteSource = useCallback(
    (id: string) => {
      persistSources(removeInspirationSource(sources, id))
      setCases((prev) => prev.filter((item) => item.sourceId !== id))
      setErrors((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      if (sourceId === id) setSourceId(null)
      void repo.remove(id)
    },
    [persistSources, repo, sourceId, sources],
  )

  const toggleSource = useCallback(
    (id: string, enabled: boolean) => {
      const source = sources.find((item) => item.id === id)
      persistSources(updateInspirationSource(sources, id, { enabled }))
      if (enabled && source) void refreshTargets([{ ...source, enabled: true }])
      if (!enabled && sourceId === id) setSourceId(null)
    },
    [persistSources, refreshTargets, sourceId, sources],
  )

  const moveSource = useCallback(
    (id: string, delta: -1 | 1) => {
      persistSources(moveInspirationSource(sources, id, delta))
    },
    [persistSources, sources],
  )

  const refreshSource = useCallback(
    (id: string) => {
      const source = sources.find((item) => item.id === id)
      if (source) void refreshTargets([source])
    },
    [refreshTargets, sources],
  )

  const copyPrompt = useCallback((c: InspirationCase) => {
    if (!c.prompt) return
    void navigator.clipboard
      ?.writeText(c.prompt)
      .then(() => {
        setCopiedId(c.id)
        if (copiedTimer.current) clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopiedId(null), 1500)
      })
      .catch(() => {})
  }, [])

  return (
    <div className={styles.page} data-inspiration-page>
      <header className={styles.head}>
        <h1 className={styles.title} data-inspiration-heading>
          灵感库
        </h1>
        <p className={styles.sub} data-inspiration-sub>
          {loading
            ? '正在读取…'
            : `开源案例库 ${activeCases.length} 个案例 · ${enabledSources.length} 个来源`}
        </p>
      </header>

      <div
        className={styles.toolbar}
        data-inspiration-toolbar
        data-model-state={modelCategory ?? ''}
      >
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题、提示词、标签或作者…"
          aria-label="搜索灵感案例"
          data-inspiration-search
        />
        <div className={styles.modelButtons} role="group" aria-label="模型分类">
          <button
            type="button"
            className={modelCategory === null ? styles.modelButtonOn : styles.modelButton}
            data-inspiration-model-filter="all"
            aria-pressed={modelCategory === null}
            onClick={() => setModelCategory(null)}
          >
            全部模型
          </button>
          {modelCategories.map((category) => (
            <button
              key={category}
              type="button"
              className={
                modelCategory === category ? styles.modelButtonOn : styles.modelButton
              }
              data-inspiration-model-filter={category}
              aria-pressed={modelCategory === category}
              onClick={() => setModelCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
        <span className={styles.count} data-inspiration-count>
          {filtered.length} 个结果
        </span>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.refresh}
            data-inspiration-sources-open
            onClick={() => setSourcesOpen(true)}
          >
            管理来源
          </button>
          <button
            type="button"
            className={styles.refresh}
            data-inspiration-refresh
            disabled={refreshing}
            onClick={() => void refreshTargets(enabledSources)}
          >
            {refreshing ? '刷新中…' : '刷新案例'}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <aside className={styles.rail} data-inspiration-rail>
          <div className={styles.railGroup}>
            <div className={styles.railHead}>
              <p className={styles.railLabel}>来源</p>
              <button
                type="button"
                className={styles.railManage}
                data-inspiration-sources-open
                onClick={() => setSourcesOpen(true)}
              >
                管理
              </button>
            </div>
            <button
              type="button"
              className={
                sourceId === null && !favOnly
                  ? `${styles.railItem} ${styles.railOn}`
                  : styles.railItem
              }
              data-inspiration-source="all"
              aria-pressed={sourceId === null && !favOnly}
              onClick={() => {
                setSourceId(null)
                setFavOnly(false)
              }}
            >
              <span className={styles.railItemLabel}>全部来源</span>
              <span className={styles.railItemCount}>{activeCases.length}</span>
            </button>
            <button
              type="button"
              className={favOnly ? `${styles.railItem} ${styles.railOn}` : styles.railItem}
              data-inspiration-fav-filter
              aria-pressed={favOnly}
              onClick={() => {
                const next = !favOnly
                setFavOnly(next)
                /** 与来源是一组单选：打开收藏 = 清掉来源，避免两个同时亮 */
                if (next) setSourceId(null)
              }}
            >
              <span className={styles.railItemLabel}>我的收藏</span>
              <span className={styles.railItemCount}>{favs.size}</span>
            </button>
            {enabledSources.map((s) => (
              <button
                key={s.id}
                type="button"
                className={
                  sourceId === s.id && !favOnly
                    ? `${styles.railItem} ${styles.railOn}`
                    : styles.railItem
                }
                data-inspiration-source={s.id}
                aria-pressed={sourceId === s.id && !favOnly}
                title={s.note}
                onClick={() => {
                  if (sourceId === s.id) {
                    setSourceId(null)
                  } else {
                    setSourceId(s.id)
                    /** 与「我的收藏」是一组单选 */
                    setFavOnly(false)
                  }
                }}
              >
                <span className={styles.railItemLabel}>{s.name}</span>
                <span className={styles.railItemCount}>{sourceCounts.get(s.id) ?? 0}</span>
              </button>
            ))}
          </div>

          {tags.length > 0 && (
            <div className={styles.railGroup}>
              <button
                type="button"
                className={styles.railHeadButton}
                data-inspiration-tags-toggle
                aria-expanded={!tagsCollapsed}
                onClick={toggleTagsCollapsed}
              >
                <span className={styles.railLabel}>标签</span>
                <span>{tagsCollapsed ? '›' : '⌄'}</span>
              </button>
              {!tagsCollapsed &&
                tags.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    className={tag === t.tag ? `${styles.railItem} ${styles.railOn}` : styles.railItem}
                    data-inspiration-tag={t.tag}
                    aria-pressed={tag === t.tag}
                    onClick={() => setTag(tag === t.tag ? null : t.tag)}
                  >
                    <span className={styles.railItemLabel}>{t.tag}</span>
                    <span className={styles.railItemCount}>{t.count}</span>
                  </button>
                ))}
            </div>
          )}
        </aside>

        <main className={styles.main}>
          {Object.entries(errors).length > 0 && (
            <p className={styles.warn} data-inspiration-error>
              {Object.entries(errors)
                .map(
                  ([id, why]) =>
                    `${sourceNameOf(id)}：${why}`,
                )
                .join('；')}
              （下面显示的是上次取到的数据）
            </p>
          )}
          {loading && <p className={styles.empty}>正在读取…</p>}
          {!loading && filtered.length === 0 && (
            <p className={styles.empty} data-inspiration-empty>
              没有匹配的案例。换个关键词，或者点「刷新案例」重新取一次。
            </p>
          )}
          {!loading && filtered.length > 0 && (
            <>
              <div className={styles.grid} data-inspiration-grid>
                {visible.map((c) => (
                  <article
                    key={c.id}
                    className={styles.card}
                    data-inspiration-card={c.id}
                    data-inspiration-model={c.modelCategory ?? ''}
                  >
                    <div className={styles.shot}>
                      <InspirationShot
                        item={c}
                        repo={repo}
                        onCached={rememberCachedImage}
                        onOpen={() => setDetail(c)}
                      />
                      <button
                        type="button"
                        className={favs.has(c.id) ? `${styles.fav} ${styles.favOn}` : styles.fav}
                        data-inspiration-fav={c.id}
                        aria-label={favs.has(c.id) ? '取消收藏' : '收藏这条案例'}
                        aria-pressed={favs.has(c.id)}
                        onClick={() => toggleFav(c.id)}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill={favs.has(c.id) ? 'currentColor' : 'none'}
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        >
                          <path d="M12 20.5 3.8 12.3a5 5 0 0 1 7.1-7.1l1.1 1.1 1.1-1.1a5 5 0 0 1 7.1 7.1Z" />
                        </svg>
                      </button>
                      <span className={styles.badge}>
                        {c.kind === 'video' ? '视频 · ' : ''}
                        {c.sourceName}
                      </span>
                    </div>
                    <h3
                      className={styles.cardTitle}
                      data-inspiration-open
                      onClick={() => setDetail(c)}
                    >
                      {c.title}
                    </h3>
                    {c.tags.length > 0 && (
                      <p className={styles.tags}>
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className={styles.tag}>
                            {t}
                          </span>
                        ))}
                      </p>
                    )}
                    <div className={styles.actions}>
                      <span className={styles.credit} title={c.credit ?? ''}>
                        {c.credit ?? ''}
                      </span>
                      <span className={styles.spacer} />
                      <button
                        type="button"
                        className={styles.copy}
                        data-inspiration-copy
                        onClick={() => copyPrompt(c)}
                      >
                        {copiedId === c.id ? '已复制' : '复制提示词'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {filtered.length > visible.length && (
                <div className={styles.moreRow}>
                  <button
                    type="button"
                    className={styles.more}
                    data-inspiration-more
                    onClick={() => setLimit((n) => n + PAGE_SIZE)}
                  >
                    加载更多（还有 {filtered.length - visible.length} 个）
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {sourcesOpen && (
        <InspirationSourcesPanel
          sources={sources}
          counts={sourceCounts}
          refreshingIds={refreshingIds}
          onClose={() => setSourcesOpen(false)}
          onAdd={addSource}
          onDelete={deleteSource}
          onToggle={toggleSource}
          onMove={moveSource}
          onRefresh={refreshSource}
        />
      )}
      {detail && (
        <InspirationDetail
          item={detail}
          onClose={() => setDetail(null)}
          onPrevious={
            detailIndex > 0 ? () => setDetail(visible[detailIndex - 1] ?? null) : undefined
          }
          onNext={
            detailIndex >= 0 && detailIndex < visible.length - 1
              ? () => setDetail(visible[detailIndex + 1] ?? null)
              : undefined
          }
          positionLabel={detailIndex >= 0 ? `${detailIndex + 1} / ${visible.length}` : undefined}
        />
      )}
    </div>
  )
}
