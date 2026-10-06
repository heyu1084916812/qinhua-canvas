import { useCallback, useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository } from '../../state/project/repository'
import styles from './StoragePanel.module.css'

/**
 * 「全局设置 → 存储」面板（用户 2026-10-06 定，对账 #261）。
 *
 * ## 为什么是这些、不是参考图里那些
 *
 * 用户拿来的参考图里有六项，我逐条评估后**只做其中四项**（用户认可）：
 *  - ✅ **存储概况**（数量 / 占用 / 位置）—— 让用户知道"我的东西在哪、占多少"；
 *  - ✅ **打开数据目录** —— 我们没给"改数据目录"的 UI（它是编译期规则，见桌面方案 §5.11），
 *    所以至少要让人**找得到**它；
 *  - ✅ **清网页缓存** —— 这是真的会涨的（实测一次开发使用就 13.7 MB 的 Cache），
 *    而它清掉**没有任何副作用**（WebView2 会重建）；
 *  - ✅ **素材文件夹**（当前目录 / 换位置 / 打开）—— 这条与画布 HUD 上那三个按钮同源，
 *    只是把入口也放到设置里（用户不用先回画布才能改）；
 *  - ❌ **自动保存开关**：**不做**。我们本来就是自动保存（防抖 800ms 落库 + 关闭时强制落一次），
 *    给一个开关只会制造"忘了打开 = 丢了"的事故 —— 那是把默认做对的事又开个口子。
 *
 * ⚠️ 与 `updater` 同一口径：**数据目录 / 网页缓存这两块只有桌面壳能做**
 * （浏览器里没有"目录"这回事）⇒ 没有 `storageAdmin` 端口时，如实说"仅在桌面应用可用"，
 * **不装作没这个功能、也不报错**。
 */
export function StoragePanel() {
  const platform = usePlatform()
  const admin = platform.storageAdmin
  const folder = platform.assetFolder

  const [counts, setCounts] = useState<{ projects: number; assets: number; saved: number } | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [dataDir, setDataDir] = useState<string>('')
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [folderPath, setFolderPath] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  /** 数一遍：项目走仓储（轻），素材与收藏走 `scan`（流式，别把整表拉进内存）。 */
  const refresh = useCallback(async () => {
    const repo = createProjectRepository(platform.storage)
    const projects = (await repo.list()).length
    const countRows = async (table: 'assets' | 'assetLibrary') => {
      const scan = platform.storage.scan?.bind(platform.storage)
      if (!scan) return (await platform.storage.query(table, {})).length
      let total = 0
      await scan(table, 50, async (rows: unknown[]) => {
        total += rows.length
      })
      return total
    }
    const [assets, saved] = await Promise.all([countRows('assets'), countRows('assetLibrary')])
    setCounts({ projects, assets, saved })
    setUsage(await platform.storage.estimateUsage())
    if (admin) {
      setDataDir(await admin.dataDir())
      setCacheBytes(await admin.cacheUsage())
    }
    if (folder?.supported) {
      // 端口只暴露**目录名**（浏览器拿不到路径）；路径只用来"在资源管理器里打开"
      setFolderPath(folder.current()?.name ?? '')
    }
  }, [platform, admin, folder])

  useEffect(() => {
    void refresh().catch((err: unknown) => setStatus(`读取失败：${String(err)}`))
  }, [refresh])

  const pickFolder = async () => {
    if (!folder) return
    setBusy(true)
    try {
      const dir = await folder.pick()
      setFolderPath(dir?.name ?? '')
      setStatus(dir ? `素材文件夹已切到「${dir.name}」` : '已取消')
    } catch (err) {
      setStatus(`选择失败：${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

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

  return (
    <div className={styles.panel} data-storage-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>存储概况</h3>
        <p className={styles.desc}>
          项目、素材与素材库都在应用自己的库里（不是散落的文件）。<strong>自动保存</strong>：每次改动
          约 0.8 秒后落库，关掉窗口前再强制落一次 —— 不需要手动保存。
        </p>
        <div className={styles.facts}>
          <span data-storage-count="projects">项目 {counts ? counts.projects : '…'}</span>
          <span data-storage-count="assets">素材 {counts ? counts.assets : '…'}</span>
          <span data-storage-count="saved">收藏 {counts ? counts.saved : '…'}</span>
          <span>估算占用 {usage ? formatBytes(usage.used) : '…'}</span>
        </div>
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>数据目录</h3>
        <p className={styles.desc}>
          项目、令牌与素材库所在的位置。安装时若把程序装在自己挑的目录里，数据就在
          <strong>程序隔壁的 data\ 目录</strong>；装在默认位置则用系统的用户目录。
          卸载<strong>不会</strong>删它。
        </p>
        {admin ? (
          <>
            <code className={styles.path} data-storage-data-dir>
              {dataDir || '…'}
            </code>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                data-storage-open-dir
                disabled={busy || !dataDir}
                onClick={() => {
                  void admin.openDir(dataDir).catch((err: unknown) => setStatus(`打不开：${String(err)}`))
                }}
              >
                打开数据目录
              </button>
            </div>
          </>
        ) : (
          <p className={styles.only} data-storage-desktop-only>
            仅在桌面应用可用（浏览器里数据存在浏览器自己的库里，没有"目录"可打开）
          </p>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>网页缓存</h3>
        <p className={styles.desc}>
          应用外壳（WebView2）的临时缓存。清掉它<strong>不会</strong>影响项目与素材 ——
          下次用到时会自动重建，只是第一次稍慢。
        </p>
        {admin ? (
          <>
            <div className={styles.facts}>
              <span data-storage-cache>当前 {cacheBytes === null ? '…' : formatBytes(cacheBytes)}</span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                data-storage-clear-cache
                disabled={busy}
                onClick={() => void clearCache()}
              >
                清理网页缓存
              </button>
            </div>
          </>
        ) : (
          <p className={styles.only}>仅在桌面应用可用</p>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>素材文件夹</h3>
        <p className={styles.desc}>
          选一个目录后，新素材会<strong>同时</strong>在库里和那个目录各存一份（文件名是内容哈希，重复导入
          不会重复落盘）。换机器或想用资源管理器直接看，就走它。
        </p>
        {folder?.supported ? (
          <>
            <code className={styles.path} data-storage-asset-dir>
              {folderPath || '（未选择：素材只存在库里）'}
            </code>
            <div className={styles.actions}>
              <button type="button" className={styles.btn} disabled={busy} onClick={() => void pickFolder()}>
                {folderPath ? '更换位置' : '选择素材文件夹'}
              </button>
              {/* 「打开」只有桌面壳能给：浏览器拿不到目录路径（端口 `path?()` 是壳专属） */}
              {folder.path && admin ? (
                <button
                  type="button"
                  className={styles.btn}
                  disabled={busy || !folder.path()}
                  onClick={() => {
                    const target = folder.path?.() ?? ''
                    void admin
                      .openDir(target)
                      .catch((err: unknown) => setStatus(`打不开：${String(err)}`))
                  }}
                >
                  打开文件夹
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className={styles.only}>当前环境不支持选择素材文件夹</p>
        )}
      </section>

      {status && (
        <p className={styles.status} role="status" data-storage-status>
          {status}
        </p>
      )}
    </div>
  )
}

/** 人类可读的字节数。单独一个纯函数，方便以后单测（不进 i18n，本项目只有中文）。 */
export function formatBytes(bytes: number): string {
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
