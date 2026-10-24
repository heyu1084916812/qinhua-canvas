import { useCallback, useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { StoragePort } from '../../platform/ports'
import { useAssetFolderActions } from '../canvas/useAssetFolderActions'
import styles from './StoragePanel.module.css'

/**
 * 「全局设置 → 存储」面板（对账 #261 / #285 / #293 / #740）。
 *
 * 布局借了「资源位置 + 使用情况 + 维护动作」这套成熟心智，但不改变数据所有权：
 *
 *  - 应用数据目录是权威库，可选择新目录并打开，切换在下次启动生效；
 *  - 生成文件目录是用户可替换的本地副本，新素材落库后自动镜像到这里；
 *  - 网页缓存只省磁盘，不承担素材或项目存储。
 *
 * 生成文件目录必须显示完整绝对路径（桌面壳），用户才能确认自己换到哪。
 * 浏览器拿不到绝对路径，此时只显示目录名，并明确说明打开能力仅在桌面版可用。
 */
export function StoragePanel() {
  const platform = usePlatform()
  const admin = platform.storageAdmin
  const folderActions = useAssetFolderActions()

  const [counts, setCounts] = useState<{ projects: number; assets: number; saved: number } | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [dataDir, setDataDir] = useState<string>('')
  const [pendingDataDir, setPendingDataDir] = useState<string>('')
  const [switchingDir, setSwitchingDir] = useState(false)
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  /** 概况只读计数，不展开项目封面、节点、运行记录或素材正文。 */
  const refresh = useCallback(async () => {
    const [projects, assets, saved] = await Promise.all([
      countStorageProjects(platform.storage),
      countStorageRows(platform.storage, 'assets'),
      countStorageRows(platform.storage, 'assetLibrary'),
    ])
    setCounts({ projects, assets, saved })
    setUsage(await platform.storage.estimateUsage())
    if (admin) {
      setDataDir(await admin.dataDir())
      setCacheBytes(await admin.cacheUsage())
    }
  }, [platform, admin])

  useEffect(() => {
    void refresh().catch((err: unknown) => setStatus(`读取失败：${String(err)}`))
  }, [refresh])

  const clearCache = async () => {
    if (!admin) return
    setBusy(true)
    try {
      const freed = await admin.clearCache()
      setCacheBytes(await admin.cacheUsage())
      setStatus(`已清理网页缓存 ${formatBytes(freed)}（正在使用中的文件下次会一起清掉）`)
    } catch (err) {
      setStatus(`清理失败：${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const setFolder = async () => {
    setStatus(await folderActions.pick())
  }

  const chooseDataDir = async () => {
    if (!admin?.pickDataDir) return
    try {
      const next = await admin.pickDataDir()
      if (!next) return
      if (next === dataDir) {
        setStatus('当前已经使用这个数据目录')
        return
      }
      setPendingDataDir(next)
      setStatus('')
    } catch (err) {
      setStatus(`选择数据目录失败：${String(err)}`)
    }
  }

  const applyDataDir = async () => {
    if (!admin?.setDataDir || !pendingDataDir) return
    setSwitchingDir(true)
    try {
      const saved = await admin.setDataDir(pendingDataDir)
      setPendingDataDir('')
      setStatus(`数据目录已保存为「${saved}」，关闭并重新打开轻画后生效`)
    } catch (err) {
      setStatus(`切换数据目录失败：${String(err)}`)
    } finally {
      setSwitchingDir(false)
    }
  }

  const usagePercent = storageUsagePercent(usage)
  const generatedPath = folderActions.folderPath
  const generatedName = folderActions.folderName
  const canOpenGenerated = Boolean(generatedPath && admin)
  const canChangeDataDir = Boolean(admin?.pickDataDir && admin?.setDataDir)

  return (
    <div className={styles.panel} data-storage-panel>
      <section className={`${styles.block} ${styles.overview}`}>
        <div className={styles.blockHead}>
          <div>
            <h3 className={styles.title}>存储概况</h3>
            <p className={styles.caption}>自动保存：改动约 0.8 秒后落库</p>
          </div>
          <span className={styles.meta}>{usage ? formatBytes(usage.used) : '统计中…'}</span>
        </div>
        {usagePercent !== null && (
          <div
            className={styles.meter}
            role="progressbar"
            aria-label="存储空间占用"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usagePercent}
            data-storage-usage-meter
          >
            <span
              className={styles.meterFill}
              style={{ transform: `scaleX(${usagePercent / 100})` }}
            />
          </div>
        )}
        <dl className={styles.facts}>
          <div>
            <dt>项目</dt>
            <dd data-storage-count="projects">{counts ? counts.projects : '…'}</dd>
          </div>
          <div>
            <dt>素材</dt>
            <dd data-storage-count="assets">{counts ? counts.assets : '…'}</dd>
          </div>
          <div>
            <dt>收藏</dt>
            <dd data-storage-count="saved">{counts ? counts.saved : '…'}</dd>
          </div>
          <div>
            <dt>占用</dt>
            <dd data-storage-count="used">{usage ? formatBytes(usage.used) : '…'}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.titleRow}>
              <h3 className={styles.title}>应用数据目录</h3>
              <span className={styles.badge}>主库</span>
            </div>
            <p className={styles.caption}>项目数据库、生成记录与配置都在这里；卸载不会删除</p>
          </div>
          {admin && (
            <div className={styles.headActions}>
              {canChangeDataDir && (
                <button
                  type="button"
                  className={styles.btn}
                  data-storage-change-data-dir
                  disabled={busy || switchingDir}
                  onClick={() => void chooseDataDir()}
                >
                  更换目录
                </button>
              )}
              <button
                type="button"
                className={styles.btn}
                data-storage-open-dir
                disabled={busy || !dataDir}
                onClick={() => {
                  void admin.openDir(dataDir).catch((err: unknown) => setStatus(`打不开：${String(err)}`))
                }}
              >
                打开目录
              </button>
            </div>
          )}
        </div>
        {admin ? (
          <code className={`${styles.path} ${styles.pathField}`} data-storage-data-dir>
            {dataDir || '读取中…'}
          </code>
        ) : (
          <p className={styles.only} data-storage-desktop-only>
            仅在桌面应用可用。浏览器版的数据保存在浏览器自己的本地库中。
          </p>
        )}
        {pendingDataDir && (
          <div className={styles.changePanel} role="group" aria-label="确认切换数据目录">
            <div>
              <strong>下次启动使用</strong>
              <code className={styles.pendingPath} data-storage-pending-data-dir>
                {pendingDataDir}
              </code>
              <p className={styles.caption}>
                不会复制或合并当前数据；原目录保持原样，之后可再次切换回去。
              </p>
            </div>
            <div className={styles.headActions}>
              <button
                type="button"
                className={styles.btn}
                disabled={switchingDir}
                onClick={() => {
                  setPendingDataDir('')
                  setStatus('已取消切换数据目录')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                data-storage-apply-data-dir
                disabled={switchingDir}
                onClick={() => void applyDataDir()}
              >
                {switchingDir ? '正在保存…' : '保存更改'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.titleRow}>
              <h3 className={styles.title}>生成文件目录</h3>
              <span className={generatedName ? styles.badgeOn : styles.badge}>
                {generatedName ? '已连接' : '未设置'}
              </span>
            </div>
            <p className={styles.caption}>新生成的素材在落库后同步一份到这里，数据库仍是主副本</p>
          </div>
          {folderActions.canPick && (
            <div className={styles.headActions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                data-storage-pick-folder
                disabled={busy || folderActions.exporting !== null}
                onClick={() => void setFolder()}
              >
                {generatedName ? '更换位置' : '选择位置'}
              </button>
              <button
                type="button"
                className={styles.btn}
                data-storage-open-folder
                disabled={!canOpenGenerated || busy}
                title={canOpenGenerated ? '在文件管理器中打开' : '选择桌面版目录后才能打开'}
                onClick={() => void folderActions.openFolder().then(setStatus)}
              >
                打开文件夹
              </button>
            </div>
          )}
        </div>
        {folderActions.canPick ? (
          <>
            <code className={`${styles.path} ${styles.pathField}`} data-storage-folder-path>
              {generatedPath || generatedName || '尚未选择目录'}
            </code>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                data-storage-export-assets
                disabled={busy || !generatedName || folderActions.exporting !== null}
                onClick={() => void folderActions.exportAll().then(setStatus)}
              >
                {folderActions.exporting
                  ? `同步中 ${folderActions.exporting.done}/${folderActions.exporting.total}…`
                  : '同步现有素材'}
              </button>
              <span className={styles.caption}>放回画布：空白处右键 → 从素材文件夹加载</span>
            </div>
          </>
        ) : (
          <p className={styles.only}>当前环境不支持选择目录</p>
        )}
      </section>

      <section className={`${styles.block} ${styles.cacheBlock}`}>
        <div>
          <h3 className={styles.title}>网页缓存</h3>
          <p className={styles.caption}>只省磁盘，不会让应用变快；不动项目、素材与令牌</p>
        </div>
        <div className={styles.cacheAction}>
          <span className={styles.meta} data-storage-cache>
            {admin ? `当前 ${cacheBytes === null ? '…' : formatBytes(cacheBytes)}` : '仅在桌面应用可用'}
          </span>
          {admin && (
            <button
              type="button"
              className={styles.btn}
              data-storage-clear-cache
              disabled={busy}
              onClick={() => void clearCache()}
            >
              清理缓存
            </button>
          )}
        </div>
      </section>

      {status && (
        <p className={styles.status} role="status" aria-live="polite" data-storage-status>
          {status}
        </p>
      )}
    </div>
  )
}

/** 人类可读的字节数。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rendered =
    value >= 10 || unit === 0
      ? String(Math.round(value))
      : value.toFixed(1).replace(/\.0$/, '')
  return `${rendered} ${units[unit]}`
}

/**
 * 存储概况只需要行数，绝不能把素材正文一起取回来。
 * `assets` 每行都有全分辨率字节，3 GB 的库若带 payload 扫描会长期卡在“统计中…”。
 */
export async function countStorageRows(
  storage: StoragePort,
  table: 'assets' | 'assetLibrary',
): Promise<number> {
  const scan = storage.scan?.bind(storage)
  if (!scan) return (await storage.query(table, {}, { includePayload: false })).length
  let total = 0
  await scan(
    table,
    50,
    async (rows) => {
      total += rows.length
    },
    { includePayload: false },
  )
  return total
}

export async function countStorageProjects(storage: StoragePort): Promise<number> {
  const scan = storage.scan?.bind(storage)
  if (!scan) {
    return (await storage.query('projects', {}, { includePayload: false })).filter(
      (row) => !row.deletedAt,
    ).length
  }
  let total = 0
  await scan(
    'projects',
    50,
    async (rows) => {
      total += rows.filter((row) => !row.deletedAt).length
    },
    { includePayload: false },
  )
  return total
}

/** 配额未知时返回 null，不伪造进度。 */
export function storageUsagePercent(
  usage: { used: number; quota: number } | null,
): number | null {
  if (!usage || !Number.isFinite(usage.quota) || usage.quota <= 0) return null
  const percent = (usage.used / usage.quota) * 100
  if (!Number.isFinite(percent)) return null
  return Math.min(100, Math.max(0, Math.round(percent * 10) / 10))
}
