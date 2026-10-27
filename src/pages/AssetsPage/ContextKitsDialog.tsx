import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { ContextKit, ContextKitFact, ContextKitKind, ContextKitVersion } from '../../domain/shared/context'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { activeCanvasId } from '../../state/project/activeCanvas'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import { createProjectRepository } from '../../state/project/repository'
import { createContextRepository } from '../../state/shared/contextRepository'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import { useAsset } from '../../features/shared/assets'
import styles from './ContextKitsDialog.module.css'

const KIT_KINDS: { value: Extract<ContextKitKind, 'brand' | 'product'>; label: string }[] = [
  { value: 'brand', label: '品牌套件' },
  { value: 'product', label: '产品套件' },
]

function parseFacts(value: string): ContextKitFact[] {
  return value
    .split(/\r?\n/)
    .flatMap((line): ContextKitFact[] => {
      const match = /^([^:=：]+)[:=：]\s*(.+)$/.exec(line.trim())
      return match
        ? [{ key: match[1]!.trim(), value: match[2]!.trim() }]
        : []
    })
}

function factsTextOf(version: ContextKitVersion | null): string {
  return version?.facts.map((fact) => `${fact.key}: ${fact.value}`).join('\n') ?? ''
}

function KitAssetThumb({
  asset,
  selected,
  onToggle,
}: {
  asset: LibraryAsset
  selected: boolean
  onToggle: () => void
}) {
  const url = useAsset(asset.hash)
  return (
    <button
      type="button"
      className={selected ? styles.assetOn : styles.asset}
      aria-pressed={selected}
      title={asset.prompt || asset.hash}
      onClick={onToggle}
    >
      {url ? <img src={url} alt="" /> : <span className={styles.assetMissing}>素材不可读</span>}
      <span className={styles.assetCheck}>{selected ? '✓' : ''}</span>
    </button>
  )
}

