import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { filterCases, tagCounts, type InspirationCase } from '../../domain/inspiration/cases'
import { INSPIRATION_SOURCES } from '../../domain/inspiration/sources'
import { createInspirationRepository } from '../../state/project/inspirationRepository'
import styles from './InspirationPage.module.css'

/** 一屏先摆多少张（541 条一次全渲染会把图片请求和 DOM 一起打爆） */
const PAGE_SIZE = 24

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
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /** 拉一遍所有来源（首次进页面 + 手动刷新都走它） */
  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRefreshing(true)
    try {
      const out = await Promise.all(
        INSPIRATION_SOURCES.map((s) => repo.refresh(s, ac.signal)),
      )
      if (ac.signal.aborted) return
      /**
       * 失败**不抛**也不清屏：`refresh` 回来时带着上一次的缓存，
       * 所以这里照常 setCases，只把原因收进 errors 让界面如实说明。
       */
      setErrors(
        Object.fromEntries(
          out.filter((o) => o.error).map((o) => [o.sourceId, o.error as string]),
        ),
      )
      setCases(out.flatMap((o) => o.cases))
    } finally {
      if (!ac.signal.aborted) setRefreshing(false)
      setLoading(false)
    }
  }, [repo])

  /** 首次进入：**先读缓存**（秒开），缓存为空才自动联网拉一次 */
  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = await repo.readAll()
      if (!alive) return
      if (rows.length > 0) {
        setCases(rows.flatMap((r) => r.cases))
        setLoading(false)
        return
      }
      await refresh()
    })()
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [repo, refresh])

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [query, sourceId, tag])

  const filtered = useMemo(
    () => filterCases(cases, { query, sourceId, tag }),
    [cases, query, sourceId, tag],
  )
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])
  const tags = useMemo(() => tagCounts(cases).slice(0, 18), [cases])
  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cases) m.set(c.sourceId, (m.get(c.sourceId) ?? 0) + 1)
    return m
  }, [cases])

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
        <div>
          <h1 className={styles.title} data-inspiration-heading>
            灵感库
          </h1>
          <p className={styles.sub} data-inspiration-sub>
            {loading
              ? '正在读取…'
              : `开源案例库 ${cases.length} 个案例 · ${INSPIRATION_SOURCES.length} 个来源`}
          </p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          data-inspiration-refresh
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? '刷新中…' : '刷新案例'}
        </button>
      </header>

      <div className={styles.bar}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题、提示词、标签或作者…"
          aria-label="搜索灵感案例"
          data-inspiration-search
        />
        <span className={styles.count} data-inspiration-count>
          {filtered.length} 个结果
        </span>
      </div>

      {Object.entries(errors).length > 0 && (
        <p className={styles.warn} data-inspiration-error>
          {Object.entries(errors)
            .map(([id, why]) => `${INSPIRATION_SOURCES.find((s) => s.id === id)?.name ?? id}：${why}`)
            .join('；')}
          （下面显示的是上次取到的数据）
        </p>
      )}

      <div className={styles.body}>
        <aside className={styles.rail} data-inspiration-rail>
          <p className={styles.railTitle}>来源</p>
          <button
            type="button"
            className={sourceId === null ? `${styles.railItem} ${styles.railOn}` : styles.railItem}
            data-inspiration-source="all"
            onClick={() => setSourceId(null)}
          >
            <span className={styles.railLabel}>全部来源</span>
            <span className={styles.railCount}>{cases.length}</span>
          </button>
          {INSPIRATION_SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={sourceId === s.id ? `${styles.railItem} ${styles.railOn}` : styles.railItem}
              data-inspiration-source={s.id}
              title={s.note}
              onClick={() => setSourceId(sourceId === s.id ? null : s.id)}
            >
              <span className={styles.railLabel}>{s.name}</span>
              <span className={styles.railCount}>{sourceCounts.get(s.id) ?? 0}</span>
            </button>
          ))}

          {tags.length > 0 && <p className={styles.railTitle}>标签</p>}
          {tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              className={tag === t.tag ? `${styles.railItem} ${styles.railOn}` : styles.railItem}
              data-inspiration-tag={t.tag}
              onClick={() => setTag(tag === t.tag ? null : t.tag)}
            >
              <span className={styles.railLabel}>{t.tag}</span>
              <span className={styles.railCount}>{t.count}</span>
            </button>
          ))}
        </aside>

        <main className={styles.main}>
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
                  <article key={c.id} className={styles.card} data-inspiration-card={c.id}>
                    <div className={styles.shot}>
                      {c.imageUrl ? (
                        <img src={c.imageUrl} alt={c.title} loading="lazy" />
                      ) : (
                        <span className={styles.shotEmpty}>没有预览图</span>
                      )}
                      <span className={styles.badge}>{c.sourceName}</span>
                    </div>
                    <h3 className={styles.cardTitle}>{c.title}</h3>
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
                      <span className={styles.credit} title={c.creditUrl ?? ''}>
                        {c.credit ?? ''}
                      </span>
                      <span className={styles.spacer} />
                      {c.creditUrl && (
                        <a
                          className={styles.link}
                          href={c.creditUrl}
                          target="_blank"
                          rel="noreferrer"
                          data-inspiration-source-link
                        >
                          原图
                        </a>
                      )}
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
    </div>
  )
}
