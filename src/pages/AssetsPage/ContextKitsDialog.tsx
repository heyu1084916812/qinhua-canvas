import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type {
  ContextKit,
  ContextKitAsset,
  ContextKitAssetRole,
  ContextKitColor,
  ContextKitFact,
  ContextKitFont,
  ContextKitKind,
  ContextKitVersion,
} from '../../domain/shared/context'
import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import {
  ensureFreshDisplayThumb,
  rememberFreshAsset,
} from '../../platform/freshAssets'
import { activeCanvasId } from '../../state/project/activeCanvas'
import { createProjectRepository } from '../../state/project/repository'
import { createContextRepository } from '../../state/shared/contextRepository'
import { createId } from '../../shared/id'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import { ColorPickerPopover } from '../../features/shared/colorPicker/ColorPickerPopover'
import { readableTextColor } from '../../features/shared/colorPicker/colorMath'
import { useAsset } from '../../features/shared/assets'
import styles from './ContextKitsDialog.module.css'

const KIT_KINDS: { value: Extract<ContextKitKind, 'brand' | 'product'>; label: string }[] = [
  { value: 'brand', label: '品牌套件' },
  { value: 'product', label: '产品套件' },
]

const MAX_ASSET_BYTES = 20 * 1024 * 1024
const COLOR_FACT_PREFIX = '颜色/'
const FONT_FACT_PREFIX = '字体/'

interface Draft {
  name: string
  description: string
  guide: string
  hiddenFacts: ContextKitFact[]
  resources: ContextKitAsset[]
  colors: ContextKitColor[]
  fonts: ContextKitFont[]
}

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  guide: '',
  hiddenFacts: [],
  resources: [],
  colors: [],
  fonts: [],
}