export function ContextKitsDialog({ onClose }: { onClose: () => void }) {
  const platform = usePlatform()
  const contextRepo = useMemo(() => createContextRepository(platform.storage), [platform])
  const projectRepo = useMemo(() => createProjectRepository(platform.storage), [platform])
  const assetRepo = useMemo(
    () => createAssetLibraryRepository(platform.storage),
    [platform],
  )
  const [kind, setKind] = useState<'brand' | 'product'>('brand')
  const [kits, setKits] = useState<ContextKit[]>([])
  const [versions, setVersions] = useState<Record<string, ContextKitVersion[]>>({})
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [projectId, setProjectId] = useState(() => activeCanvasId() ?? '')
  const [bindings, setBindings] = useState<Record<string, number>>({})
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [guide, setGuide] = useState('')
  const [factsText, setFactsText] = useState('')
  const [assetHashes, setAssetHashes] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const refresh = async () => {
    const [nextKits, nextProjects, nextAssets] = await Promise.all([
      contextRepo.listKits(),
      projectRepo.list(),
      assetRepo.list(),
    ])
    const nextVersions = Object.fromEntries(
      await Promise.all(
        nextKits.map(async (kit) => [kit.id, await contextRepo.listKitVersions(kit.id)] as const),
      ),
    )
    setKits(nextKits)
    setVersions(nextVersions)
    setProjects(nextProjects.map((project) => ({ id: project.id, name: project.name })))
    setAssets(nextAssets.filter((asset) => asset.mime.startsWith('image/')))
    setProjectId((current) => current || nextProjects[0]?.id || '')
  }

  useEffect(() => {
    void refresh()
  }, [contextRepo, projectRepo, assetRepo])

  useEffect(() => {
    if (!projectId) {
      setBindings({})
      return
    }
    void contextRepo.listProjectBindings(projectId).then((rows) => {
      setBindings(Object.fromEntries(rows.map((binding) => [binding.kitId, binding.kitVersion])))
    })
  }, [contextRepo, projectId])

  const visibleKits = kits.filter((kit) => kit.kind === kind)
  const latestVersionOf = (kit: ContextKit): ContextKitVersion | null =>
    versions[kit.id]?.[0] ?? null

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setDescription('')
    setGuide('')
    setFactsText('')
    setAssetHashes([])
  }

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setStatus('')
    try {
      await contextRepo.createKit({
        kind,
        name,
        description,
        guide,
        facts: parseFacts(factsText),
        assetHashes,
      })
      resetForm()
      await refresh()
      setStatus('套件已创建，版本 v1')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '创建套件失败')
    } finally {
      setBusy(false)
    }
  }

  const beginEdit = (kit: ContextKit) => {
    const version = latestVersionOf(kit)
    setEditingId(kit.id)
    setName(kit.name)
    setDescription(kit.description)
    setGuide(version?.guide ?? '')
    setFactsText(factsTextOf(version))
    setAssetHashes(version?.assetHashes ?? [])
    setStatus('')
  }

  const saveVersion = async (kit: ContextKit) => {
    if (busy) return
    setBusy(true)
    try {
      await contextRepo.saveKitVersion(kit.id, {
        guide,
        facts: parseFacts(factsText),
        assetHashes,
        description,
      })
      resetForm()
      await refresh()
      setStatus('已发布新版本；旧项目仍固定原版本')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存版本失败')
    } finally {
      setBusy(false)
    }
  }

  const bind = async (kit: ContextKit) => {
    if (!projectId || busy) return
    setBusy(true)
    try {
      const binding = await contextRepo.bindProject({
        projectId,
        kitId: kit.id,
        kitVersion: kit.currentVersion,
        mode: 'locked',
      })
      setBindings((current) => ({ ...current, [kit.id]: binding.kitVersion }))
      setStatus(`已绑定到项目，固定 v${binding.kitVersion}`)
    } finally {
      setBusy(false)
    }
  }

  const unbind = async (kit: ContextKit) => {
    if (!projectId || busy) return
    setBusy(true)
    try {
      await contextRepo.removeBinding(projectId, kit.id)
      setBindings((current) => {
        const next = { ...current }
        delete next[kit.id]
        return next
      })
      setStatus('已从当前项目解绑')
    } finally {
      setBusy(false)
    }
  }

  const toggleAsset = (hash: string) => {
    setAssetHashes((current) =>
      current.includes(hash)
        ? current.filter((item) => item !== hash)
        : [...current, hash],
    )
  }

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="套件库">
      <div className={styles.panel} data-context-kits>
        <header className={styles.head}>
          <div>
            <h2>套件库</h2>
            <p>项目只绑定明确版本；发布新版本不会自动改变旧项目。</p>
          </div>
          <button type="button" className={styles.close} aria-label="关闭套件库" onClick={onClose}>
            ×
          </button>
        </header>

        <div className={styles.toolbar}>
          <div className={styles.tabs}>
            {KIT_KINDS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={kind === item.value ? styles.tabOn : styles.tab}
                data-context-kit-kind={item.value}
                aria-pressed={kind === item.value}
                onClick={() => {
                  setKind(item.value)
                  resetForm()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <ChoicePicker
            name="context-kit-project"
            className={styles.projectPicker}
            value={projectId}
            ariaLabel="绑定项目"
            placeholder="选择要绑定的项目"
            options={projects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
            onChange={setProjectId}
          />
        </div>

        <div className={styles.body}>
          <section className={styles.form}>
            <h3>{editingId ? '编辑并发布新版本' : '新建套件'}</h3>
            <label className={styles.field}>
              <span>名称</span>
              <input
                value={name}
                disabled={Boolean(editingId)}
                data-context-kit-name
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>说明</span>
              <input
                value={description}
                data-context-kit-description
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>规范指南</span>
              <textarea
                value={guide}
                placeholder="例如：品牌主色使用深绿；文字克制；不使用渐变和高饱和霓虹色。"
                data-context-kit-guide
                onChange={(event) => setGuide(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>结构化事实</span>
              <textarea
                value={factsText}
                placeholder={'每行一条，例如：\n主色: #14532D\n字体: 思源黑体\nLogo 安全区: 16px'}
                data-context-kit-facts
                onChange={(event) => setFactsText(event.target.value)}
              />
            </label>
            <div className={styles.field}>
              <span>参考素材</span>
              {assets.length === 0 ? (
                <p className={styles.hint}>素材库还是空的；可先收藏 Logo、产品图或包装参考。</p>
              ) : (
                <div className={styles.assetGrid}>
                  {assets.slice(0, 24).map((asset) => (
                    <KitAssetThumb
                      key={asset.hash}
                      asset={asset}
                      selected={assetHashes.includes(asset.hash)}
                      onToggle={() => toggleAsset(asset.hash)}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !name.trim()}
                data-context-kit-create-or-save={editingId ? 'version' : 'kit'}
                onClick={() => {
                  if (editingId) {
                    const kit = kits.find((item) => item.id === editingId)
                    if (kit) void saveVersion(kit)
                  } else {
                    void create()
                  }
                }}
              >
                {editingId ? '发布新版本' : '创建套件'}
              </button>
              {editingId ? (
                <button type="button" className={styles.secondary} onClick={resetForm}>
                  取消编辑
                </button>
              ) : null}
              {status ? <span className={styles.status}>{status}</span> : null}
            </div>
          </section>

          <section className={styles.listSection}>
            <div className={styles.listHead}>
              <h3>{KIT_KINDS.find((item) => item.value === kind)?.label}</h3>
              <span>{visibleKits.length} 个</span>
            </div>
            {visibleKits.length === 0 ? (
              <div className={styles.empty}>还没有套件</div>
            ) : (
              <div className={styles.list}>
                {visibleKits.map((kit) => {
                  const latest = latestVersionOf(kit)
                  const boundVersion = bindings[kit.id]
                  return (
                    <article key={kit.id} className={styles.kitCard} data-context-kit={kit.id}>
                      <div className={styles.kitTop}>
                        <div>
                          <h4>{kit.name}</h4>
                          <p>{kit.description || '未填写说明'}</p>
                        </div>
                        <span className={styles.version}>当前 v{kit.currentVersion}</span>
                      </div>
                      <p className={styles.guidePreview}>
                        {latest?.guide || '还没有规范指南'}
                      </p>
                      <div className={styles.kitMeta}>
                        <span>{latest?.facts.length ?? 0} 条事实</span>
                        <span>{latest?.assetHashes.length ?? 0} 个素材</span>
                        <span>
                          {boundVersion
                            ? `当前项目固定 v${boundVersion}`
                            : '当前项目未绑定'}
                        </span>
                      </div>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.primary}
                          disabled={busy || !projectId || boundVersion === kit.currentVersion}
                          data-context-kit-bind={kit.id}
                          onClick={() => void bind(kit)}
                        >
                          {boundVersion && boundVersion !== kit.currentVersion
                            ? `升级到 v${kit.currentVersion}`
                            : boundVersion
                              ? '已绑定'
                              : `绑定 v${kit.currentVersion}`}
                        </button>
                        <button
                          type="button"
                          className={styles.secondary}
                          onClick={() => beginEdit(kit)}
                        >
                          发布新版本
                        </button>
                        {boundVersion ? (
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={busy}
                            onClick={() => void unbind(kit)}
                          >
                            解绑
                          </button>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
