import { useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import {
  createAssetLibraryStore,
  type AssetFilter,
} from '../../state/project/assetLibraryStore'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { AssetCard } from './AssetCard'
import { AssetPreview } from './AssetPreview'
import styles from './AssetsPage.module.css'

/**
 * 我的素材页（产品文档 §2.1 #6；路由 `/assets`）。
 *
 * 2026-09-29 从**占位页**做成真工作区。此前这里只有一句「还没开始做」，
 * 而素材本体一直是存在的（`assets` 表，内容哈希为主键）——缺的不是存储，
 * 是「把这些散落在各项目里的素材收拢起来浏览」的那一层。
 *
 * ## 本轮做与不做
 *
 * - **做**：素材库本体 —— 浏览 / 按类型与关键字筛选 / 大图预览 / 下载 / 删除，
 *   以及卡片上的「来自哪个项目」。
 * - **不做**：角色库 / 场景库。它们还没有自己的数据形态，
 *   塞一组点了没反应的假选项卡就是本项目最忌的「假功能」，故留占位说明。
 * - **不做**：插入画布。联动是下一个缺口，本轮先把素材对齐准备好
 *   （时间与来源已落到 assets 行上），画布侧的插入动作届时直接可用。
 *
 * ## 删除的语义
 *
 * 删的是 `assets` 表里那一行（字节本体就在那一行里）。**不级联清理画布节点** ——
 * 素材库没有权力改用户画布的内容。节点若仍持有这个 hash，
 * 渲染层本来就有兜底（取不到即空态，不报错）。
 */

const FILTERS: readonly { id: AssetFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
]

export function AssetsPage() {
  const platform = usePlatform()

  /** 仓储与 store 跟随页面生命周期创建一次（与项目页同一形制） */
  const repoRef = useRef<ReturnType<typeof createAssetLibraryRepository> | null>(null)
  if (!repoRef.current) repoRef.current = createAssetLibraryRepository(platform.storage)
  const storeRef = useRef<ReturnType<typeof createAssetLibraryStore> | null>(null)
  if (!storeRef.current) storeRef.current = createAssetLibraryStore(repoRef.current)
  const store = storeRef.current

  const assets = useSyncExternalStore(store.subscribe, () => store.getState().visible, () => store.getState().visible)
  const loading = useSyncExternalStore(store.subscribe, () => store.getState().loading, () => store.getState().loading)
  const query = useSyncExternalStore(store.subscribe, () => store.getState().query, () => store.getState().query)
  const filter = useSyncExternalStore(store.subscribe, () => store.getState().filter, () => store.getState().filter)
  const projectNames = useSyncExternalStore(
    store.subscribe,
    () => store.getState().projectNames,
    () => store.getState().projectNames,
  )
  /** 总量（未筛选）：计数文案要给「总共多少」，只数 visible 会让筛选后显示变成总数 */
  const total = useSyncExternalStore(store.subscribe, () => store.getState().assets.length, () => store.getState().assets.length)

  const [preview, setPreview] = useState<LibraryAsset | null>(null)
  const [menuHash, setMenuHash] = useState<string | null>(null)
  const [confirmHash, setConfirmHash] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    void store.load()
  }, [store])

  const nameOf = useMemo(
    () => (id: string | null) => (id ? projectNames.get(id) ?? '已删除的项目' : '—'),
    [projectNames],
  )

  const handleDownload = async (hash: string) => {
    setMenuHash(null)
    const res = await downloadAsset({ assets: platform.assets, files: platform.files }, hash)
    setStatus(
      res.ok
        ? '已下载'
        : res.reason === 'missing'
          ? '这张素材已不在素材库里'
          : '下载失败',
    )
  }

  const handleDelete = async (hash: string) => {
    setConfirmHash(null)
    setMenuHash(null)
    if (preview?.hash === hash) setPreview(null)
    try {
      await store.remove(hash)
      setStatus('已删除 1 个素材')
    } catch {
      setStatus('删除素材失败')
    }
  }

  return (
    <div className={styles.page} data-assets-page>
      <main className={styles.main} data-assets-stage>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle} data-assets-heading>
              素材库
            </h2>
            <div className={styles.tools}>
              <div className={styles.filters} role="tablist" aria-label="素材类型">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className={filter === f.id ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    data-assets-filter={f.id}
                    onClick={() => store.setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <input
                className={styles.search}
                type="search"
                placeholder="搜索项目 / 类型 / 尺寸"
                aria-label="搜索素材"
                value={query}
                data-assets-search
                onChange={(e) => store.setQuery(e.target.value)}
              />
            </div>
          </div>

          <p className={styles.count} data-assets-count>
            {loading
              ? '载入中…'
              : assets.length === total
                ? `共 ${total} 个素材`
                : `筛选出 ${assets.length} / ${total} 个素材`}
          </p>

          {loading ? (
            <div className={styles.empty}>载入中…</div>
          ) : assets.length === 0 ? (
            <AssetsEmptyState hasAny={total > 0} />
          ) : (
            <div className={styles.grid} data-assets-grid>
              {assets.map((a) => (
                <AssetCard
                  key={a.hash}
                  asset={a}
                  projectName={nameOf(a.projectId)}
                  confirming={confirmHash === a.hash}
                  menuOpen={menuHash === a.hash}
                  onToggleMenu={() => setMenuHash(menuHash === a.hash ? null : a.hash)}
                  onRequestDelete={() => {
                    setConfirmHash(a.hash)
                    setMenuHash(null)
                  }}
                  onConfirmDelete={() => void handleDelete(a.hash)}
                  onCancelDelete={() => setConfirmHash(null)}
                  onDownload={() => void handleDownload(a.hash)}
                  onOpen={() => setPreview(a)}
                />
              ))}
            </div>
          )}
        </section>

        {/*
          角色库 / 场景库：留一句实话而不是假选项卡。
          §2.1 #6 把它们与素材库并列，但它们还没有自己的数据形态 ——
          摆两个能点、点了没反应的 tab 就是本项目最忌的「假功能」。
        */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>角色库 / 场景库</h2>
          <p className={styles.hint}>还没有相应的数据形态，暂未开放。</p>
        </section>
      </main>

      <div aria-live="polite" className={styles.status} role="status">
        {status}
      </div>

      {(menuHash !== null || confirmHash !== null) && (
        <div className={styles.backdrop} onClick={() => { setMenuHash(null); setConfirmHash(null) }} />
      )}

      {preview && (
        <AssetPreview
          asset={preview}
          projectName={nameOf(preview.projectId)}
          onClose={() => setPreview(null)}
          onDownload={() => void handleDownload(preview.hash)}
        />
      )}
    </div>
  )
}

/** 两类空态要说不同的话：库是空的 ≠ 筛选没命中 */
function AssetsEmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className={styles.empty} data-assets-empty={hasAny ? 'filtered' : 'none'}>
      <p className={styles.emptyTitle}>{hasAny ? '没有符合条件的素材' : '还没有素材'}</p>
      <p className={styles.emptyHint}>
        {hasAny
          ? '换个关键字或类型试试。'
          : '在画布里生成一张图、或导入素材，它就会出现在这里。'}
      </p>
    </div>
  )
}
