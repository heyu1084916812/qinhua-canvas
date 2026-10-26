import { useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  describeBackup,
  exportFullBackup,
  importBackupFromPicker,
  type BackupProgress,
} from '../../state/project/backupIo'
import styles from './BackupPanel.module.css'
import { SettingsRow } from './SettingsRow'

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
  /** 共享权威库位置（对账 #571；浏览器端没有这一项入口） */
  const [profileBackup, setProfileBackup] = useState<{ dir: string; keep: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const info = await platform.storageAdmin?.profileBackupInfo?.()
        if (!cancelled && info) setProfileBackup(info)
      } catch {
        // 壳端能力探测失败不影响其他备份功能
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platform])

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
    <div className={styles.panel} data-backup-panel data-settings-panel>
      {profileBackup ? (
        <section className={styles.block}>
          <h3 className={styles.title}>共享权威库</h3>
          <p className={styles.caption}>调试壳、release 壳与浏览器共用，实时写入。</p>
          <div data-profile-backup>
            <SettingsRow
              label="数据目录"
              description={profileBackup.dir}
              control={
                <button
                  type="button"
                  className={styles.btn}
                  data-profile-backup-open
                  onClick={() => void platform.storageAdmin?.openDir(profileBackup.dir)}
                >
                  打开共享库目录
                </button>
              }
            />
          </div>
        </section>
      ) : null}

      <section className={styles.block}>
        <h3 className={styles.title}>全量备份</h3>
        <p className={styles.caption}>包含项目、素材、技能、协议与预设。</p>

        <SettingsRow
          label="包含自定义字体"
          description="不包含字体时，换机后需重新导入。"
          control={
            <button
              type="button"
              role="switch"
              aria-label="备份中包含自定义字体"
              aria-checked={includeFonts}
              className={includeFonts ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
              data-backup-include-fonts
              onClick={() => setIncludeFonts((v) => !v)}
            >
              <span className={styles.knob} />
            </button>
          }
        />

        <SettingsRow
          label="导出全量备份"
          description="令牌使用本机密钥加密，不进入备份。"
          control={
            <button
              type="button"
              className={styles.primary}
              data-backup-export
              disabled={busy}
              onClick={() => void runExport()}
            >
              {busy && progress?.label !== '写入' ? '正在导出…' : '选择位置并导出'}
            </button>
          }
        />
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>从备份恢复</h3>
        <p className={styles.caption}>合并导入，不覆盖现有数据。</p>

        <SettingsRow
          label="遇到同一条数据时"
          description="同一 id 的数据可按备份覆盖，或保留本机版本。"
          control={
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
          }
        />

        <SettingsRow
          label="选择备份文件"
          description="仅合并导入，不覆盖当前已有项目。"
          control={
            <button
              type="button"
              className={styles.btn}
              data-backup-import
              disabled={busy}
              onClick={() => void runImport()}
            >
              选择备份文件导入…
            </button>
          }
        />
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
