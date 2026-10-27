import { useCallback, useEffect, useMemo, useState } from 'react'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import {
  pixelSummaryOf,
  routeAttemptSummaryOf,
} from '../../../domain/shared/execution/runRecord'
import { WORKBENCHES } from '../../../domain/shared/workbench'
import {
  createRunLogRepository,
  type RunLogEntry,
  type RunLogQuery,
} from '../../../state/shared/runLogRepository'
import styles from './RunLogList.module.css'

export type RunLogFilter = Omit<RunLogQuery, 'offset' | 'limit'>

export function runLogStatusLabel(status: RunLogEntry['record']['status']): string {
  if (status === 'succeeded') return '成功'
  if (status === 'canceled') return '已取消'
  if (status === 'interrupted') return '已中断'
  return '失败'
}

export function runLogWorkbenchLabel(entry: RunLogEntry): string {
  if (entry.scopeState === 'unclassified') return '未分类'
  return entry.effectiveWorkbench ? WORKBENCHES[entry.effectiveWorkbench].label : '未分类'
}

export function runLogPromptOf(entry: RunLogEntry): string {
  const params = (entry.record.params ?? {}) as { prompt?: unknown }
  return typeof params.prompt === 'string' ? params.prompt : ''
}

export function RunLogList({
  filter,
  pageSize = 50,
  emptyText = '还没有运行记录',
}: {
  filter?: RunLogFilter
  pageSize?: number
  emptyText?: string
}) {
  const platform = usePlatform()
  const channels = useChannels()
  const repo = useMemo(() => createRunLogRepository(platform.storage), [platform])
  const filterKey = JSON.stringify(filter ?? {})
  const stableFilter = useMemo(
    () => JSON.parse(filterKey) as RunLogFilter,
    [filterKey],
  )
  const [entries, setEntries] = useState<RunLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const page = await repo.query({
        ...stableFilter,
        offset: 0,
        limit: pageSize,
      })
      setEntries(page.entries)
      setTotal(page.total)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [pageSize, repo, stableFilter])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  const loadMore = async () => {
    const page = await repo.query({
      ...stableFilter,
      offset: entries.length,
      limit: pageSize,
    })
    setEntries((current) => [...current, ...page.entries])
    setTotal(page.total)
  }

  const channelName = (id: string | undefined): string => {
    if (!id) return ''
    return channels.getState().channels.find((channel) => channel.id === id)?.name ?? id
  }

  if (loading && entries.length === 0) {
    return <div className={styles.empty}>正在读取运行记录…</div>
  }
  if (error) {
    return (
      <div className={styles.error} role="alert">
        日志读取失败：{error}
      </div>
    )
  }
  if (entries.length === 0) return <div className={styles.empty}>{emptyText}</div>

  return (
    <div className={styles.list} data-run-log-list>
      <div className={styles.summary}>
        <span>{total} 条</span>
        <button type="button" onClick={() => void loadFirstPage()} disabled={loading}>
          刷新
        </button>
      </div>
      {entries.map((entry) => {
        const record = entry.record
        const params = (record.params ?? {}) as { model?: unknown }
        const model =
          record.sentModel ??
          (typeof params.model === 'string' ? params.model : '') ??
          ''
        const attempt = routeAttemptSummaryOf(record.routeAttempts)
        const pixels = pixelSummaryOf(record)
        const prompt = runLogPromptOf(entry)
        return (
          <article
            key={record.id}
            className={styles.row}
            data-run-log-row={record.id}
            data-workbench={entry.effectiveWorkbench ?? 'unclassified'}
            data-status={record.status}
          >
            <div className={styles.rowHead}>
              <span
                className={
                  record.status === 'succeeded'
                    ? `${styles.status} ${styles.ok}`
                    : `${styles.status} ${styles.bad}`
                }
              >
                {runLogStatusLabel(record.status)}
              </span>
              <span>{runLogWorkbenchLabel(entry)}</span>
              {record.action ? <span>{record.action}</span> : null}
              <span>{model || '—'}</span>
              {channelName(record.sentChannelId) ? (
                <span>{channelName(record.sentChannelId)}</span>
              ) : null}
              {attempt ? <span title={attempt.title}>路由 {attempt.count} 次</span> : null}
              <span>{(record.durationMs / 1000).toFixed(1)}s</span>
              <time>{new Date(record.createdAt).toLocaleString('zh-CN')}</time>
            </div>
            <div className={styles.meta}>
              <span>项目：{record.projectId}</span>
              {entry.scopeState !== 'scoped' ? <span>{entry.reason ?? entry.scopeState}</span> : null}
              {pixels ? <span>{pixels}</span> : null}
            </div>
            {record.errorText ? (
              <p className={styles.errorText} data-run-log-error>
                {record.errorText}
              </p>
            ) : null}
            {prompt ? (
              <p className={styles.prompt} data-run-log-prompt title={prompt}>
                {prompt}
              </p>
            ) : null}
          </article>
        )
      })}
      {entries.length < total ? (
        <button type="button" className={styles.more} onClick={() => void loadMore()}>
          加载更多（剩余 {total - entries.length} 条）
        </button>
      ) : null}
    </div>
  )
}
