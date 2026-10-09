import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  describeBackup,
  exportFullBackup,
  importBackupFromPicker,
  type BackupProgress,
} from '../../state/project/backupIo'
import styles from './BackupPanel.module.css'
import { createSnapshotStore } from '../../state/project/snapshotStore'
import { describeSnapshot, SNAPSHOT_KEEP_CHOICES, type ProjectSnapshot } from '../../domain/project/snapshot'

/**
 * 「备份与恢复」面板（用户 2026-10-09，对账 #378 A2/A5）。
 *
 * ## 为什么这一栏值得单开（而不是塞进"存储"）
 *
 * 「存储」回答"东西在哪"（目录 / 缓存 / 素材文件夹）；
 * 「备份与恢复」回答"**出事怎么办**"（换机器、重装、改坏了想回去）。
 * 两件事的紧急程度不同：前者是日常，后者是救命，混在一起会被日常项淹没。
 *
 * ## 界面上三句必须写清的话
 *
 * 1. **凭据不在备份里**：令牌用本机密钥加密，换机解不开 —— 换机器要重填一次；
 * 2. **导入是合并、不是清库**：同 id 覆盖 / 补缺，不会把你现在的项目删掉；
 * 3. **这是全量备份**，与"导出单个项目"不是一回事（项目导出在项目卡片的菜单里）。
 */
