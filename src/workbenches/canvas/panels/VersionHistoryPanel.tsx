import { useCallback, useEffect, useSyncExternalStore, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { useCanvasStore, useGraph, useViewportState } from '../storeContext'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import { useAsset } from '../hooks/useAsset'
import { indexNodes } from '../../../domain/canvas/model/graph'
import { toWorldRect } from '../../../domain/canvas/geometry/coords'
import { filterRunRecords, inputsSummaryOf, nextVersion, type RunRecord } from '../../../domain/canvas/model/runRecord'
import { createId } from '../../../shared/id'
import { statusLabel, formatLogTime } from './LogPanel'
import styles from './VersionHistoryPanel.module.css'

/**
 * 节点版本历史面板（产品文档 §6.21 ①）：
 * 右键「版本历史」弹出，220px 宽，按时间倒序列出该节点全部 RunRecord（从不删除）。
 * 每行：版本号 / 输入源 / 时间 / 状态徽标。
 * - Ctrl/⌘ + 点击 → 临时预览（30% 透明叠加，不改状态，Esc 或再点退出）
 * - 双击 → 恢复为该版本：写回 params（node.runRecord.restore）并追加新 RunRecord（旧版本保留）
 */
export function VersionHistoryPanel() {
  const platform = usePlatform()
  const store = useCanvasStore()
  const graph = useGraph()
  const viewport = useViewportState()
  const exec = useCanvasExecution()
  const historyNodeId = useSyncExternalStore(
    store.subscribe,
    store.getHistoryNodeId,
    store.getHistoryNodeId,
  )
  const [records, setRecords] = useState<RunRecord[]>([])

  const reload = useCallback(async () => {
    if (!historyNodeId) {
      setRecords([])
      return
    }
    const rows = await platform.storage.query('runRecords', { nodeId: historyNodeId })
    setRecords(filterRunRecords(rows as unknown as RunRecord[], {}))
  }, [platform, historyNodeId])

  useEffect(() => {
    void reload()
  }, [reload])

  // 面板打开期间图有变更（恢复 / 生成写回）时刷新列表
  useEffect(() => {
    if (!historyNodeId) return
    let last = store.getSnapshot()
    return store.subscribe(() => {
      const g = store.getSnapshot()
      if (g === last) return
      last = g
      void reload()
    })
  }, [store, historyNodeId, reload])

  // Esc：预览存在时只退预览（预览层负责清除），否则关闭面板（§6.21 两级退出）
  useEffect(() => {
    if (!historyNodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (store.getVersionPreview()) return
      e.preventDefault()
      store.closeHistory()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, historyNodeId])

  if (!historyNodeId) return null

  // 面板锚定目标节点右侧（屏幕坐标，缩放平移不随动，与创作面板 §6.8 同理）
  const index = indexNodes(graph.nodes)
  const node = index.get(historyNodeId)
  const parent = node?.parentId ? index.get(node.parentId) ?? null : null
  const rect = node ? toWorldRect(node, parent) : null
  const panelStyle = rect
    ? {
        left: (rect.x + rect.w - viewport.x) * viewport.zoom + 8,
        top: (rect.y - viewport.y) * viewport.zoom,
      }
    : undefined

  const restore = async (record: RunRecord) => {
    // 双击恢复：params 写回节点 + 追加新 RunRecord（version 顺延，旧版本保留，§6.21）。
    // append 走执行宿主（appendRecord）同步版本计数并立即落库，落库完成后刷新列表
    store.dispatch({ kind: 'node.runRecord.restore', nodeId: historyNodeId, record })
    await exec.appendRecord({
      id: createId('rr'),
      nodeId: historyNodeId,
      projectId: record.projectId,
      version: nextVersion(records),
      createdAt: Date.now(),
      status: record.status,
      inputs: record.inputs,
      params: record.params,
      outputHashes: record.outputHashes,
      fingerprint: record.fingerprint,
      taskId: record.taskId,
      durationMs: 0,
      cost: record.cost,
    })
    void reload()
  }

  const preview = (record: RunRecord) => {
    // ⌘/Ctrl + 点击 → 临时预览；再次 ⌘+点击同一版本退出（§6.21）
    const cur = store.getVersionPreview()
    if (cur && cur.recordId === record.id) store.setVersionPreview(null)
    else
      store.setVersionPreview({
        nodeId: historyNodeId,
        recordId: record.id,
        assetHash: record.outputHashes[0] ?? null,
      })
  }

  return (
    <div className={styles.panel} style={panelStyle} data-version-history-panel role="dialog" aria-label="版本历史">
      <div className={styles.header}>
        <span className={styles.title}>版本历史</span>
        <span className={styles.count}>{records.length} 版</span>
        <button type="button" className={styles.ghostBtn} onClick={() => store.closeHistory()}>
          关闭
        </button>
      </div>
      <div className={styles.list}>
        {records.length === 0 ? (
          <div className={styles.empty}>该节点还没有生成记录</div>
        ) : (
          records.map((r) => (
            <VersionRow
              key={r.id}
              record={r}
              previewing={store.getVersionPreview()?.recordId === r.id}
              onPreview={() => preview(r)}
              onRestore={() => void restore(r)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function VersionRow({
  record,
  previewing,
  onPreview,
  onRestore,
}: {
  record: RunRecord
  previewing: boolean
  onPreview: () => void
  onRestore: () => void
}) {
  const ok = record.status === 'succeeded'
  const thumbUrl = useAsset(record.outputHashes[0])
  // ⌘/Ctrl + 点击 = 临时预览；双击 = 恢复（§6.21）
  const onClick = (e: ReactMouseEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return
    onPreview()
  }

  return (
    <div
      className={`${styles.row} ${previewing ? styles.rowPreviewing : ''}`}
      data-version-row={record.version}
      onClick={onClick}
      onDoubleClick={onRestore}
      title="⌘/Ctrl+点击 临时预览 · 双击恢复此版本"
    >
      <div className={styles.rowTop}>
        <span className={styles.version}>v{record.version}</span>
        <span className={`${styles.badge} ${ok ? styles.badgeOk : styles.badgeFail}`}>
          {statusLabel(record.status)}
        </span>
        <span className={styles.time}>{formatLogTime(record.createdAt)}</span>
      </div>
      <div className={styles.rowBottom}>
        <span className={styles.inputs}>{inputsSummaryOf(record.inputs)}</span>
        {record.outputHashes.length > 0 && <span className={styles.outputs}>输出 {record.outputHashes.length} 个</span>}
      </div>
      {thumbUrl && (
        <img className={styles.thumb} src={thumbUrl} alt="" draggable={false} />
      )}
    </div>
  )
}
