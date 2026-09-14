import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { useCanvasStore, useGraph } from '../storeContext'
import { useAsset } from '../hooks/useAsset'
import {
  filterRunRecords,
  inputsSummaryOf,
  type RunRecord,
} from '../../../domain/canvas/model/runRecord'
import type { GenerationData } from '../../../domain/canvas/model/node'
import { statusLabel, formatLogTime } from './LogPanel'
import styles from './CanvasTimeline.module.css'

/**
 * 画布时间轴（产品文档 §6.21 ② / §6.20 ⌘H）：
 * 全局视图，项目内所有节点的 RunRecord 按时间倒序排列，可按节点 / 状态过滤。
 * 时间维由行内时间戳呈现（§6.21 的「按时间过滤」以倒序 + 数量呈现，细粒度时段筛选留待后续）。
 */
const STATUS_FILTERS: { value: RunRecord['status'] | null; label: string }[] = [
  { value: null, label: '全部' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'canceled', label: '已取消' },
  { value: 'interrupted', label: '已中断' },
]

export function CanvasTimeline({ onClose }: { onClose: () => void }) {
  const platform = usePlatform()
  const channels = useChannels()
  const store = useCanvasStore()
  const graph = useGraph()
  const projectId = store.getSnapshot().projectId

  const [records, setRecords] = useState<RunRecord[]>([])
  const [nodeFilter, setNodeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<RunRecord['status'] | null>(null)

  const reload = useCallback(async () => {
    const rows = await platform.storage.query('runRecords', { projectId })
    setRecords(rows as unknown as RunRecord[])
  }, [platform, projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  // 面板打开期间有新生成写回时刷新
  useEffect(() => {
    let last = store.getSnapshot()
    return store.subscribe(() => {
      const g = store.getSnapshot()
      if (g === last) return
      last = g
      void reload()
    })
  }, [store, reload])

  const titleOf = useMemo(() => {
    const index = new Map(graph.nodes.map((n) => [n.id, n] as const))
    return (nodeId: string) => {
      const n = index.get(nodeId)
      if (!n) return '（已删除节点）'
      return n.title || n.type
    }
  }, [graph.nodes])

  const visible = filterRunRecords(records, { nodeId: nodeFilter, status: statusFilter })
  // 有记录的节点集合（供节点过滤下拉）
  const nodeOptions = useMemo(() => {
    const ids = [...new Set(records.map((r) => r.nodeId))]
    return ids.map((id) => ({ id, title: titleOf(id) }))
  }, [records, titleOf])

  const channelName = (chId: string) =>
    channels.getState().channels.find((c) => c.id === chId)?.name ?? chId ?? '未知平台'

  return (
    <div className={styles.overlay} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="画布时间轴">
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>时间轴</span>
          <span className={styles.count}>{visible.length} 条</span>
          <select
            className={styles.filterSelect}
            data-timeline-node-filter
            value={nodeFilter ?? ''}
            onChange={(e) => setNodeFilter(e.target.value || null)}
            aria-label="按节点过滤"
          >
            <option value="">全部节点</option>
            {nodeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          <div className={styles.statusGroup} data-timeline-status-filter>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                className={`${styles.statusBtn} ${statusFilter === s.value ? styles.statusBtnActive : ''}`}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className={styles.list}>
          {visible.length === 0 ? (
            <div className={styles.empty}>没有匹配的生成记录</div>
          ) : (
            visible.map((r) => (
              <TimelineRow
                key={r.id}
                record={r}
                nodeTitle={titleOf(r.nodeId)}
                channelName={channelName((r.params as GenerationData).channelId)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function TimelineRow({
  record,
  nodeTitle,
  channelName,
}: {
  record: RunRecord
  nodeTitle: string
  channelName: string
}) {
  const thumbUrl = useAsset(record.outputHashes[0])
  const ok = record.status === 'succeeded'
  const seconds = (record.durationMs / 1000).toFixed(1)

  return (
    <div className={styles.row} data-timeline-row={record.nodeId}>
      {thumbUrl && <img className={styles.thumb} src={thumbUrl} alt="" draggable={false} />}
      <div className={styles.main}>
        <div className={styles.rowTop}>
          <b className={styles.nodeTitle}>{nodeTitle}</b>
          <span className={styles.version}>v{record.version}</span>
          <span className={`${styles.badge} ${ok ? styles.badgeOk : styles.badgeFail}`}>
            {statusLabel(record.status)}
          </span>
          <span className={styles.cap}>{channelName}</span>
          <span className={styles.cap}>{(record.params as GenerationData).model || '—'}</span>
          <span className={styles.cap}>{seconds}s</span>
          <span className={styles.time}>{formatLogTime(record.createdAt)}</span>
        </div>
        <div className={styles.rowBottom}>
          <span>{inputsSummaryOf(record.inputs)}</span>
          {record.outputHashes.length > 0 && <span>· 输出 {record.outputHashes.length} 个</span>}
        </div>
      </div>
    </div>
  )
}
