import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { downloadAsset } from '../../features/canvas/downloadAsset'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import {
  createAssetLibraryStore,
  type AssetFilter,
} from '../../state/project/assetLibraryStore'
import { AssetCard } from './AssetCard'
import { AssetPreview } from './AssetPreview'
import styles from './AssetsPage.module.css'

const FILTERS: readonly { id: AssetFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
]

/**
 * 手动收藏素材库。
 *
 * `assets` 仍是内容仓库，`assetLibrary` 才是用户主动保存过的关系。
 * 这里不扫描画布，也不把历史产出混进列表；未收藏的素材不会出现。
 */
export function AssetsPage() {
  const platform = usePlatform()

  const repoRef = useRef<ReturnType<typeof createAssetLibraryRepository> | null>(null)
  if (!repoRef.current) repoRef.current = createAssetLibraryRepository(platform.storage)
  const storeRef = useRef<ReturnType<typeof createAssetLibraryStore> | null>(null)
  if (!storeRef.current) storeRef.current = createAssetLibraryStore(repoRef.current)
  const store = storeRef.current

  const assets = useSyncExternalStore(
    store.subscribe,
    () => store.getState().visible,
    () => store.getState().visible,
  )
  const loading = useSyncExternalStore(
    store.subscribe,
    () => store.getState().loading,
    () => store.getState().loading,
  )
  const query = useSyncExternalStore(
    store.subscribe,
    () => store.getState().query,
    () => store.getState().query,
  )
  const filter = useSyncExternalStore(
    store.subscribe,
    () => store.getState().filter,
    () => store.getState().filter,
  )
  const total = useSyncExternalStore(
    store.subscribe,
    () => store.getState().assets.length,
    () => store.getState().assets.length,
  )

  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [preview, setPreview] = useState<LibraryAsset | null>(null)
  const [menuHash, setMenuHash] = useState<string | null>(null)
  const [confirmHash, setConfirmHash] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    void store.load()
  }, [store])

  const selectAsset = (hash: string) => {
    setSelectedHash(hash)
    setMenuHash(null)
    setConfirmHash(null)
  }

  const openAsset = (asset: LibraryAsset) => {
    setSelectedHash(asset.hash)
    setPreview(asset)
    setMenuHash(null)
    setConfirmHash(null)
  }

  const handleDownload = async (hash: string) => {
    setMenuHash(null)
    const result = await downloadAsset({ assets: platform.assets, files: platform.files }, hash)
    setStatus(
      result.ok
        ? '已下载'
        : result.reason === 'missing'
          ? '这张素材已不在素材库里'
          : '下载失败',
    )
  }

  const handleRemove = async (hash: string) => {
    setConfirmHash(null)
    setMenuHash(null)
    if (preview?.hash === hash) setPreview(null)
    if (selectedHash === hash) setSelectedHash(null)
    try {
      await store.remove(hash)
      setStatus('已取消收藏，原素材仍保留在画布中')
    } catch {
      setStatus('取消收藏失败')
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
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    className={
                      filter === item.id ? `${styles.chip} ${styles.chipOn}` : styles.chip
                    }
                    data-assets-filter={item.id}
                    onClick={() => store.setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <input
                className={styles.search}
                type="search"
                placeholder="搜索提示词 / 模型 / 尺寸"
                aria-label="搜索素材"
                value={query}
                data-assets-search
                onChange={(event) => store.setQuery(event.target.value)}
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
              {assets.map((asset) => (
                <AssetCard
                  key={asset.hash}
                  asset={asset}
                  selected={selectedHash === asset.hash}
                  onSelect={() => selectAsset(asset.hash)}
                  onOpen={() => openAsset(asset)}
                  confirming={confirmHash === asset.hash}
                  menuOpen={menuHash === asset.hash}
                  onToggleMenu={() =>
                    setMenuHash((current) => (current === asset.hash ? null : asset.hash))
                  }
                  onRequestRemove={() => {
                    setConfirmHash(asset.hash)
                    setMenuHash(null)
                  }}
                  onConfirmRemove={() => void handleRemove(asset.hash)}
                  onCancelRemove={() => setConfirmHash(null)}
                  onDownload={() => void handleDownload(asset.hash)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <div aria-live="polite" className={styles.status} role="status">
        {status}
      </div>

      {(menuHash !== null || confirmHash !== null) && (
        <div
          className={styles.backdrop}
          onClick={() => {
            setMenuHash(null)
            setConfirmHash(null)
          }}
        />
      )}

      {preview && (
        <AssetPreview
          asset={preview}
          onClose={() => setPreview(null)}
          onDownload={() => void handleDownload(preview.hash)}
          onRemove={() => void handleRemove(preview.hash)}
        />
      )}
    </div>
  )
}

function AssetsEmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className={styles.empty} data-assets-empty={hasAny ? 'filtered' : 'none'}>
      <p className={styles.emptyTitle} data-assets-empty-title>
        {hasAny ? '没有符合条件的素材' : '还没有收藏素材'}
      </p>
      <p className={styles.emptyHint} data-assets-empty-hint>
        {hasAny
          ? '换个关键字或类型试试。'
          : '从生成节点保存素材后才会出现在这里。'}
      </p>
    </div>
  )
}
