import { useEffect, useMemo, useRef, useState } from 'react'
import type { BuiltinSkill, UserSkill } from '../../domain/prompt/skill'
import {
  libtvCanvasCaseOf,
  libtvHasBody,
  libtvMediaLabel,
  libtvPreviewOf,
  type LibtvSkill,
  type LibtvSkillFile,
} from '../../domain/prompt/libtvSkill'
import { loadLibtvSkillFiles } from '../../state/project/libtvSkillCatalog'
import {
  SkillChevronIcon,
  SkillCloseIcon,
  SkillCodeIcon,
  SkillExternalIcon,
  SkillEyeIcon,
  SkillFileIcon,
  SkillStarIcon,
} from './SkillLibraryIcons'
import styles from './SkillsPage.module.css'

export type SkillDetailSource =
  | { kind: 'libtv'; skill: LibtvSkill }
  | { kind: 'builtin'; skill: BuiltinSkill }
  | { kind: 'user'; skill: UserSkill }

export function SkillDetailDialog({
  source,
  favorite,
  busy,
  onClose,
  onToggleFavorite,
  onAddToAgent,
  onEdit,
}: {
  source: SkillDetailSource
  favorite: boolean
  busy: boolean
  onClose: () => void
  onToggleFavorite: () => void
  onAddToAgent: () => void
  onEdit?: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const filePickerRef = useRef<HTMLDivElement>(null)
  const [files, setFiles] = useState<LibtvSkillFile[]>([])
  const [selectedPath, setSelectedPath] = useState('SKILL.md')
  const [viewMode, setViewMode] = useState<'document' | 'json'>('document')
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [filePickerUp, setFilePickerUp] = useState(false)
  const [bodyLoading, setBodyLoading] = useState(source.kind === 'libtv')
  const [bodyError, setBodyError] = useState('')
  const [previewFailed, setPreviewFailed] = useState(false)

  const skill = source.skill
  const libtv = source.kind === 'libtv' ? source.skill : null
  const preview =
    source.kind === 'libtv'
      ? libtvPreviewOf(source.skill)
      : source.skill.image
        ? { url: source.skill.image, kind: 'image' as const }
        : null
  const canvasCaseUrl = libtv ? libtvCanvasCaseOf(libtv) : null
  const canUse = libtv ? libtvHasBody(libtv) : true

  useEffect(() => {
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  useEffect(() => {
    setPreviewFailed(false)
    setFilePickerOpen(false)
    setFilePickerUp(false)
    setViewMode('document')
    setSelectedPath('SKILL.md')
    setBodyError('')
    if (source.kind !== 'libtv') {
      setFiles([{ path: 'SKILL.md', content: source.skill.content }])
      setBodyLoading(false)
      return
    }
    let alive = true
    setFiles([])
    setBodyLoading(true)
    void loadLibtvSkillFiles(source.skill)
      .then((loaded) => {
        if (!alive) return
        setFiles(loaded ?? [])
        setSelectedPath(loaded?.[0]?.path ?? 'SKILL.md')
      })
      .catch((error) => {
        if (!alive) return
        setBodyError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (alive) setBodyLoading(false)
      })
    return () => {
      alive = false
    }
  }, [source])

  useEffect(() => {
    if (!filePickerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!filePickerRef.current?.contains(event.target as Node)) setFilePickerOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [filePickerOpen])

  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null
  const jsonText = useMemo(
    () => JSON.stringify(Object.fromEntries(files.map((file) => [file.path, file.content])), null, 2),
    [files],
  )
  const mediaLabel = libtv ? libtvMediaLabel(libtv.resultType) : null

  return (
    <div
      className={styles.detailScrim}
      data-skill-detail-scrim
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={styles.detailDialog}
        role="dialog"
        aria-modal="true"
        aria-label={skill.name}
        data-skill-detail
      >
        <header className={styles.detailActionsBar}>
          <span className={styles.detailHeadSpacer} />
          <button
            type="button"
            className={favorite ? `${styles.detailIconButton} ${styles.starOn}` : styles.detailIconButton}
            aria-pressed={favorite}
            aria-label={favorite ? '取消收藏' : '收藏'}
            title={favorite ? '取消收藏' : '收藏'}
            data-skill-detail-favorite
            onClick={onToggleFavorite}
          >
            <SkillStarIcon filled={favorite} />
          </button>
          <button
            type="button"
            className={styles.usePrimary}
            disabled={!canUse || busy}
            title={canUse ? '把这条技能添加到 Agent' : '这条目录没有可执行 Skill 正文'}
            data-skill-detail-add-agent
            onClick={onAddToAgent}
          >
            {busy ? '添加中…' : '添加 Skill 到 Agent'}
          </button>
          <button
            ref={closeRef}
            type="button"
            className={styles.detailIconButton}
            aria-label="关闭技能详情"
            title="关闭"
            data-skill-detail-close
            onClick={onClose}
          >
            <SkillCloseIcon size={16} />
          </button>
        </header>

        <div className={styles.detailScroll}>
          <div className={styles.detailPreview} data-skill-detail-preview>
            {preview && !previewFailed ? (
              preview.kind === 'video' ? (
                <video
                  className={styles.detailPreviewMedia}
                  src={preview.url}
                  controls
                  autoPlay
                  loop
                  playsInline
                  poster={libtv?.coverUrl || undefined}
                  onError={() => setPreviewFailed(true)}
                  data-skill-detail-video
                />
              ) : (
                <img
                  className={styles.detailPreviewMedia}
                  src={preview.url}
                  alt=""
                  onError={() => setPreviewFailed(true)}
                  data-skill-detail-image
                />
              )
            ) : (
              <div className={styles.detailPreviewEmpty} data-skill-detail-no-preview>
                <span>{mediaLabel ?? '技能'}</span>
                <small>暂无示例预览</small>
              </div>
            )}

            <div className={styles.detailPreviewTop}>
              {canvasCaseUrl ? (
                <a
                  className={styles.caseLink}
                  href={canvasCaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-skill-detail-canvas-case
                >
                  创作详情
                  <SkillExternalIcon size={12} />
                </a>
              ) : null}
              {mediaLabel ? (
                <span className={styles.mediaBadge} data-skill-detail-media-type>
                  {mediaLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className={styles.detailInfo}>
            <h2 className={styles.sectionTitle}>简介</h2>
            <dl className={styles.infoRows}>
              {skill.description ? (
                <>
                  <dt>介绍</dt>
                  <dd>{skill.description}</dd>
                </>
              ) : null}
              {libtv?.useScenario ? (
                <>
                  <dt>使用场景</dt>
                  <dd>{libtv.useScenario}</dd>
                </>
              ) : null}
              {libtv?.inputType ? (
                <>
                  <dt>如何使用</dt>
                  <dd>{libtv.inputType}</dd>
                </>
              ) : null}
              {libtv?.outputContent ? (
                <>
                  <dt>输出内容</dt>
                  <dd>{libtv.outputContent}</dd>
                </>
              ) : null}
            </dl>

            <div className={styles.skillFilesBar}>
              <div className={styles.skillFilesHeading}>
                <h2 className={styles.sectionTitle}>Skill</h2>
                <span className={styles.skillFilesCount} data-skill-file-count>
                  {files.length} 个文件
                </span>
              </div>
              <div className={styles.skillFileTools}>
                <div
                  ref={filePickerRef}
                  className={styles.skillFilePicker}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && filePickerOpen) {
                      event.preventDefault()
                      event.stopPropagation()
                      setFilePickerOpen(false)
                    }
                  }}
                >
                  <button
                    type="button"
                    className={styles.skillFileTrigger}
                    disabled={viewMode === 'json' || files.length === 0}
                    aria-haspopup="listbox"
                    aria-expanded={filePickerOpen}
                    title={viewMode === 'json' ? 'JSON 视图包含全部文件' : '选择 Markdown 文件'}
                    data-skill-file-trigger
                    onClick={(event) => {
                      if (filePickerOpen) {
                        setFilePickerOpen(false)
                        return
                      }
                      const rect = event.currentTarget.getBoundingClientRect()
                      const below = window.innerHeight - rect.bottom
                      setFilePickerUp(below < 286 && rect.top > 286)
                      setFilePickerOpen(true)
                    }}
                  >
                    <SkillFileIcon size={14} />
                    <span>{viewMode === 'json' ? '全部文件' : selectedFile?.path ?? '选择文件'}</span>
                    <SkillChevronIcon size={13} />
                  </button>
                  {filePickerOpen ? (
                    <div
                      className={
                        filePickerUp
                          ? `${styles.skillFileMenu} ${styles.skillFileMenuUp}`
                          : styles.skillFileMenu
                      }
                      role="listbox"
                      aria-label="Skill Markdown 文件"
                      data-skill-file-menu
                    >
                      {files.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          role="option"
                          aria-selected={file.path === selectedFile?.path}
                          className={
                            file.path === selectedFile?.path
                              ? `${styles.skillFileOption} ${styles.skillFileOptionOn}`
                              : styles.skillFileOption
                          }
                          title={file.path}
                          data-skill-file-option={file.path}
                          onClick={() => {
                            setSelectedPath(file.path)
                            setFilePickerOpen(false)
                          }}
                        >
                          <SkillFileIcon size={14} />
                          <span>{file.path}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className={styles.skillViewToggle} role="group" aria-label="Skill 显示格式">
                  <button
                    type="button"
                    className={
                      viewMode === 'document'
                        ? `${styles.skillViewButton} ${styles.skillViewButtonOn}`
                        : styles.skillViewButton
                    }
                    aria-pressed={viewMode === 'document'}
                    aria-label="文档视图"
                    title="文档视图"
                    data-skill-view="document"
                    onClick={() => setViewMode('document')}
                  >
                    <SkillEyeIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className={
                      viewMode === 'json'
                        ? `${styles.skillViewButton} ${styles.skillViewButtonOn}`
                        : styles.skillViewButton
                    }
                    aria-pressed={viewMode === 'json'}
                    aria-label="JSON 视图"
                    title="JSON 视图"
                    data-skill-view="json"
                    onClick={() => {
                      setFilePickerOpen(false)
                      setViewMode('json')
                    }}
                  >
                    <SkillCodeIcon size={16} />
                  </button>
                </div>
              </div>
            </div>
            {bodyLoading ? (
              <div className={styles.skillBodyEmpty} data-skill-detail-body-loading>
                正在读取 Skill 正文…
              </div>
            ) : bodyError ? (
              <div className={styles.skillBodyEmpty} role="alert" data-skill-detail-files-error>
                {bodyError}
              </div>
            ) : viewMode === 'json' && files.length ? (
              <pre
                className={`${styles.skillBody} ${styles.skillJsonBody}`}
                data-skill-detail-body
                data-skill-detail-json
              >
                {jsonText}
              </pre>
            ) : selectedFile ? (
              <pre
                className={styles.skillBody}
                data-skill-detail-body
                data-skill-file-content={selectedFile.path}
              >
                {selectedFile.content}
              </pre>
            ) : (
              <div className={styles.skillBodyEmpty} data-skill-detail-body-empty>
                这个目录条目只有简介和示例，没有可执行的 Skill 正文。
              </div>
            )}
            {onEdit ? (
              <div className={styles.detailSecondaryActions}>
                <button
                  type="button"
                  className={styles.ghost}
                  data-skill-detail-edit
                  onClick={onEdit}
                >
                  编辑 Skill
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
