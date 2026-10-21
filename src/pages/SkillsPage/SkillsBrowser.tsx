import { useEffect, useMemo, useRef, useState } from 'react'
import { noticeA11y } from '../../domain/ui/notice'
import { useSkills } from '../../app/providers/SkillStoreProvider'
import {
  parseSkillMarkdown,
  type BuiltinSkill,
  type UserSkill,
} from '../../domain/prompt/skill'
import {
  LIBTV_CATEGORIES,
  libtvCardImageOf,
  libtvCategoryOf,
  libtvHasBody,
  libtvMediaLabel,
  type LibtvCategory,
  type LibtvSkill,
  type LibtvSourceGroup,
} from '../../domain/prompt/libtvSkill'
import {
  LIBTV_CATEGORY_COUNTS,
  LIBTV_SKILLS,
} from '../../state/project/libtvSkillCatalog'
import { SkillStarIcon } from './SkillLibraryIcons'
import styles from './SkillsPage.module.css'

export type { LibtvSourceGroup }

export type SkillCardPick =
  | { kind: 'libtv'; skill: LibtvSkill }
  | { kind: 'builtin'; skill: BuiltinSkill }
  | { kind: 'user'; skill: UserSkill }

const JIMENG_BUILTIN_IDS = new Set([
  'builtin:tvc-creation',
  'builtin:video-shot-design',
  'builtin:video-sop',
  'builtin:image-logo',
  'builtin:image-ecommerce',
  'builtin:image-poster',
  'builtin:video-reverse-skill',
])

const SOURCE_LABEL: Record<SkillCardPick['kind'], string> = {
  libtv: 'LibTV',
  builtin: '轻画内置',
  user: '我的技能',
}

function searchHit(values: readonly string[], query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || values.some((value) => value.toLowerCase().includes(q))
}

