import { useMemo, useRef, useState } from 'react'
import { useSkills } from '../../app/providers/SkillStoreProvider'
import {
  SKILL_LIMITS,
  parseSkillMarkdown,
  validateSkill,
  type Skill,
  type SkillInputMode,
} from '../../domain/prompt/skill'
import styles from './SkillsPage.module.css'

const INPUT_MODE_LABEL: Record<SkillInputMode, string> = {
  text: '需要文本',
  image: '需要图片',
  any: '文本或图片',
}

/**
 * 技能库的**面板体**（列表 + 编辑 + 导入），不含页面外壳。
 *
 * 拆出来的理由（用户 2026-09-25「后台中枢」）：同一份技能管理要出现在**两个地方**——
 * 独立的 `/skills` 页（画布面板缺技能时会深链到那里），以及后台设置页的「技能」分区。
 * 若各写一份，两边迟早分叉（一边加了导入、另一边没有）。
 *
 * 页面外壳（顶栏与返回）留在 `SkillsPage`，本组件只负责内容。
 */
export function SkillsPanel() {
  const { skills, loading, create, save, remove } = useSkills()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Omit<Skill, 'id' | 'updatedAt'> | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const selected = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId],
  )

  const pick = (skill: Skill) => {
    setSelectedId(skill.id)
    setDraft({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      inputMode: skill.inputMode,
      tags: skill.tags,
    })
    setNotice(null)
  }

  const startNew = () => {
    setSelectedId(null)
    setDraft({ name: '', description: '', content: '', inputMode: 'text', tags: [] })
    setNotice(null)
  }

  const saveDraft = async () => {
    if (!draft) return
    const err = validateSkill(draft)
    if (err) {
      setNotice({ kind: 'error', text: err })
      return
    }
    try {
      if (selected) {
        await save({ ...draft, id: selected.id, updatedAt: Date.now() })
        setNotice({ kind: 'ok', text: '已保存' })
      } else {
        const created = await create(draft)
        setSelectedId(created.id)
        setNotice({ kind: 'ok', text: '已新建' })
      }
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  /**
   * 导入 md（用户 2026-09-24：「上传 md 文件然后自动加载解析」）。
   *
   * 支持多选：一次导入一整组技能是常见需求（从别处拷一批过来）。
   * **逐个独立成败**：其中一个格式不对，不该让其余几个也失败 ——
   * 所以收集成功数与失败原因，最后一起报，而不是遇到第一个错误就中断。
   */
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    let ok = 0
    const failed: string[] = []
    for (const file of Array.from(files)) {
      try {
        const raw = await file.text()
        const fallbackName = file.name.replace(/\.md$/i, '')
        const parsed = parseSkillMarkdown(raw, fallbackName)
        if (!parsed.ok) {
          failed.push(`${file.name}：${parsed.error}`)
          continue
        }
        await create(parsed.skill)
        ok += 1
      } catch (e) {
        failed.push(`${file.name}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (failed.length === 0) {
      setNotice({ kind: 'ok', text: `已导入 ${ok} 个技能` })
    } else {
      setNotice({
        kind: 'error',
        text: `成功 ${ok} 个，失败 ${failed.length} 个 —— ${failed.join('；')}`,
      })
    }
  }

  const removeSelected = async () => {
    if (!selected) return
    await remove(selected.id)
    setSelectedId(null)
    setDraft(null)
    setNotice({ kind: 'ok', text: '已删除' })
  }

  return (
    /**
     * 面板自带内边距（用户 2026-09-25 后台改版后才需要）：
     * 在 `/skills` 独立页里，外层 `.page` 提供了整页 padding；
     * 而它现在还被后台中枢的「技能库」分区复用，那里右栏**没有**外层内边距，
     * 光靠外层会让内容贴着卡片边缘。收进组件内，两个宿主就都对了。
     */
    <div className={styles.panelShell}>
      <div className={styles.topActions} data-skills-actions>
        <button type="button" className={styles.ghost} data-skills-new onClick={startNew}>
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
          onChange={(e) => {
            void importFiles(e.target.files)
            // 清掉 value：同一个文件连选两次也要能触发 change
            e.target.value = ''
          }}
        />
      </div>

      {notice && (
        <div
          className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeErr}
          data-skills-notice={notice.kind}
          role="status"
          aria-live="polite"
        >
          {notice.text}
        </div>
      )}

      <div className={styles.body}>
        <aside className={styles.list}>
          {loading ? (
            <div className={styles.empty}>加载中…</div>
          ) : skills.length === 0 ? (
            <div className={styles.empty}>
              还没有技能。
              <br />
              「新建」写一个，或「导入 md」。
            </div>
          ) : (
            skills.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === selectedId ? styles.itemOn : styles.item}
                data-skill-item={s.id}
                onClick={() => pick(s)}
              >
                <span className={styles.itemName}>{s.name}</span>
                <span className={styles.itemMeta}>{INPUT_MODE_LABEL[s.inputMode]}</span>
              </button>
            ))
          )}
        </aside>

        <section className={styles.editor}>
          {!draft ? (
            <div className={styles.empty}>
              选一个技能开始编辑，或点「＋ 新建」。
              <br />
              <br />
              技能正文会作为**系统指令**发给文本模型；提示词节点的正文作为输入。
            </div>
          ) : (
            <>
              <label className={styles.field}>
                <span className={styles.label}>名称（≤{SKILL_LIMITS.nameMax} 字）</span>
                <input
                  className={styles.input}
                  data-skill-name
                  value={draft.name}
                  placeholder="例如：详情页策划"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>说明（可选，悬停时显示）</span>
                <input
                  className={styles.input}
                  data-skill-desc
                  value={draft.description}
                  placeholder="例如：按母婴产品特性生成详情页五段结构"
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>需要的输入</span>
                <select
                  className={styles.input}
                  data-skill-inputmode
                  value={draft.inputMode}
                  onChange={(e) =>
                    setDraft({ ...draft, inputMode: e.target.value as SkillInputMode })
                  }
                >
                  <option value="text">文本（节点正文）</option>
                  <option value="image">图片（上游生成节点的产物）</option>
                  <option value="any">文本或图片</option>
                </select>
              </label>

              <label className={`${styles.field} ${styles.grow}`}>
                <span className={styles.label}>
                  技能正文（= 系统指令，≤{SKILL_LIMITS.contentMax} 字）
                  <span className={styles.counter}>
                    {draft.content.length} / {SKILL_LIMITS.contentMax}
                  </span>
                </span>
                <textarea
                  className={styles.textarea}
                  data-skill-content
                  value={draft.content}
                  placeholder={
                    '你是资深电商详情页策划。请按「主图区 / 卖点区 / 场景区 / 信任区 / 转化区」五段输出……'
                  }
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  data-skill-save
                  onClick={() => void saveDraft()}
                >
                  {selected ? '保存' : '创建'}
                </button>
                {selected && (
                  <button
                    type="button"
                    className={styles.danger}
                    data-skill-remove
                    onClick={() => void removeSelected()}
                  >
                    删除
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