function legacyColors(facts: readonly ContextKitFact[]): ContextKitColor[] {
  return facts
    .filter((fact) => fact.key.startsWith(COLOR_FACT_PREFIX))
    .flatMap((fact, index) => {
      if (!/^#[0-9a-f]{6}$/i.test(fact.value.trim())) return []
      return [
        {
          id: `legacy-color-${index}`,
          name: fact.key.slice(COLOR_FACT_PREFIX.length) || '品牌颜色',
          value: fact.value.trim().toLowerCase(),
        },
      ]
    })
}

function legacyFonts(facts: readonly ContextKitFact[]): ContextKitFont[] {
  return facts
    .filter((fact) => fact.key.startsWith(FONT_FACT_PREFIX))
    .map((fact, index) => ({
      id: `legacy-font-${index}`,
      name: fact.key.slice(FONT_FACT_PREFIX.length) || '品牌字体',
      detail: fact.value,
    }))
}

function draftFromVersion(kit: ContextKit, version: ContextKitVersion | null): Draft {
  const facts = version?.facts ?? []
  const importedColors = version?.colors.length
    ? version.colors
    : legacyColors(facts)
  const importedFonts = version?.fonts.length ? version.fonts : legacyFonts(facts)
  const managedFacts = new Set([
    ...importedColors.map((color) => `${COLOR_FACT_PREFIX}${color.name}`),
    ...importedFonts.map((font) => `${FONT_FACT_PREFIX}${font.name}`),
  ])
  return {
    name: kit.name,
    description: kit.description,
    guide: version?.guide ?? '',
    hiddenFacts: facts.filter((fact) => !managedFacts.has(fact.key)),
    resources: version?.resources ?? [],
    colors: importedColors,
    fonts: importedFonts,
  }
}

function factsForDraft(draft: Draft): ContextKitFact[] {
  return [...draft.hiddenFacts]
}

function versionLabel(version: ContextKitVersion | null): string {
  if (!version) return '尚未保存'
  const parts = [
    version.guide.trim() ? '设计指南' : '',
    version.colors.length ? `${version.colors.length} 色` : '',
    version.fonts.length ? `${version.fonts.length} 字体` : '',
    version.resources.length ? `${version.resources.length} 素材` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '空套件'
}

function ContextAssetThumb({
  resource,
  compact,
  onRemove,
}: {
  resource: ContextKitAsset
  compact?: boolean
  onRemove: () => void
}) {
  const url = useAsset(resource.hash)
  const name = resource.name.trim() || `素材 ${resource.hash.slice(0, 6)}`
  return (
    <figure className={compact ? styles.assetCardCompact : styles.assetCard}>
      <div className={styles.assetPreview}>
        {url ? <img src={url} alt={name} /> : <span>素材不可读</span>}
        <button
          type="button"
          className={styles.removeAsset}
          aria-label={`移除 ${name}`}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <figcaption title={name}>{name}</figcaption>
    </figure>
  )
}

export function ContextKitsDialog({ onClose }: { onClose: () => void }) {
  const platform = usePlatform()
  const contextRepo = useMemo(() => createContextRepository(platform.storage), [platform])
  const projectRepo = useMemo(() => createProjectRepository(platform.storage), [platform])
  const [kind, setKind] = useState<'brand' | 'product'>('brand')
  const [kits, setKits] = useState<ContextKit[]>([])
  const [versions, setVersions] = useState<Record<string, ContextKitVersion[]>>({})
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [projectId, setProjectId] = useState(() => activeCanvasId() ?? '')
  const [bindings, setBindings] = useState<Record<string, number>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [dragging, setDragging] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [colorNameDraft, setColorNameDraft] = useState('')
  const [lastColor, setLastColor] = useState('#9acd32')
  const [fontOpen, setFontOpen] = useState(false)
  const [fontNameDraft, setFontNameDraft] = useState('')
  const [fontDetailDraft, setFontDetailDraft] = useState('')
  const dropDepth = useRef(0)

  const refresh = async () => {
    const [nextKits, nextProjects] = await Promise.all([
      contextRepo.listKits(),
      projectRepo.list(),
    ])
    const nextVersions = Object.fromEntries(
      await Promise.all(
        nextKits.map(async (kit) => [kit.id, await contextRepo.listKitVersions(kit.id)] as const),
      ),
    )
    setKits(nextKits)
    setVersions(nextVersions)
    setProjects(nextProjects.map((project) => ({ id: project.id, name: project.name })))
    setProjectId((current) => current || nextProjects[0]?.id || '')
  }

  useEffect(() => {
    void refresh()
  }, [contextRepo, projectRepo])

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
  const selectedKit = visibleKits.find((kit) => kit.id === selectedId) ?? null
  const boundVersion = selectedKit ? bindings[selectedKit.id] : undefined
  const logoResources = draft.resources.filter((resource) => resource.role === 'logo')
  const referenceResources = draft.resources.filter((resource) => resource.role === 'reference')

  const resetDraft = () => {
    setSelectedId(null)
    setDraft(EMPTY_DRAFT)
    setStatus('')
    setUrlOpen(false)
    setUrlDraft('')
    setFontOpen(false)
  }

  const selectKit = (kit: ContextKit) => {
    setSelectedId(kit.id)
    setDraft(draftFromVersion(kit, versions[kit.id]?.[0] ?? null))
    setStatus('')
    setUrlOpen(false)
    setFontOpen(false)
  }

  const changeKind = (nextKind: 'brand' | 'product') => {
    setKind(nextKind)
    resetDraft()
  }

  const persistImage = async (
    blob: Blob,
    name: string,
    role: ContextKitAssetRole,
  ): Promise<ContextKitAsset> => {
    if (!blob.type.startsWith('image/')) {
      throw new Error('这里只支持图片文件')
    }
    if (blob.size > MAX_ASSET_BYTES) {
      throw new Error(`${name || '图片'}超过 20MB`)
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length === 0) throw new Error(`${name || '图片'}没有内容`)
    const hash = await fingerprintBytes(bytes)
    const mime = blob.type || 'image/png'
    const size = imageSizeFromHeader(bytes)
    const fresh = new Blob([bytes as unknown as BlobPart], { type: mime })
    rememberFreshAsset(hash, fresh)
    void ensureFreshDisplayThumb(hash, size)
    await platform.storage.put(
      'assets',
      {
        id: hash,
        hash,
        mime,
        bytes,
        ...(size ?? {}),
        createdAt: Date.now(),
        projectId: projectId || activeCanvasId() || 'context-kits',
      } as never,
    )
    return {
      hash,
      role,
      name: name.trim() || `素材 ${hash.slice(0, 6)}`,
    }
  }

  const addResources = (next: readonly ContextKitAsset[]) => {
    setDraft((current) => {
      const byHash = new Map(current.resources.map((resource) => [resource.hash, resource]))
      for (const resource of next) byHash.set(resource.hash, resource)
      return { ...current, resources: [...byHash.values()] }
    })
  }

  const importFiles = async (files: readonly File[], role: ContextKitAssetRole) => {
    if (files.length === 0 || busy) return
    setBusy(true)
    setStatus('')
    try {
      const imported: ContextKitAsset[] = []
      for (const file of files) imported.push(await persistImage(file, file.name, role))
      addResources(imported)
      setStatus(`已添加 ${imported.length} 个${role === 'logo' ? ' Logo' : '参考素材'}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导入素材失败')
    } finally {
      setBusy(false)
    }
  }

  const pickFiles = async (role: ContextKitAssetRole) => {
    const picked = await platform.files.pickFile(
      'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
    )
    if (!picked) return
    const file = new File([picked.blob], picked.name, { type: picked.mime })
    await importFiles([file], role)
  }

  const importUrl = async () => {
    const url = urlDraft.trim()
    if (!url || busy) return
    let parsed: URL
    try {
      parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
    } catch {
      setStatus('请输入完整的 http 或 https 图片地址')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const response = await platform.network.request(
        { url, method: 'GET', timeoutMs: 30_000 },
        new AbortController().signal,
      )
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`图片地址返回 HTTP ${response.status}`)
      }
      const mime = Object.entries(response.headers).find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1]?.split(';')[0]?.trim() ?? 'image/png'
      if (!mime.startsWith('image/')) throw new Error('这个地址返回的不是图片')
      const bytes = new Uint8Array(await response.arrayBuffer())
      const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '网页图片')
      const resource = await persistImage(new Blob([bytes], { type: mime }), name, 'reference')
      addResources([resource])
      setUrlDraft('')
      setUrlOpen(false)
      setStatus('已从网址添加参考素材')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '从网址导入失败')
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dropDepth.current = 0
    setDragging(false)
    const files = [...event.dataTransfer.files]
    if (files.length > 0) void importFiles(files, 'reference')
  }

  const createOrSave = async () => {
    if (!draft.name.trim() || busy) return
    setBusy(true)
    setStatus('')
    try {
      const input = {
        guide: draft.guide,
        facts: factsForDraft(draft),
        assetHashes: draft.resources.map((resource) => resource.hash),
        resources: draft.resources,
        colors: draft.colors,
        fonts: draft.fonts,
      }
      if (selectedKit) {
        await contextRepo.saveKitVersion(selectedKit.id, {
          ...input,
          description: draft.description,
        })
        setStatus('已保存为新版本；已绑定旧版本的项目不会自动变化')
      } else {
        const created = await contextRepo.createKit({
          kind,
          name: draft.name,
          description: draft.description,
          ...input,
        })
        setSelectedId(created.kit.id)
        setStatus('套件已创建')
      }
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存套件失败')
    } finally {
      setBusy(false)
    }
  }

  const bind = async () => {
    if (!selectedKit || !projectId || busy) return
    setBusy(true)
    try {
      const binding = await contextRepo.bindProject({
        projectId,
        kitId: selectedKit.id,
        kitVersion: selectedKit.currentVersion,
        mode: 'locked',
      })
      setBindings((current) => ({ ...current, [selectedKit.id]: binding.kitVersion }))
      setStatus(`已绑定到当前项目，固定为 v${binding.kitVersion}`)
    } finally {
      setBusy(false)
    }
  }

  const unbind = async () => {
    if (!selectedKit || !projectId || busy) return
    setBusy(true)
    try {
      await contextRepo.removeBinding(projectId, selectedKit.id)
      setBindings((current) => {
        const next = { ...current }
        delete next[selectedKit.id]
        return next
      })
      setStatus('已从当前项目解绑')
    } finally {
      setBusy(false)
    }
  }

  const removeResource = (hash: string) => {
    setDraft((current) => ({
      ...current,
      resources: current.resources.filter((resource) => resource.hash !== hash),
    }))
  }

  const addColor = (value: string) => {
    const color: ContextKitColor = {
      id: createId('kitcolor'),
      name: colorNameDraft.trim() || '品牌颜色',
      value,
    }
    setDraft((current) => ({ ...current, colors: [...current.colors, color] }))
    setColorNameDraft('')
    setLastColor(value)
  }

  const addFont = () => {
    const name = fontNameDraft.trim()
    if (!name) return
    const font: ContextKitFont = {
      id: createId('kitfont'),
      name,
      detail: fontDetailDraft.trim(),
    }
    setDraft((current) => ({ ...current, fonts: [...current.fonts, font] }))
    setFontNameDraft('')
    setFontDetailDraft('')
    setFontOpen(false)
  }

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="套件库">
      <div className={styles.panel} data-context-kits>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>项目上下文</p>
            <h2>套件库</h2>
          </div>
          <div className={styles.headActions}>
            <div className={styles.kindTabs} role="tablist" aria-label="套件类型">
              {KIT_KINDS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={kind === item.value}
                  className={kind === item.value ? styles.kindTabOn : styles.kindTab}
                  data-context-kit-kind={item.value}
                  onClick={() => changeKind(item.value)}
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
            <button type="button" className={styles.close} aria-label="关闭套件库" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.rail}>
            <div className={styles.railHead}>
              <span>{KIT_KINDS.find((item) => item.value === kind)?.label}</span>
              <button type="button" className={styles.addQuiet} onClick={resetDraft}>
                <span aria-hidden>+</span> 新建
              </button>
            </div>
            <div className={styles.kitList}>
              {visibleKits.length === 0 ? (
                <p className={styles.railEmpty}>还没有套件</p>
              ) : (
                visibleKits.map((kit) => {
                  const latest = versions[kit.id]?.[0] ?? null
                  return (
                    <button
                      key={kit.id}
                      type="button"
                      className={selectedId === kit.id ? styles.kitItemOn : styles.kitItem}
                      data-context-kit={kit.id}
                      onClick={() => selectKit(kit)}
                    >
                      <span className={styles.kitItemName}>{kit.name}</span>
                      <span className={styles.kitItemMeta}>v{kit.currentVersion}</span>
                      {bindings[kit.id] ? <span className={styles.boundDot} title="已绑定项目" /> : null}
                      <span className={styles.kitItemHint}>{versionLabel(latest)}</span>
                    </button>
                  )
                })
              )}
            </div>
          </aside>

          <main className={styles.detail}>
            <div className={styles.titleRow}>
              <div className={styles.titleBlock}>
                <input
                  className={styles.nameInput}
                  value={draft.name}
                  placeholder={kind === 'brand' ? '未命名品牌套件' : '未命名产品套件'}
                  aria-label="套件名称"
                  data-context-kit-name
                  disabled={Boolean(selectedKit)}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
                <input
                  className={styles.descriptionInput}
                  value={draft.description}
                  placeholder="添加一句说明，方便以后辨认"
                  aria-label="套件说明"
                  data-context-kit-description
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </div>
              <div className={styles.versionBox}>
                {selectedKit ? (
                  <>
                    <strong>当前 v{selectedKit.currentVersion}</strong>
                    <span>{boundVersion ? `项目固定 v${boundVersion}` : '尚未绑定项目'}</span>
                  </>
                ) : (
                  <>
                    <strong>新套件</strong>
                    <span>保存后成为 v1</span>
                  </>
                )}
              </div>
            </div>

            <div
              className={dragging ? styles.dropzoneOn : styles.dropzone}
              data-context-asset-dropzone
              onDragEnter={(event) => {
                event.preventDefault()
                dropDepth.current += 1
                setDragging(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                dropDepth.current = Math.max(0, dropDepth.current - 1)
                if (dropDepth.current === 0) setDragging(false)
              }}
              onDrop={onDrop}
            >
              <div className={styles.uploadIcon} aria-hidden>
                <span />
              </div>
              <div className={styles.dropCopy}>
                <strong>拖拽或上传图片</strong>
                <span>PNG、JPG、WebP，最大 20MB</span>
              </div>
              <div className={styles.dropActions}>
                <button
                  type="button"
                  className={styles.smallButton}
                  disabled={busy}
                  onClick={() => void pickFiles('reference')}
                >
                  选择本机图片
                </button>
                <button
                  type="button"
                  className={styles.smallButton}
                  aria-expanded={urlOpen}
                  onClick={() => setUrlOpen((current) => !current)}
                >
                  导入 URL
                </button>
              </div>
              {urlOpen ? (
                <div className={styles.urlRow}>
                  <input
                    value={urlDraft}
                    placeholder="https://example.com/brand.jpg"
                    aria-label="图片网址"
                    onChange={(event) => setUrlDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void importUrl()
                    }}
                  />
                  <button
                    type="button"
                    className={styles.urlConfirm}
                    disabled={busy || !urlDraft.trim()}
                    onClick={() => void importUrl()}
                  >
                    导入
                  </button>
                </div>
              ) : null}
            </div>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h3>设计指南</h3>
              </div>
              <textarea
                className={styles.guide}
                value={draft.guide}
                placeholder="写下品牌语气、版式原则、使用场景和明确的禁区。这里是一份可执行的视觉说明。"
                data-context-kit-guide
                onChange={(event) =>
                  setDraft((current) => ({ ...current, guide: event.target.value }))
                }
              />
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h3>Logo</h3>
                <button
                  type="button"
                  className={styles.addButton}
                  disabled={busy}
                  data-context-logo-add
                  onClick={() => void pickFiles('logo')}
                >
                  <span aria-hidden>+</span> 添加
                </button>
              </div>
              {logoResources.length > 0 ? (
                <div className={styles.logoGrid}>
                  {logoResources.map((resource) => (
                    <ContextAssetThumb
                      key={resource.hash}
                      resource={resource}
                      onRemove={() => removeResource(resource.hash)}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>添加品牌标志或字标</div>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h3>Color</h3>
                <ColorPickerPopover
                  value={lastColor}
                  target="context-kit-color"
                  showName
                  nameValue={colorNameDraft}
                  namePlaceholder="为颜色命名，例如主色"
                  confirmLabel="添加"
                  onNameChange={setColorNameDraft}
                  onCommit={addColor}
                  renderTrigger={({ open, toggle }) => (
                    <button
                      type="button"
                      className={styles.addButton}
                      aria-expanded={open}
                      data-context-color-add
                      onClick={toggle}
                    >
                      <span aria-hidden>+</span> 添加
                    </button>
                  )}
                />
              </div>
              {draft.colors.length > 0 ? (
                <div className={styles.colorGrid}>
                  {draft.colors.map((color) => (
                    <div className={styles.colorItem} key={color.id}>
                      <ColorPickerPopover
                        value={color.value}
                        target={`context-kit-color-${color.id}`}
                        onCommit={(value) =>
                          setDraft((current) => ({
                            ...current,
                            colors: current.colors.map((item) =>
                              item.id === color.id ? { ...item, value } : item,
                            ),
                          }))
                        }
                        renderTrigger={({ open, toggle }) => (
                          <button
                            type="button"
                            className={styles.colorChip}
                            style={{
                              background: color.value,
                              color: readableTextColor(color.value),
                            }}
                            aria-label={`编辑颜色 ${color.name} ${color.value}`}
                            aria-expanded={open}
                            onClick={toggle}
                          >
                            {color.name}
                          </button>
                        )}
                      />
                      <button
                        type="button"
                        className={styles.removeColor}
                        aria-label={`移除颜色 ${color.name}`}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            colors: current.colors.filter((item) => item.id !== color.id),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>添加主色、辅助色和功能色</div>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h3>Font</h3>
                <button
                  type="button"
                  className={styles.addButton}
                  aria-expanded={fontOpen}
                  data-context-font-add
                  onClick={() => setFontOpen((current) => !current)}
                >
                  <span aria-hidden>+</span> 添加
                </button>
              </div>
              {fontOpen ? (
                <div className={styles.fontForm}>
                  <input
                    autoFocus
                    value={fontNameDraft}
                    placeholder="字体名称，例如思源黑体"
                    aria-label="字体名称"
                    data-context-font-name
                    onChange={(event) => setFontNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addFont()
                      if (event.key === 'Escape') setFontOpen(false)
                    }}
                  />
                  <input
                    value={fontDetailDraft}
                    placeholder="用途或字重，例如标题 700、正文 400（可选）"
                    aria-label="字体用途"
                    data-context-font-detail
                    onChange={(event) => setFontDetailDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addFont()
                      if (event.key === 'Escape') setFontOpen(false)
                    }}
                  />
                  <button
                    type="button"
                    disabled={!fontNameDraft.trim()}
                    data-context-font-confirm
                    onClick={addFont}
                  >
                    添加
                  </button>
                </div>
              ) : null}
              {draft.fonts.length > 0 ? (
                <div className={styles.fontGrid}>
                  {draft.fonts.map((font) => (
                    <div className={styles.fontCard} key={font.id}>
                      <div>
                        <strong>{font.name}</strong>
                        <span>{font.detail || '未填写用途'}</span>
                      </div>
                      <button
                        type="button"
                        aria-label={`移除字体 ${font.name}`}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            fonts: current.fonts.filter((item) => item.id !== font.id),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>记录标题、正文和数字使用的字体</div>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h3>Reference</h3>
                <button
                  type="button"
                  className={styles.addButton}
                  disabled={busy}
                  data-context-reference-add
                  onClick={() => void pickFiles('reference')}
                >
                  <span aria-hidden>+</span> 添加
                </button>
              </div>
              {referenceResources.length > 0 ? (
                <div className={styles.referenceGrid}>
                  {referenceResources.map((resource) => (
                    <ContextAssetThumb
                      key={resource.hash}
                      resource={resource}
                      compact
                      onRemove={() => removeResource(resource.hash)}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.sectionEmpty}>添加空间、包装、摄影和版式参考</div>
              )}
            </section>

            <footer className={styles.footer}>
              <div className={styles.saveActions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !draft.name.trim()}
                  data-context-kit-create-or-save={selectedKit ? 'version' : 'kit'}
                  onClick={() => void createOrSave()}
                >
                  {selectedKit ? '保存为新版本' : '创建套件'}
                </button>
                {selectedKit ? (
                  <button type="button" className={styles.secondary} onClick={resetDraft}>
                    取消编辑
                  </button>
                ) : null}
              </div>
              <div className={styles.bindActions}>
                {selectedKit ? (
                  <>
                    <button
                      type="button"
                      className={styles.bindButton}
                      disabled={
                        busy ||
                        !projectId ||
                        boundVersion === selectedKit.currentVersion
                      }
                      data-context-kit-bind={selectedKit.id}
                      onClick={() => void bind()}
                    >
                      {boundVersion && boundVersion !== selectedKit.currentVersion
                        ? `升级到 v${selectedKit.currentVersion}`
                        : boundVersion
                          ? '已绑定本项目'
                          : `绑定 v${selectedKit.currentVersion}`}
                    </button>
                    {boundVersion ? (
                      <button
                        type="button"
                        className={styles.unbindButton}
                        disabled={busy}
                        onClick={() => void unbind()}
                      >
                        解绑
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
              <p className={styles.status} aria-live="polite">
                {status}
              </p>
            </footer>
          </main>
        </div>
      </div>
    </div>
  )
}
