import { useEffect, useRef, useState } from 'react'
import type { BuiltinSkill, UserSkill } from '../../domain/prompt/skill'
import {
  libtvCanvasCaseOf,
  libtvHasBody,
  libtvMediaLabel,
  libtvPreviewOf,
  type LibtvSkill,
} from '../../domain/prompt/libtvSkill'
import { loadLibtvSkillBody } from '../../state/project/libtvSkillCatalog'
import { SkillCloseIcon, SkillExternalIcon, SkillStarIcon } from './SkillLibraryIcons'
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
  const [body, setBody] = useState('')
  const [bodyLoading, setBodyLoading] = useState(source.kind === 'libtv')
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
    if (source.kind !== 'libtv') {
      setBody(source.skill.content)
      setBodyLoading(false)
      return
    }
    let alive = true
    setBody('')
    setBodyLoading(true)
    void loadLibtvSkillBody(source.skill)
      .then((content) => {
        if (alive) setBody(content ?? '')
      })
      .finally(() => {
        if (alive) setBodyLoading(false)
      })
    return () => {
      alive = false
    }
  }, [source])

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

            <h2 className={styles.sectionTitle}>Skill</h2>
            {bodyLoading ? (
              <div className={styles.skillBodyEmpty} data-skill-detail-body-loading>
                正在读取 Skill 正文…
              </div>
            ) : body ? (
              <pre className={styles.skillBody} data-skill-detail-body>
                {body}
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
