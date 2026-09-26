import { useCallback, useEffect, useState } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { useCanvasStore } from '../storeContext'
import { useAsset } from '../hooks/useAsset'
import type { RunRecord } from '../../../domain/canvas/model/runRecord'
import { pixelSummaryOf } from '../../../domain/shared/execution/runRecord'
import type { GenerationData } from '../../../domain/canvas/model/node'
import { NODE_MINIMUMS } from '../../../domain/canvas/layout/constants'
import { createId } from '../../../shared/id'
import styles from './LogPanel.module.css'

/**
 * 日志面板（产品文档 §6.18）：顶栏「日志」打开的浮层，按项目倒序列出 RunRecord。
 * 每条：上排胶囊（状态 / 平台 / 模型 / 时长）+ 粗体日期与输出信息 + 提示词小字
 * + 右侧缩略图与「发送到画布」。提示词点击复制并显示「已复制」微标（1.5s 淡出）。
 * 日志按项目隔离、可清空；数据源为 runRecords 表（写入由 runEngine 的 node.runRecord.append 完成）。
 */
export function LogPanel({ onClose }: { onClose: () => void }) {
  const platform = usePlatform()
  const channels = useChannels()
  const store = useCanvasStore()
  const projectId = store.getSnapshot().projectId

  const [records, setRecords] = useState<RunRecord[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const rows = await platform.storage.query('runRecords', { projectId })
    const list = (rows as unknown as RunRecord[]).slice().sort((a, b) => b.createdAt - a.createdAt)
    setRecords(list)
  }, [platform, projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  // 面板打开期间图有变更（新生成写回）时刷新列表
  useEffect(() => {
    let last = store.getSnapshot()
    return store.subscribe(() => {
      const g = store.getSnapshot()
      if (g === last) return
      last = g
      void reload()
    })
  }, [store, reload])

  const copy = async (id: string, text: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  }

  /** 在当前视口中心生成一个图片节点并填充内容与提示词（§6.18「发送到画布」） */
  const sendToCanvas = (rec: RunRecord) => {
    const params = rec.params as GenerationData
    const vp = store.getViewport()
    const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
    const rect = el?.getBoundingClientRect()
    const cx = rect ? (rect.width / 2) / vp.zoom + vp.x : 0
    const cy = rect ? (rect.height / 2) / vp.zoom + vp.y : 0
    const min = NODE_MINIMUMS.generation
    const id = createId('node')
    store.dispatch({
      kind: 'node.create',
      projectId,
      type: 'generation',
      id,
      at: { x: cx - min.w / 2, y: cy - min.h / 2 },
      data: {
        ...params,
        assetHash: rec.outputHashes[0],
        thumbOrder: rec.outputHashes,
      },
    })
    store.setSelection([id])
  }

  const clear = async () => {
    for (const r of records) await platform.storage.delete('runRecords', r.id)
    setRecords([])
  }

  const channelName = (chId: string) =>
    channels.getState().channels.find((c) => c.id === chId)?.name ?? chId ?? '未知平台'

  return (
    <div className={styles.overlay} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="日志面板">
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>日志</span>
          <span className={styles.count}>{records.length} 条</span>
          <button className={styles.ghostBtn} onClick={() => void clear()} disabled={records.length === 0}>
            清空
          </button>
          <button className={styles.ghostBtn} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className={styles.list}>
          {records.length === 0 ? (
            <div className={styles.empty}>还没有生成记录</div>
          ) : (
            records.map((r) => (
              <LogRow
                key={r.id}
                record={r}
                /**
                 * 渠道名按**实际发出**的那条取（M7-3）：选路后可能换了渠道。
                 * 老记录没有 `sentChannelId` → 回落到 params（节点意图），
                 * 与加此字段前完全一致。
                 */
                channelName={channelName(
                  r.sentChannelId ?? (r.params as GenerationData).channelId,
                )}
                copied={copiedId === r.id}
                onCopy={() => void copy(r.id, (r.params as GenerationData).prompt ?? '')}
                onSend={() => sendToCanvas(r)}
                onOpenThumb={() => {
                  const hash = r.outputHashes[0]
                  if (hash) store.openLightbox(hash)
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function LogRow({
  record,
  channelName,
  copied,
  onCopy,
  onSend,
  onOpenThumb,
}: {
  record: RunRecord
  channelName: string
  copied: boolean
  onCopy: () => void
  onSend: () => void
  onOpenThumb: () => void
}) {
  const params = record.params as GenerationData
  const thumbUrl = useAsset(record.outputHashes[0])
  const ok = record.status === 'succeeded'
  const seconds = (record.durationMs / 1000).toFixed(1)
  // §6.18「请求1024x1024  实际1024x1024」：未知即不显示（不显示 0x0、也不拿一侧顶另一侧）
  const pixels = pixelSummaryOf(record)
  /**
   * 显示**实际发出**的模型（M7-3）：选路后它已换成该渠道的上游 ID。
   * 老记录没有 `sentModel` → 回落到 `params.model`（逻辑名），行为不变。
   */
  const shownModel = record.sentModel ?? params.model ?? ''

  return (
    <div className={styles.record}>
      <div className={styles.recordMain}>
        <div className={styles.caps}>
          <span className={`${styles.cap} ${ok ? styles.capOk : styles.capFail}`}>
            {statusLabel(record.status)}
          </span>
          <span className={styles.cap}>{channelName}</span>
          <span className={styles.cap} data-log-model>
            {shownModel || '—'}
          </span>
          <span className={styles.cap}>{seconds}s</span>
        </div>
        <div className={styles.meta}>
          <b>{formatLogTime(record.createdAt)}</b>
          <span> · 输出 {record.outputHashes.length} 个</span>
          {pixels && (
            <span data-log-pixels>
              {' · '}
              {pixels}
            </span>
          )}
        </div>
        {params.prompt && (
          <div className={styles.promptText} title="点击复制提示词" onClick={onCopy}>
            {params.prompt}
          </div>
        )}
        {copied && <span className={styles.copied}>已复制</span>}
      </div>
      <div className={styles.recordSide}>
        {thumbUrl && (
          // §6.18「缩略图交互：点击进入灯箱」——改成按钮以便键盘可达（无障碍 §4.5）
          <button
            type="button"
            className={styles.thumb}
            data-log-thumb
            title="点击放大查看"
            aria-label="放大查看结果"
            onClick={onOpenThumb}
          >
            <img src={thumbUrl} alt="" />
          </button>
        )}
        <button className={styles.sendBtn} onClick={onSend} disabled={record.outputHashes.length === 0}>
          发送到画布
        </button>
      </div>
    </div>
  )
}

/** 日志记录状态徽标文案（产品文档 §6.18 上排胶囊） */
export function statusLabel(status: RunRecord['status']): string {
  switch (status) {
    case 'succeeded':
      return '成功'
    case 'canceled':
      return '已取消'
    case 'interrupted':
      return '已中断'
    default:
      return '失败'
  }
}

/** 日志时间格式：`YYYY/MM/DD HH:mm:ss`（产品文档 §6.18） */
export function formatLogTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
