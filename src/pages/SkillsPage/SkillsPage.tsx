import { useState } from 'react'
import { usePresetText } from '../../app/providers/PresetTextProvider'
import { presetTextEntries } from '../../domain/prompt/presetText'
import type { Skill } from '../../domain/prompt/skill'
import { PresetTextSection } from './PresetTextSection'
import { SkillEditor } from './SkillEditor'
import { SkillsBrowser, type SkillFilter } from './SkillsBrowser'
import styles from './SkillsPage.module.css'

/**
 * 技能库一级页（产品文档 §7A）。
 *
 * 两层结构：卡片浏览 → 点击卡片进入编辑。技能与「功能预设词」都归本页，
 * 渠道配置页不再展示它们（文档 §7A.4）。
 *
 * 状态全部留在本组件：搜索与筛选项跨层保留（文档 §7A.1 明确要求返回浏览层时
 * 不丢筛选）。草稿也由本页持有 —— 新建时还没有 id，只有保存那一刻才落库，
 * 用户中途放弃不会在库里留下空技能。
 */
type Draft = Omit<Skill, 'id' | 'updatedAt'>

export function SkillsPage() {
  const presetText = usePresetText()
  const presets = presetTextEntries(presetText.overrides)

  const [level, setLevel] = useState<'browse' | 'edit' | 'presets'>('browse')
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalId, setOriginalId] = useState<string | null>(null)

  const openSkill = (skill: Skill) => {
    setDraft({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      inputMode: skill.inputMode,
      tags: skill.tags,
    })
    setOriginalId(skill.id)
    setLevel('edit')
  }

  const openNew = (empty: Draft) => {
    setDraft(empty)
    setOriginalId(null)
    setLevel('edit')
  }

  const backToBrowse = () => {
    setLevel('browse')
    setDraft(null)
    setOriginalId(null)
  }

  return (
    <div className={styles.page} data-skills-page>
      {level === 'edit' && draft && (
        <div className={styles.editorStage} data-skill-editor-stage>
          <div className={styles.levelBar}>
            <button type="button" className={styles.ghost} data-skills-back onClick={backToBrowse}>
              ← 返回浏览
            </button>
            <span className={styles.levelTitle}>{originalId ? '编辑技能' : '新建技能'}</span>
          </div>
          <SkillEditor
            draft={draft}
            originalId={originalId}
            onChange={setDraft}
            onSaved={backToBrowse}
            onDeleted={backToBrowse}
          />
        </div>
      )}

      {level === 'presets' && (
        <div className={styles.presetsStage} data-presets-stage>
          <div className={styles.levelBar}>
            <button type="button" className={styles.ghost} data-presets-back onClick={backToBrowse}>
              ← 返回浏览
            </button>
            <span className={styles.levelTitle}>功能预设词</span>
          </div>
          <PresetTextSection presets={presets} presetText={presetText} />
        </div>
      )}

      {level === 'browse' && (
        <div className={styles.browserStage} data-skills-browser-stage>
          <SkillsBrowser
            filter={filter}
            query={query}
            onFilter={setFilter}
            onQuery={setQuery}
            onPick={openSkill}
            onNew={openNew}
            onOpenPresets={() => setLevel('presets')}
          />
        </div>
      )}
    </div>
  )
}
