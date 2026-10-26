import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createSnapshotStore } from '../../state/project/snapshotStore'
import {
  describeSnapshot,
  SNAPSHOT_KEEP_CHOICES,
  type ProjectSnapshot,
} from '../../domain/project/snapshot'
import styles from './SnapshotsPanel.module.css'
import { SettingsRow } from './SettingsRow'

/**
 * 「数据 → 快照」面板。
 *
 * 与「备份与恢复」分工：这里只回答“项目结构回到某一时刻”，不负责全量导入导出。
 */
export function SnapshotsPanel() {
  const platform = usePlatform()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([])
  const snapshotStore = useMemo(() => createSnapshotStore(platform.storage), [platform])

  const refresh = useCallback(async () => {
    setSnapshots(await snapshotStore.list())
  }, [snapshotStore])

  useEffect(() => {
    void refresh().catch(() => {})
  }, [refresh])

  const captureNow = async () => {
    if (busy) return
    setBusy(true)
    setStatus('')
    try {
      const projects = (await platform.storage.query('projects', {})) as unknown as {
        id: string
        deletedAt?: number
      }[]
      let n = 0
      for (const project of projects.filter((p) => !p.deletedAt)) {
        if (await snapshotStore.capture(project.id)) n += 1
      }
      await refresh()
      setStatus(n > 0 ? `已为 ${n} 个项目拍下快照` : '没有需要拍的项目（空项目不会拍）')
    } catch (err) {
      setStatus(`拍快照失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const restoreSnapshot = async (id: string) => {
    if (busy) return
    setBusy(true)
    try {
      await snapshotStore.restore(id)
      setStatus('已还原到这份快照（画布回到那一刻；运行日志保留）')
      await refresh()
    } catch (err) {
      setStatus(`还原失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const removeSnapshot = async (id: string) => {
    await snapshotStore.remove(id)
    await refresh()
  }

  return (
    <div className={styles.panel} data-snapshots-panel data-backup-panel data-settings-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>自动快照</h3>
        <p className={styles.caption}>每天保存项目结构快照，默认保留 7 份。</p>
        <SettingsRow
          label="已有快照"
          description={`${snapshots.length > 0 ? `${snapshots.length} 份` : '还没有（打开应用后会自动拍）'} · 保留 ${SNAPSHOT_KEEP_CHOICES[1]} 份`}
          control={
            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              data-snapshot-capture
              disabled={busy}
              onClick={() => void captureNow()}
            >
              现在拍一张
            </button>
          }
        />
        {snapshots.length > 0 ? (
          <ul className={styles.snapList}>
            {snapshots.slice(0, 20).map((snapshot) => (
              <li key={snapshot.id} className={styles.snapItem} data-snapshot-item={snapshot.id}>
                <span className={styles.snapText}>{describeSnapshot(snapshot)}</span>
                <button
                  type="button"
                  className={styles.btn}
                  data-snapshot-restore={snapshot.id}
                  disabled={busy}
                  onClick={() => void restoreSnapshot(snapshot.id)}
                >
                  还原
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  data-snapshot-remove={snapshot.id}
                  onClick={() => void removeSnapshot(snapshot.id)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {status ? (
          <p className={styles.status} data-snapshot-status>
            {status}
          </p>
        ) : null}
      </section>
    </div>
  )
}