export function SkillsBrowser({
  source,
  category,
  query,
  favorites,
  onSource,
  onCategory,
  onQuery,
  onToggleFavorite,
  onOpenDetail,
  onUse,
  onNew,
  onOpenPresets,
}: {
  source: LibtvSourceGroup
  category: LibtvCategory
  query: string
  favorites: readonly string[]
  onSource: (source: LibtvSourceGroup) => void
  onCategory: (category: LibtvCategory) => void
  onQuery: (query: string) => void
  onToggleFavorite: (pick: SkillCardPick) => void
  onOpenDetail: (pick: SkillCardPick) => void
  onUse: (pick: SkillCardPick) => void
  onNew: (draft: Omit<UserSkill, 'id' | 'updatedAt' | 'source'>) => void
  onOpenPresets: () => void
}) {
  const { builtinSkills, userSkills, loading, create } = useSkills()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [visibleLimit, setVisibleLimit] = useState(60)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const jimengSkills = useMemo(
    () => builtinSkills.filter((skill) => JIMENG_BUILTIN_IDS.has(skill.id)),
    [builtinSkills],
  )
  const otherBuiltins = useMemo(
    () => builtinSkills.filter((skill) => !JIMENG_BUILTIN_IDS.has(skill.id)),
    [builtinSkills],
  )
  const mineCount = mineCountOf(userSkills, otherBuiltins)

  const cards = useMemo<SkillCardPick[]>(() => {
    if (source === 'libtv') {
      return LIBTV_SKILLS.filter((skill) => libtvCategoryOf(skill) === category)
        .filter((skill) =>
          searchHit([skill.name, skill.description, skill.useScenario, ...skill.tags], query),
        )
        .map((skill) => ({ kind: 'libtv' as const, skill }))
    }
    const list =
      source === 'jimeng'
        ? jimengSkills.map((skill) => ({ kind: 'builtin' as const, skill }))
        : [
            ...userSkills.map((skill) => ({ kind: 'user' as const, skill })),
            ...otherBuiltins.map((skill) => ({ kind: 'builtin' as const, skill })),
          ]
    return list.filter((item) =>
      searchHit([item.skill.name, item.skill.description, ...item.skill.tags], query),
    )
  }, [category, jimengSkills, otherBuiltins, query, source, userSkills])

  useEffect(() => {
    setVisibleLimit(60)
  }, [category, query, source])

  const shownCards = cards.slice(0, visibleLimit)

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    let ok = 0
    const failed: string[] = []
    for (const file of Array.from(files)) {
      try {
        const parsed = parseSkillMarkdown(await file.text(), file.name.replace(/\.md$/i, ''))
        if (!parsed.ok) {
          failed.push(`${file.name}：${parsed.error}`)
          continue
        }
        await create(parsed.skill)
        ok += 1
      } catch (error) {
        failed.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (ok > 0) onSource('mine')
    setNotice(
      failed.length === 0
        ? { kind: 'ok', text: `已导入 ${ok} 条技能` }
        : {
            kind: 'error',
            text: `成功 ${ok} 条，失败 ${failed.length} 条：${failed.join('；')}`,
          },
    )
  }

  const openOnEnter = (event: React.KeyboardEvent, pick: SkillCardPick) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onOpenDetail(pick)
  }

  return (
    <div className={styles.browser} data-skills-browser>
      <div className={styles.sourceTabs} role="tablist" aria-label="技能来源">
        <button
          type="button"
          role="tab"
          aria-selected={source === 'libtv'}
          className={source === 'libtv' ? `${styles.sourceTab} ${styles.sourceTabOn}` : styles.sourceTab}
          data-skills-source-tab="libtv"
          onClick={() => onSource('libtv')}
        >
          LibTV
          <span>{LIBTV_SKILLS.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'jimeng'}
          className={source === 'jimeng' ? `${styles.sourceTab} ${styles.sourceTabOn}` : styles.sourceTab}
          data-skills-source-tab="jimeng"
          onClick={() => onSource('jimeng')}
        >
          即梦
          <span>{jimengSkills.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'mine'}
          className={source === 'mine' ? `${styles.sourceTab} ${styles.sourceTabOn}` : styles.sourceTab}
          data-skills-source-tab="mine"
          onClick={() => onSource('mine')}
        >
          我的
          <span>{mineCount}</span>
        </button>
      </div>

      <div className={styles.browserBar}>
        {source === 'libtv' ? (
          <div className={styles.filters} role="tablist" aria-label="LibTV 分类">
            {LIBTV_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={category === item}
                className={category === item ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                data-skills-filter={item}
                onClick={() => onCategory(item)}
              >
                {item}
                <span className={styles.chipCount}>{LIBTV_CATEGORY_COUNTS.get(item) ?? 0}</span>
              </button>
            ))}
          </div>
        ) : (
          <span className={styles.sourceSummary}>
            {source === 'jimeng' ? '项目内置的即梦 Skill' : '我的技能与轻画内置'}
          </span>
        )}
        <input
          className={styles.search}
          type="search"
          placeholder="搜索 Skill"
          aria-label="搜索 Skill"
          value={query}
          data-skills-search
          onChange={(event) => onQuery(event.target.value)}
        />
        <div className={styles.browserActions}>
          <button type="button" className={styles.ghost} data-skills-presets onClick={onOpenPresets}>
            功能预设词
          </button>
          <button
            type="button"
            className={styles.ghost}
            data-skills-new
            onClick={() =>
              onNew({ name: '', description: '', content: '', inputMode: 'text', tags: [] })
            }
          >
            ＋ 新建
          </button>
          <button
            type="button"
            className={styles.primary}
            data-skills-import
            onClick={() => fileRef.current?.click()}
          >
            导入 md
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,text/markdown"
            multiple
            hidden
            data-skills-file
            onChange={(event) => {
              void importFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
      </div>

      {notice ? (
        <div
          className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeErr}
          data-skills-notice={notice.kind}
          {...noticeA11y(notice.kind === 'error' ? 'error' : 'info')}
        >
          {notice.text}
        </div>
      ) : null}

      <div className={styles.cards} data-skills-cards>
        {loading && source !== 'libtv' ? (
          <div className={styles.empty}>加载中…</div>
        ) : cards.length === 0 ? (
          <div className={styles.empty} data-skills-empty>
            没有匹配的 Skill
          </div>
        ) : (
          shownCards.map((pick) => {
            const skill = pick.skill
            const favorite = favorites.includes(skill.id)
            const runnable = pick.kind === 'libtv' ? libtvHasBody(pick.skill) : true
            const image =
              pick.kind === 'libtv' ? libtvCardImageOf(pick.skill) : pick.skill.image ?? null
            const mediaLabel =
              pick.kind === 'libtv' ? libtvMediaLabel(pick.skill.resultType) : null
            return (
              <article
                key={`${pick.kind}:${skill.id}`}
                className={styles.card}
                role="button"
                tabIndex={0}
                aria-label={`${skill.name}，双击查看详情`}
                title="双击查看详情"
                data-skill-item={skill.id}
                data-skill-source={pick.kind}
                data-skill-runnable={runnable}
                onDoubleClick={() => onOpenDetail(pick)}
                onKeyDown={(event) => openOnEnter(event, pick)}
              >
                <div className={styles.cardShot} data-skill-shot={skill.id}>
                  {image ? (
                    <img className={styles.cardShotImg} src={image} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.cardShotEmpty}>
                      {pick.kind === 'libtv' ? '目录示例' : '技能'}
                    </span>
                  )}
                  {mediaLabel ? (
                    <span className={styles.mediaBadge} data-skill-media-type={mediaLabel}>
                      {mediaLabel}
                    </span>
                  ) : null}
                </div>

                <div className={styles.cardBody}>
                  <span className={styles.cardName}>{skill.name}</span>
                  {skill.description ? (
                    <span className={styles.cardDesc}>{skill.description}</span>
                  ) : null}
                  <span className={styles.cardMeta}>
                    {SOURCE_LABEL[pick.kind]}
                    {pick.kind === 'libtv' && !runnable ? ' · 暂无正文' : ''}
                  </span>
                </div>

                <div className={styles.cardActions} data-skill-hover-actions>
                  <button
                    type="button"
                    className={favorite ? `${styles.cardActionIcon} ${styles.starOn}` : styles.cardActionIcon}
                    aria-pressed={favorite}
                    aria-label={favorite ? `取消收藏 ${skill.name}` : `收藏 ${skill.name}`}
                    title={favorite ? '取消收藏' : '收藏'}
                    data-skill-card-favorite={skill.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleFavorite(pick)
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <SkillStarIcon size={15} filled={favorite} />
                  </button>
                  <button
                    type="button"
                    className={styles.cardUse}
                    disabled={!runnable}
                    title={runnable ? '添加到 Agent' : '暂无 Skill 正文，不能添加到 Agent'}
                    data-skill-card-use={skill.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      onUse(pick)
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    使用
                  </button>
                </div>
              </article>
            )
          })
        )}
        {cards.length > shownCards.length ? (
          <div className={styles.moreRow}>
            <button
              type="button"
              className={styles.ghost}
              data-skills-more
              onClick={() => setVisibleLimit((limit) => limit + 60)}
            >
              加载更多（已显示 {shownCards.length} / {cards.length}）
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function mineCountOf(users: readonly UserSkill[], builtins: readonly BuiltinSkill[]): number {
  return users.length + builtins.length
}