export function BackupPanel() {
  const platform = usePlatform()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [status, setStatus] = useState('')
  const [includeFonts, setIncludeFonts] = useState(true)
  const [strategy, setStrategy] = useState<'merge' | 'skip'>('merge')
  /** 导入完成后的摘要（让用户看到"到底导进来什么"） */
  const [lastImport, setLastImport] = useState('')
  /** 项目快照列表（对账 #378 A4）：按项目分组展示 */
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([])
  const [snapBusy, setSnapBusy] = useState(false)

  // 每个 platform 只建一次（否则每次渲染都是新对象，下面的 effect 会反复跑）
  const snapshotStore = useMemo(() => createSnapshotStore(platform.storage), [platform])

  const refreshSnapshots = useCallback(async () => {
    setSnapshots(await snapshotStore.list())
  }, [snapshotStore])

  useEffect(() => {
    void refreshSnapshots().catch(() => {
      // 读不到快照不影响备份栏的其他功能，静默即可（界面会显示 0 份）
    })
  }, [refreshSnapshots])

  /** 手动拍一张（自动快照每天会自己跑，这个按钮是"我现在就想存一份"） */
  const captureNow = async () => {
    if (snapBusy) return
    setSnapBusy(true)
    setStatus('')
    try {
      const projects = (await platform.storage.query('projects', {})) as unknown as {
        id: string
        deletedAt?: number
      }[]
      const alive = projects.filter((p) => !p.deletedAt)
      let n = 0
      for (const p of alive) {
        const snap = await snapshotStore.capture(p.id)
        if (snap) n += 1
      }
      await refreshSnapshots()
      setStatus(n > 0 ? `已为 ${n} 个项目拍下快照` : '没有需要拍的项目（空项目不会拍）')
    } catch (err) {
      setStatus(`拍快照失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSnapBusy(false)
    }
  }

  const restoreSnapshot = async (id: string) => {
    if (snapBusy) return
    setSnapBusy(true)
    try {
      await snapshotStore.restore(id)
      setStatus('已还原到这份快照（画布回到那一刻；运行日志保留）')
      await refreshSnapshots()
    } catch (err) {
      setStatus(`还原失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSnapBusy(false)
    }
  }

  const removeSnapshot = async (id: string) => {
    await snapshotStore.remove(id)
    await refreshSnapshots()
  }

  const runExport = async () => {
    if (busy) return
    setBusy(true)
    setStatus('')
    setLastImport('')
    try {
      const result = await exportFullBackup(platform, {
        includeFonts,
        onProgress: setProgress,
      })
      setStatus(
        `已导出「${result.fileName}」：${describeBackup(result.manifest)}（${formatBytes(result.bytes)}）`,
      )
    } catch (err) {
      setStatus(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runImport = async () => {
    if (busy) return
    setBusy(true)
    setStatus('')
    setLastImport('')
    try {
      const result = await importBackupFromPicker(platform, {
        strategy,
        onProgress: setProgress,
      })
      if (!result) {
        setStatus('已取消')
      } else {
        setLastImport(
          `导入完成：写入 ${result.written} 行` +
            (result.skipped > 0 ? `，跳过 ${result.skipped} 行（库里已有）` : '') +
            `。${describeBackup(result.manifest)}`,
        )
        setStatus(
          '导入完成。若项目列表没变化，说明这些项目本来就在库里（同 id 视为同一个项目）。',
        )
      }
    } catch (err) {
      setStatus(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className={styles.panel} data-backup-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>自动快照</h3>
        <p className={styles.caption}>
          每个项目每天自动留一份<strong>图数据</strong>（不含素材字节 —— 素材本身只增不改，是天然的历史）。
          改坏了想退回昨天，从下面这份清单里挑一张还原即可。默认最多保留 7 份。
        </p>
        <div className={styles.row}>
          <span className={styles.label}>
            已有的快照
            <span className={styles.sub}>
              {snapshots.length > 0 ? `${snapshots.length} 份` : '还没有（打开应用后会自动拍）'} ·
              保留 {SNAPSHOT_KEEP_CHOICES[1]} 份
            </span>
          </span>
          <button
            type="button"
            className={styles.btn}
            data-snapshot-capture
            disabled={snapBusy}
            onClick={() => void captureNow()}
          >
            现在拍一张
          </button>
        </div>
        {snapshots.length > 0 && (
          <ul className={styles.snapList}>
            {snapshots.slice(0, 20).map((s) => (
              <li key={s.id} className={styles.snapItem} data-snapshot-item={s.id}>
                <span className={styles.snapText}>{describeSnapshot(s)}</span>
                <button
                  type="button"
                  className={styles.btn}
                  data-snapshot-restore={s.id}
                  disabled={snapBusy}
                  onClick={() => void restoreSnapshot(s.id)}
                >
                  还原
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  data-snapshot-remove={s.id}
                  onClick={() => void removeSnapshot(s.id)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>全量备份</h3>
        <p className={styles.caption}>
          一次带走整库：项目、节点、素材字节、素材库收藏、技能、自建协议、预设、自定义字体。
          这是"换机器 / 重装系统"用的兜底，与项目卡片里的「导出项目」不是一回事。
        </p>

        <div className={styles.row}>
          <span className={styles.label}>包含自定义字体</span>
          <button
            type="button"
            role="switch"
            aria-checked={includeFonts}
            className={includeFonts ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
            data-backup-include-fonts
            onClick={() => setIncludeFonts((v) => !v)}
          >
            <span className={styles.knob} />
          </button>
        </div>
        <p className={styles.note}>
          字体文件可能有好几 MB；不带的话，换机器后字体要重新导入（其余数据不受影响）。
        </p>

        <div className={styles.row}>
          <span className={styles.label}>
            令牌不进备份
            <span className={styles.sub}>
              令牌用本机密钥加密，换台机器解不开 —— 备份里<strong>不包含</strong>它，换机后要重填一次
            </span>
          </span>
        </div>

        <button type="button" className={styles.primary} data-backup-export disabled={busy} onClick={() => void runExport()}>
          {busy && progress?.label !== '写入' ? '正在导出…' : '导出全量备份'}
        </button>
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>从备份恢复</h3>
        <p className={styles.caption}>
          导入是<strong>合并</strong>，不会清空现有数据：同一个 id 视为同一条数据。
          需要"回到某个备份"时，导入后手动删掉不要的项目即可（项目卡片支持批量删除）。
        </p>

        <div className={styles.row}>
          <span className={styles.label}>遇到同一条数据时</span>
          <div className={styles.seg} role="radiogroup" aria-label="导入策略">
            <button
              type="button"
              role="radio"
              aria-checked={strategy === 'merge'}
              className={strategy === 'merge' ? `${styles.segItem} ${styles.segOn}` : styles.segItem}
              data-backup-strategy="merge"
              onClick={() => setStrategy('merge')}
            >
              用备份覆盖
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={strategy === 'skip'}
              className={strategy === 'skip' ? `${styles.segItem} ${styles.segOn}` : styles.segItem}
              data-backup-strategy="skip"
              onClick={() => setStrategy('skip')}
            >
              保留本机的
            </button>
          </div>
        </div>

        <button type="button" className={styles.btn} data-backup-import disabled={busy} onClick={() => void runImport()}>
          选择备份文件导入…
        </button>
      </section>

      {progress && (
        <section className={styles.block} data-backup-progress>
          <p className={styles.caption}>
            {progress.label}（{progress.done}/{progress.total}）
          </p>
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </section>
      )}

      {status && (
        <section className={styles.block}>
          <p className={styles.status} role="status" data-backup-status>
            {status}
          </p>
          {lastImport && (
            <p className={styles.status} data-backup-import-summary>
              {lastImport}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

/** 人类可读的字节数（与存储面板同一口径） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
