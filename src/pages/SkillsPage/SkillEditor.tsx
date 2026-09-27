import { useEffect, useState } from 'react'
import { useSkills } from '../../app/providers/SkillStoreProvider'
import { SKILL_LIMITS, validateSkill, type Skill, type SkillInputMode } from '../../domain/prompt/skill'
import styles from './SkillsPage.module.css'

/**
 * 技能库**第二层：编辑**（产品文档 §7A.2）。
 *
 * 接收一份草稿（新建的空草稿、或点卡片带进来的已有技能）+ 可选的原技能 id，
 * 只负责「改 + 保存 / 删除」；返回第一层由页面（顶部的返回）负责。
 *
 * 为什么把草稿交给页面持有、而不是自己从 `selectedId` 查：
 * 「新建」时**还没有 id**，它是纯草稿。若这里只认 id，
 * 新建那条路就得先落库再编辑 —— 用户点一下「新建」库里就多一条空技能，
 * 放弃了也没法假装没发生。草稿由页面持有，保存时才决定是 create 还是 save。
 */
export function SkillEditor({
  draft,
  originalId,
  onChange,
  onSaved,
  onDeleted,
}: {
  draft: Omit<Skill, 'id' | 'updatedAt'>
  /** 编辑已有技能时是它的 id；新建时为 null */
  originalId: string | null
  onChange: (d: Omit<Skill, 'id' | 'updatedAt'>) => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const { save, create, remove } = useSkills()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  /* 换了一条技能就清掉上一条的提示与二次确认，避免串味 */
  useEffect(() => {
    setNotice(null)
    setConfirmDelete(false)
  }, [originalId])

  const saveDraft = async () => {
    const err = validateSkill(draft)
    if (err) {
      setNotice({ kind: 'error', text: err })
      return
    }
    try {
      if (originalId) {
        await save({ ...draft, id: originalId, updatedAt: Date.now() })
        setNotice({ kind: 'ok', text: '已保存' })
      } else {
        await create(draft)
        setNotice({ kind: 'ok', text: '已新建' })
      }
      onSaved()
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const removeSelected = async () => {
    if (!originalId) return
    try {
      await remove(originalId)
      onDeleted()
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <section className={styles.editor} data-skill-editor>
      {notice && (
        <div
          className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeErr}
          data-skill-notice={notice.kind}
          role="status"
          aria-live="polite"
        >
          {notice.text}
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.label}>名称（≤{SKILL_LIMITS.nameMax} 字）</span>
        <input
          className={styles.input}
          data-skill-name
          value={draft.name}
          placeholder="例如：详情页策划"
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>说明（可选，悬停时显示）</span>
        <input
          className={styles.input}
          data-skill-desc
          value={draft.description}
          placeholder="例如：按母婴产品特性生成详情页五段结构"
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>需要的输入</span>
        <select
          className={styles.input}
          data-skill-inputmode
          value={draft.inputMode}
          onChange={(e) => onChange({ ...draft, inputMode: e.target.value as SkillInputMode })}
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
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
        />
      </label>

      <div className={styles.actions}>
        <button type="button" className={styles.primary} data-skill-save onClick={() => void saveDraft()}>
          {originalId ? '保存' : '创建'}
        </button>
        {originalId &&
          (confirmDelete ? (
            <>
              <span className={styles.confirmHint}>删除后不可恢复</span>
              <button
                type="button"
                className={styles.danger}
                data-skill-remove-yes
                onClick={() => void removeSelected()}
              >
                确认删除
              </button>
              <button
                type="button"
                className={styles.ghost}
                data-skill-remove-cancel
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.danger}
              data-skill-remove
              onClick={() => setConfirmDelete(true)}
            >
              删除
            </button>
          ))}
      </div>
    </section>
  )
}
