import { useCallback, useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository } from '../../state/project/repository'
import { useAssetFolderActions } from '../canvas/useAssetFolderActions'
import styles from './StoragePanel.module.css'

/**
 * 「全局设置 → 存储」面板（用户 2026-10-06 定，对账 #261 / #285 / #293）。
 *
 * ## 四块，每一块都回答一个用户真的会问的问题
 *
 *  - **存储概况**：我的东西有多少、占多大；
 *  - **数据目录**：它们在哪（并且**找得到** —— 我们没给"改数据目录"的 UI，它是编译期规则）；
 *  - **网页缓存**：那堆能清的东西是什么、清了**有没有用**；
 *  - **素材文件夹**：素材除了在库里，还能在哪有一个副本（导出 / 备份 / 换机器）。
 *
 * ## 两条口径
 *
 * 1. **桌面专属的项也显示出来**（用户 2026-10-06 第 5 条：「不管是桌面才可以用的，
 *    但是 UI 需要给我显示出来」）—— 浏览器里给出"仅在桌面应用可用"的说明，
 *    而不是把整块删掉（删掉的话用户根本不知道有这个能力）。
 * 2. **"清理"要如实说清有什么用**（用户追问过「那那个清理缓存不就对我的画布没啥用吗？」）——
 *    答案就是"没用，它只省磁盘、不会更快"，所以下面那段文字**不写"加速/优化"**
 *    （实测：Cache 48.9MB + Code Cache 19.5MB + GPUCache 1.6MB ≈ 70MB 系统垃圾，
 *    而真正占地方的 91.8MB 是数据库里的素材字节，那属于**数据**，不在这一块清）。
 */
export function StoragePanel() {
  const platform = usePlatform()
  const admin = platform.storageAdmin
  /** 素材文件夹动作（选择并同步 / 只换位置 / 打开 / 导出）——与画布右键那条「从素材文件夹加载」同一份实现 */
  const folderActions = useAssetFolderActions()

  const [counts, setCounts] = useState<{ projects: number; assets: number; saved: number } | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [dataDir, setDataDir] = useState<string>('')
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
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

  return (
    <div className={styles.panel} data-storage-panel>
      {/*
        用户 2026-10-08 第 4 条：「存储面板也是介绍文字这么多，我也是只需要有用的，
        无用的文字介绍都给我删掉，帮我重排一下 ui」。

        于是四块的写法统一成「**标题 + 数字 / 路径 + 按钮**」这种一行一式：
        原来的四段解释（每段三四行）全部撤掉，只留**真的会影响决策**的那一两句，
        压成 `.caption` 的小字贴在动作旁边（卸载不删数据 / 清缓存不动项目 / 素材怎么放回画布）。
      */}
      <section className={styles.block}>
        <h3 className={styles.title}>存储概况</h3>
        <div className={styles.facts}>
          <span data-storage-count="projects">项目 {counts ? counts.projects : '…'}</span>
          <span data-storage-count="assets">素材 {counts ? counts.assets : '…'}</span>
          <span data-storage-count="saved">收藏 {counts ? counts.saved : '…'}</span>
          <span data-storage-count="used">占用 {usage ? formatBytes(usage.used) : '…'}</span>
        </div>
        <p className={styles.caption}>自动保存：改动约 0.8 秒后落库，关窗前再落一次</p>
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>数据目录</h3>
        {admin ? (
          <>
            <div className={styles.line}>
              <code className={styles.path} data-storage-data-dir>
                {dataDir || '…'}
              </code>
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
            <p className={styles.caption}>项目、令牌与素材库都在这里；卸载不会删它</p>
          </>
        ) : (
          <p className={styles.only} data-storage-desktop-only>
            仅在桌面应用可用（浏览器里数据存在浏览器自己的库里，没有"目录"可打开）
          </p>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>网页缓存</h3>
        {/*
          ⚠️ 「只省磁盘」这句**不能改成"加速 / 优化"**：清了不会更快（下次用到还会重建，
          第一次反而更慢）。它唯一的好处是省磁盘与清掉"更新之后界面还是旧的"这类残留。
          用户专门追问过这一条（「那那个清理缓存不就对我的画布没啥用吗？」），
          所以这句压成一行小字也要留着 —— 它直接决定用户按不按这个按钮。
        */}
        {admin ? (
          <>
            <div className={styles.line}>
              <span className={styles.fact} data-storage-cache>
                当前 {cacheBytes === null ? '…' : formatBytes(cacheBytes)}
              </span>
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
            <p className={styles.caption}>只省磁盘，不会让应用变快；不动项目、素材与令牌</p>
          </>
        ) : (
          <p className={styles.only}>仅在桌面应用可用</p>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>素材文件夹</h3>
        {folderActions.canPick ? (
          <>
            <div className={styles.line}>
              <code className={styles.path} data-storage-asset-dir>
                {folderActions.folderName || '（未选择：素材只存在库里）'}
              </code>
              <button
                type="button"
                className={styles.btn}
                data-storage-pick-and-sync
                disabled={busy || folderActions.exporting !== null}
                onClick={() => void folderActions.pickAndSync().then(setStatus)}
              >
                {folderActions.exporting
                  ? `同步中 ${folderActions.exporting.done}/${folderActions.exporting.total}…`
                  : folderActions.folderName
                    ? '更换并同步'
                    : '选择并同步素材'}
              </button>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                data-storage-pick-folder
                disabled={busy || folderActions.exporting !== null}
                title="只记住新位置，不复制现有素材"
                onClick={() => void folderActions.pick().then(setStatus)}
              >
                只换位置
              </button>
              <button
                type="button"
                className={styles.btn}
                data-storage-open-folder
                onClick={() => void folderActions.openFolder().then(setStatus)}
              >
                打开文件夹
              </button>
              {/*
                「导出素材到文件夹」从画布状态条搬到这里（用户 2026-10-06 第 13 条：
                状态条只留节点数与缩放）—— 它本来就是"把库写一份到磁盘"的存储动作。
              */}
              <button
                type="button"
                className={styles.btn}
                data-storage-export-assets
                disabled={busy || !folderActions.folderName || folderActions.exporting !== null}
                onClick={() => void folderActions.exportAll().then(setStatus)}
              >
                {folderActions.exporting
                  ? `导出中 ${folderActions.exporting.done}/${folderActions.exporting.total}…`
                  : '导出素材到文件夹'}
              </button>
            </div>
            <p className={styles.caption}>放回画布：画布空白处右键 → 从素材文件夹加载</p>
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
