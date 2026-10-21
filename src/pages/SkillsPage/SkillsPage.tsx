import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { usePresetText } from '../../app/providers/PresetTextProvider'
import { useSkills } from '../../app/providers/SkillStoreProvider'
import { presetTextEntries } from '../../domain/prompt/presetText'
import type { BuiltinSkill, UserSkill } from '../../domain/prompt/skill'
import {
  libtvHasBody,
  type LibtvCategory,
  type LibtvSourceGroup,
} from '../../domain/prompt/libtvSkill'
import { noticeA11y } from '../../domain/ui/notice'
import { createPresetStore } from '../../state/project/presetStore'
import { loadLibtvSkillBody } from '../../state/project/libtvSkillCatalog'
import { PresetTextSection } from './PresetTextSection'
import { SkillDetailDialog, type SkillDetailSource } from './SkillDetailDialog'
import { SkillEditor } from './SkillEditor'
import { SkillsBrowser, type SkillCardPick } from './SkillsBrowser'
import styles from './SkillsPage.module.css'

type Draft = Omit<UserSkill, 'id' | 'updatedAt' | 'source'>

export function SkillsPage() {
  const platform = usePlatform()
  const presetText = usePresetText()
  const skills = useSkills()
  const presets = useMemo(() => createPresetStore(platform.storage), [platform])
  const presetsList = presetTextEntries(presetText.overrides)

  const [level, setLevel] = useState<'browse' | 'edit' | 'presets'>('browse')
  const [source, setSource] = useState<LibtvSourceGroup>('libtv')
  const [category, setCategory] = useState<LibtvCategory>('推荐')
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [detail, setDetail] = useState<SkillCardPick | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalId, setOriginalId] = useState<string | null>(null)
  const [builtin, setBuiltin] = useState<BuiltinSkill | null>(null)

  useEffect(() => {
    let alive = true
    void presets.loadSkillFavorites().then((ids) => {
      if (alive) setFavorites(ids)
    })
    return () => {
      alive = false
    }
  }, [presets])

  const openSkill = (pick: SkillCardPick) => {
    if (pick.kind === 'libtv') return
    setDraft({
      name: pick.skill.name,
      description: pick.skill.description,
      content: pick.skill.content,
      inputMode: pick.skill.inputMode,
      tags: pick.skill.tags,
      builtinId: pick.kind === 'user' ? pick.skill.builtinId : undefined,
      libtvId: pick.kind === 'user' ? pick.skill.libtvId : undefined,
    })
    setBuiltin(pick.kind === 'builtin' ? pick.skill : null)
    setOriginalId(pick.kind === 'user' ? pick.skill.id : null)
    setDetail(null)
    setLevel('edit')
  }

  const openNew = (empty: Draft) => {
    setSource('mine')
    setQuery('')
    setDraft(empty)
    setOriginalId(null)
    setBuiltin(null)
    setLevel('edit')
  }

  const backToBrowse = () => {
    setLevel('browse')
    setDraft(null)
    setOriginalId(null)
    setBuiltin(null)
  }

  const closeDetail = useCallback(() => setDetail(null), [])

  const toggleFavorite = async (pick: SkillCardPick) => {
    const id = pick.skill.id
    const next = favorites.includes(id)
      ? favorites.filter((item) => item !== id)
      : [...favorites, id]
    setFavorites(next)
    await presets.saveSkillFavorites(next)
  }

  const useSkill = async (pick: SkillCardPick) => {
    setBusy(true)
    setNotice(null)
    try {
      let agentSkillId = pick.skill.id
      if (pick.kind === 'libtv') {
        if (!libtvHasBody(pick.skill)) {
          setNotice({ kind: 'error', text: '这条目录没有可执行的 Skill 正文，暂不能添加到 Agent。' })
          return
        }
        const existing = skills.userSkills.find((skill) => skill.libtvId === pick.skill.id)
        if (existing) {
          agentSkillId = existing.id
        } else {
          const content = await loadLibtvSkillBody(pick.skill)
          if (!content) {
            setNotice({ kind: 'error', text: '读取 Skill 正文失败，暂不能添加到 Agent。' })
            return
          }
          const created = await skills.create({
            name: pick.skill.name,
            description: pick.skill.description,
            content,
            inputMode: 'any',
            tags: pick.skill.tags,
            image: pick.skill.coverUrl ?? undefined,
            libtvId: pick.skill.id,
          })
          agentSkillId = created.id
        }
      }
      await presets.saveAgentDefaultSkill(agentSkillId)
      setNotice({ kind: 'ok', text: `已将「${pick.skill.name}」设为 Agent 技能。` })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const detailSource: SkillDetailSource | null = useMemo(
    () =>
      detail?.kind === 'libtv'
        ? { kind: 'libtv', skill: detail.skill }
        : detail?.kind === 'builtin'
          ? { kind: 'builtin', skill: detail.skill }
          : detail?.kind === 'user'
            ? { kind: 'user', skill: detail.skill }
            : null,
    [detail],
  )

  return (
    <div className={styles.page} data-skills-page>
      {notice ? (
        <div
          className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeErr}
          data-skills-action-notice={notice.kind}
          {...noticeA11y(notice.kind === 'error' ? 'error' : 'info')}
        >
          {notice.text}
        </div>
      ) : null}

      {level === 'edit' && draft ? (
        <div className={styles.editorStage} data-skill-editor-stage>
          <div className={styles.levelBar}>
            <button type="button" className={styles.ghost} data-skills-back onClick={backToBrowse}>
              ← 返回技能库
            </button>
            <span className={styles.levelTitle}>
              {builtin ? '内置技能（只读）' : originalId ? '编辑技能' : '新建技能'}
            </span>
          </div>
          <SkillEditor
            draft={draft}
            originalId={originalId}
            builtin={builtin}
            onChange={setDraft}
            onSaved={backToBrowse}
            onDeleted={backToBrowse}
            onCopied={(copy) => {
              setDraft({
                name: copy.name,
                description: copy.description,
                content: copy.content,
                inputMode: copy.inputMode,
                tags: copy.tags,
                builtinId: copy.builtinId,
                libtvId: copy.libtvId,
              })
              setBuiltin(null)
              setOriginalId(copy.id)
            }}
          />
        </div>
      ) : null}

      {level === 'presets' ? (
        <div className={styles.presetsStage} data-presets-stage>
          <div className={styles.levelBar}>
            <button type="button" className={styles.ghost} data-presets-back onClick={backToBrowse}>
              ← 返回技能库
            </button>
            <span className={styles.levelTitle}>功能预设词</span>
          </div>
          <PresetTextSection presets={presetsList} presetText={presetText} />
        </div>
      ) : null}

      {level === 'browse' ? (
        <div className={styles.browserStage} data-skills-browser-stage>
          <SkillsBrowser
            source={source}
            category={category}
            query={query}
            favorites={favorites}
            onSource={(next) => {
              setSource(next)
              setQuery('')
            }}
            onCategory={setCategory}
            onQuery={setQuery}
            onToggleFavorite={(pick) => void toggleFavorite(pick)}
            onOpenDetail={setDetail}
            onUse={(pick) => void useSkill(pick)}
            onNew={openNew}
            onOpenPresets={() => setLevel('presets')}
          />
        </div>
      ) : null}

      {detail && detailSource ? (
        <SkillDetailDialog
          source={detailSource}
          favorite={favorites.includes(detail.skill.id)}
          busy={busy}
          onClose={closeDetail}
          onToggleFavorite={() => void toggleFavorite(detail)}
          onAddToAgent={() => void useSkill(detail)}
          onEdit={detail.kind === 'libtv' ? undefined : () => openSkill(detail)}
        />
      ) : null}
    </div>
  )
}
