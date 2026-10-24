import { useCallback, useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type {
  StorageMigrationReport,
  StoragePort,
  StorageRootInfo,
} from '../../platform/ports'
import {
  backfillAssetPreviews,
  backfillAssetThumbs,
} from '../../platform/assetThumb'
import { countAssets, type LibraryCountRow } from '../../domain/shared/assetHistory'
import { createAssetHistoryRepository } from '../../state/project/assetHistoryRepository'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import styles from './StoragePanel.module.css'

interface MediaCounts {
  images: number
  videos: number
  audio: number
  other: number
}

const EMPTY_MEDIA_COUNTS: MediaCounts = { images: 0, videos: 0, audio: 0, other: 0 }

export function StoragePanel() {
  const platform = usePlatform()
  const admin = platform.storageAdmin

  const [counts, setCounts] = useState<{ projects: number; assets: number; saved: number } | null>(
    null,
  )
  const [mediaCounts, setMediaCounts] = useState<MediaCounts>(EMPTY_MEDIA_COUNTS)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [rootInfo, setRootInfo] = useState<StorageRootInfo | null>(null)
  const [pendingDataDir, setPendingDataDir] = useState('')
  const [switchingDir, setSwitchingDir] = useState(false)
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [migrationTarget, setMigrationTarget] = useState('')
  const [migrationReport, setMigrationReport] = useState<StorageMigrationReport | null>(null)
  const [migrationPhase, setMigrationPhase] = useState<'idle' | 'validating' | 'migrating'>(
    'idle',
  )
  const [variantBusy, setVariantBusy] = useState<'thumb' | 'preview' | null>(null)
  const [variantProgress, setVariantProgress] = useState('')

  const refresh = useCallback(async () => {
    const [projects, assetCounts] = await Promise.all([
      countStorageProjects(platform.storage),
      countStorageAssets(platform.storage),
    ])
    setCounts({
      projects,
      assets: assetCounts.all,
      saved: assetCounts.saved,
    })
    setMediaCounts({
      images: assetCounts.image,
      videos: assetCounts.video,
      audio: assetCounts.audio,
      other: Math.max(0, assetCounts.all - assetCounts.image - assetCounts.video - assetCounts.audio),
    })
    setUsage(await platform.storage.estimateUsage())
    if (admin) {
      const dir = await admin.dataDir()
      setDataDir(dir)
      setRootInfo((await admin.inspectRoot?.(dir)) ?? null)
      setCacheBytes(await admin.cacheUsage())
    }
  }, [platform, admin])

  useEffect(() => {
    void refresh().catch((error: unknown) => setStatus(`读取失败：${String(error)}`))
  }, [refresh])

  const clearCache = async () => {
    if (!admin) return
    setBusy(true)
    try {
      const freed = await admin.clearCache()
      setCacheBytes(await admin.cacheUsage())
      setStatus(`已清理网页缓存 ${formatBytes(freed)}`)
    } catch (error) {
      setStatus(`清理失败：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const chooseDataDir = async () => {
    if (!admin?.pickDataDir) return
    try {
      const next = await admin.pickDataDir()
      if (!next) return
      if (next === dataDir) {
        setStatus('当前已经使用这个资源目录')
        return
      }
      const info = await admin.inspectRoot?.(next)
      if (info?.kind !== 'empty') {
        setStatus(info?.reason || '新位置必须是空目录')
        return
      }
      setPendingDataDir(next)
      setStatus('')
    } catch (error) {
      setStatus(`选择资源目录失败：${String(error)}`)
    }
  }

  const applyDataDir = async () => {
    if (!admin?.replaceDataDir || !pendingDataDir) return
    setSwitchingDir(true)
    try {
      const replaced = await admin.replaceDataDir(pendingDataDir)
      setPendingDataDir('')
      setStatus(
        replaced.sourceDeleted
          ? `资源已移动到「${replaced.targetRoot}」，正在重新载入`
          : `资源已复制并校验到「${replaced.targetRoot}」，旧位置暂未删除，正在重新载入`,
      )
      window.setTimeout(() => window.location.reload(), 500)
    } catch (error) {
      setStatus(`更换位置失败：${String(error)}`)
    } finally {
      setSwitchingDir(false)
    }
  }

  const runMigration = async (target: string, dryRun: boolean) => {
    if (!admin?.migrateDataDir || !dataDir) return
    setMigrationPhase(dryRun ? 'validating' : 'migrating')
    setMigrationReport(null)
    setStatus('')
    try {
      const report = await admin.migrateDataDir(dataDir, target, dryRun)
      setMigrationReport(report)
      if (dryRun) {
        setStatus(
          report.failures.length > 0
            ? `预检发现 ${report.failures.length} 个阻断问题`
            : '源库预检完成；确认后会开始写入新资源目录',
        )
      } else {
        await admin.setDataDir?.(target)
        setStatus('迁移与回读校验完成，资源目录已切换；重启轻画后启用 V2')
      }
    } catch (error) {
      setStatus(`${dryRun ? '预检' : '迁移'}失败：${String(error)}`)
    } finally {
      setMigrationPhase('idle')
    }
  }

  const chooseMigrationTarget = async () => {
    if (!admin?.pickDataDir || !admin.inspectRoot || !admin.migrateDataDir) return
    try {
      const next = await admin.pickDataDir()
      if (!next) return
      if (next === dataDir) {
        setStatus('迁移目标不能与当前资源目录相同')
        return
      }
      const info = await admin.inspectRoot(next)
      if (info.kind !== 'empty' && info.kind !== 'partial') {
        setStatus('迁移目标必须是空目录，或之前未完成的迁移目录')
        return
      }
      setMigrationTarget(next)
      await runMigration(next, true)
    } catch (error) {
      setStatus(`选择迁移目录失败：${String(error)}`)
    }
  }

  const rebuildVariants = async (kind: 'thumb' | 'preview') => {
    setVariantBusy(kind)
    setVariantProgress('')
    try {
      const run = kind === 'thumb' ? backfillAssetThumbs : backfillAssetPreviews
      const result = await run(platform, {
        onProgress: (done, total) => setVariantProgress(`${done}/${total}`),
      })
      setStatus(
        `${kind === 'thumb' ? '缩略图' : '预览图'}扫描 ${result.scanned} 张，补齐 ${result.generated} 张`,
      )
    } catch (error) {
      setStatus(`重建${kind === 'thumb' ? '缩略图' : '预览图'}失败：${String(error)}`)
    } finally {
      setVariantBusy(null)
      setVariantProgress('')
    }
  }

  const usagePercent = storageUsagePercent(usage)
  const canSwitchRoot = Boolean(
    admin?.pickDataDir &&
      admin?.replaceDataDir &&
      admin?.inspectRoot &&
      rootInfo?.kind === 'v2',
  )
  const canMigrate = Boolean(
    admin?.migrateDataDir && admin?.inspectRoot && rootInfo?.kind === 'v1',
  )
  const rootLabel = rootKindLabel(rootInfo)
  const migrationReady =
    migrationPhase === 'idle' &&
    migrationReport?.dryRun === true &&
    migrationReport.status === 'complete' &&
    migrationReport.failures.length === 0

  return (
    <div className={styles.panel} data-storage-panel>
      <section className={`${styles.block} ${styles.overview}`}>
        <div className={styles.blockHead}>
          <div>
            <h3 className={styles.title}>存储概况</h3>
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
        <dl className={`${styles.facts} ${styles.mediaFacts}`}>
          <div>
            <dt>图片</dt>
            <dd data-storage-media="images">{counts ? mediaCounts.images : '…'}</dd>
          </div>
          <div>
            <dt>视频</dt>
            <dd data-storage-media="videos">{counts ? mediaCounts.videos : '…'}</dd>
          </div>
          <div>
            <dt>音频</dt>
            <dd data-storage-media="audio">{counts ? mediaCounts.audio : '…'}</dd>
          </div>
          <div>
            <dt>其他</dt>
            <dd data-storage-media="other">{counts ? mediaCounts.other : '…'}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.block} data-storage-resource-root>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.titleRow}>
              <h3 className={styles.title}>资源目录</h3>
              <span className={rootInfo?.kind === 'v2' ? styles.badgeOn : styles.badge}>
                {rootLabel}
              </span>
            </div>
            <p className={styles.caption}>
              图片、视频和音频保存在 `media` 文件夹。
            </p>
          </div>
          {admin && (
            <div className={styles.headActions}>
              <button
                type="button"
                className={styles.btn}
                data-storage-open-dir
                disabled={busy || !dataDir}
                onClick={() => {
                  void admin
                    .openDir(dataDir)
                    .catch((error: unknown) => setStatus(`打不开：${String(error)}`))
                }}
              >
                打开目录
              </button>
              {canSwitchRoot && (
                <button
                  type="button"
                  className={styles.btn}
                  data-storage-change-data-dir
                  disabled={busy || switchingDir || migrationPhase !== 'idle'}
                  onClick={() => void chooseDataDir()}
                >
                  更换位置
                </button>
              )}
              {canMigrate && (
                <button
                  type="button"
                  className={styles.btn}
                  data-storage-migrate-dir
                  disabled={busy || switchingDir || migrationPhase !== 'idle'}
                  onClick={() => void chooseMigrationTarget()}
                >
                  迁移到新目录
                </button>
              )}
            </div>
          )}
        </div>
        {admin ? (
          <code className={`${styles.path} ${styles.pathField}`} data-storage-data-dir>
            {dataDir || '读取中…'}
          </code>
        ) : (
          <p className={styles.only}>
            浏览器版继续使用浏览器自己的本地库；桌面版可管理独立资源目录。
          </p>
        )}
        {rootInfo?.reason && (
          <p className={styles.caption} data-storage-root-reason>
            {rootInfo.reason}
          </p>
        )}
        {pendingDataDir && (
          <div className={styles.changePanel} role="group" aria-label="确认切换资源目录">
            <div>
              <strong>下次启动使用</strong>
              <code className={styles.pendingPath} data-storage-pending-data-dir>
                {pendingDataDir}
              </code>
              <p className={styles.caption}>
                校验通过后切换，并删除旧位置。
              </p>
            </div>
            <div className={styles.headActions}>
              <button
                type="button"
                className={styles.btn}
                disabled={switchingDir}
                onClick={() => {
                  setPendingDataDir('')
                  setStatus('已取消切换资源目录')
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
                {switchingDir ? '正在移动并校验…' : '开始更换'}
              </button>
            </div>
          </div>
        )}
      </section>

      {migrationTarget && (
        <section className={styles.block} data-storage-migration>
          <div className={styles.blockHead}>
            <div>
              <div className={styles.titleRow}>
                <h3 className={styles.title}>迁移到 V2</h3>
                <span
                  className={
                    migrationPhase === 'idle' && migrationReady
                      ? styles.badgeOn
                      : styles.badge
                  }
                >
                  {migrationPhase === 'validating'
                    ? '预检中'
                    : migrationPhase === 'migrating'
                      ? '迁移中'
                      : migrationReady
                        ? '预检通过'
                        : '待处理'}
                </span>
              </div>
              <p className={styles.caption}>V1 保持原样，校验通过后才切换。</p>
            </div>
            <div className={styles.headActions}>
              {migrationReady && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  data-storage-apply-migration
                  onClick={() => void runMigration(migrationTarget, false)}
                >
                  开始迁移并切换
                </button>
              )}
              <button
                type="button"
                className={styles.btn}
                disabled={migrationPhase !== 'idle'}
                onClick={() => {
                  setMigrationTarget('')
                  setMigrationReport(null)
                }}
              >
                收起
              </button>
            </div>
          </div>
          <code className={`${styles.path} ${styles.pathField}`}>{migrationTarget}</code>
          {migrationPhase !== 'idle' && (
            <p className={styles.caption} role="status">
              {migrationPhase === 'validating'
                ? '正在只读校验 V1，不会写入目标目录…'
                : '正在写入媒体、建立索引并逐文件回读校验；请勿关闭应用…'}
            </p>
          )}
          {migrationReport && <MigrationSummary report={migrationReport} />}
        </section>
      )}

      <section className={styles.block} data-storage-variants>
        <div className={styles.blockHead}>
          <div>
            <h3 className={styles.title}>预览缓存</h3>
            <p className={styles.caption}>缺失时自动生成。</p>
          </div>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.btn}
              data-storage-rebuild-thumbs
              disabled={variantBusy !== null || migrationPhase !== 'idle'}
              onClick={() => void rebuildVariants('thumb')}
            >
              {variantBusy === 'thumb' ? `补齐中 ${variantProgress}` : '重建缩略图'}
            </button>
            <button
              type="button"
              className={styles.btn}
              data-storage-rebuild-previews
              disabled={variantBusy !== null || migrationPhase !== 'idle'}
              onClick={() => void rebuildVariants('preview')}
            >
              {variantBusy === 'preview' ? `补齐中 ${variantProgress}` : '重建预览图'}
            </button>
          </div>
        </div>
      </section>

      <section className={`${styles.block} ${styles.cacheBlock}`}>
        <div>
          <h3 className={styles.title}>网页缓存</h3>
          <p className={styles.caption}>不会影响项目、素材和令牌。</p>
        </div>
        <div className={styles.cacheAction}>
          <span className={styles.meta} data-storage-cache>
            {admin
              ? `当前 ${cacheBytes === null ? '…' : formatBytes(cacheBytes)}`
              : '仅在桌面应用可用'}
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

function MigrationSummary({ report }: { report: StorageMigrationReport }) {
  return (
    <div className={styles.migrationSummary}>
      <dl className={`${styles.facts} ${styles.reportFacts}`}>
        <div>
          <dt>素材</dt>
          <dd>{report.assetsTotal}</dd>
        </div>
        <div>
          <dt>媒体体积</dt>
          <dd>{formatBytes(report.assetBytes)}</dd>
        </div>
        <div>
          <dt>旧格式</dt>
          <dd>{report.legacyAssets}</dd>
        </div>
        <div>
          <dt>引用</dt>
          <dd>{report.assetReferences}</dd>
        </div>
      </dl>
      <p className={styles.caption}>
        缩略图 {report.thumbFiles} / 预览图 {report.previewFiles} / 源库既有断链{' '}
        {report.sourceDanglingReferences}
      </p>
      {report.warnings.length > 0 && (
        <p className={styles.warning}>警告：{report.warnings.slice(0, 3).join('；')}</p>
      )}
      {report.failures.length > 0 && (
        <p className={styles.failure}>阻断：{report.failures.slice(0, 3).join('；')}</p>
      )}
    </div>
  )
}

export function rootKindLabel(info: StorageRootInfo | null): string {
  if (!info) return '未知'
  if (info.kind === 'v2') return 'V2'
  if (info.kind === 'v1') return 'V1'
  if (info.kind === 'empty') return '空目录'
  if (info.kind === 'partial') return '迁移未完成'
  return '不可用'
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

/** 与素材页一致：生成历史 ∪ 收藏，按素材 hash 去重。 */
export async function countStorageAssets(
  storage: StoragePort,
  now = Date.now(),
): Promise<ReturnType<typeof countAssets>> {
  const [rawHistory, rawLibrary, hidden] = await Promise.all([
    createAssetHistoryRepository(storage).list(),
    storage.query('assetLibrary', {}),
    createAssetLibraryRepository(storage).listHidden(),
  ])
  const history = rawHistory.filter(
    (item) => item.kind !== 'output' || !hidden.has(item.hash),
  )
  const library = (rawLibrary as LibraryCountRow[]).filter((row) => {
    const hash = typeof row.hash === 'string' ? row.hash : typeof row.id === 'string' ? row.id : ''
    return !hash || !hidden.has(hash)
  })
  return countAssets(history, library, now)
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
