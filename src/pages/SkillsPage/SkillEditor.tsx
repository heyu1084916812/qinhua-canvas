import { useEffect, useState } from 'react'
import { useSkills } from '../../app/providers/SkillStoreProvider'
import {
  SKILL_LIMITS,
  validateSkill,
  type BuiltinSkill,
  type SkillInputMode,
  type UserSkill,
} from '../../domain/prompt/skill'
import styles from './SkillsPage.module.css'

/**
 * 技能库第二层编辑。
 *
 * `builtin !== null` 时进入只读模式：只能复制为用户技能或恢复用户副本；
 * 不能保存、删除，也不写 `builtinSkills` 表。
 */
export function SkillEditor({
  draft,
  originalId,
  builtin,
  onChange,
  onSaved,
  onDeleted,
  onCopied,
}: {
  draft: Omit<UserSkill, 'id' | 'updatedAt' | 'source'>
  /** 编辑已有用户技能时是它的 id；新建时是 null。 */
  originalId: string | null
  /** 非空时为内置技能只读视图。 */
  builtin: BuiltinSkill | null
  onChange: (d: Omit<UserSkill, 'id' | 'updatedAt' | 'source'>) => void
  onSaved: () => void
  onDeleted: () => void
  /** 复制内置技能后切到用户副本编辑。 */
  onCopied: (copy: UserSkill) => void
}) {
  const { save, create, remove, userSkills, copyBuiltin, restoreBuiltin } = useSkills()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const userCopy = builtin ? userSkills.find((s) => s.builtinId === builtin.id) ?? null : null

  useEffect(() => {
    setNotice(null)
    setConfirmDelete(false)
    setConfirmRestore(false)
  }, [originalId, builtin?.id])

  const saveDraft = async () => {
    const err = validateSkill(draft)
    if (err) {
      setNotice({ kind: 'error', text: err })
      return
    }
    try {
      if (originalId) {
        await save({ ...draft, id: originalId, source: 'user', updatedAt: Date.now() })
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

  const copyBuiltinToMine = async () => {
    if (!builtin) return
    try {
      const copy = await copyBuiltin(builtin)
      onCopied(copy)
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const restoreFromBuiltin = async () => {
    if (!builtin) return
    try {
      await restoreBuiltin(builtin)
      setConfirmRestore(false)
      setNotice({ kind: 'ok', text: '已恢复默认' })
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

  const readonly = !!builtin

  return (
    <section className={styles.editor} data-skill-editor data-skill-readonly={readonly}>
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

      {builtin && (
        <div className={styles.sourceNote} data-skill-builtin-note>
          内置技能只读。复制为我的技能后即可修改；恢复默认只改你的副本，不会改内置正文。
        </div>
      )}

      {userCopy && builtin && (
        <div className={styles.copyNote} data-skill-copy-note>
          已有我的副本：{userCopy.name}
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.label}>名称（≤{SKILL_LIMITS.nameMax} 字）</span>
        <input
          className={styles.input}
          data-skill-name
          value={draft.name}
          placeholder="例如：详情页策划"
          readOnly={readonly}
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
          readOnly={readonly}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>需要的输入</span>
        <select
          className={styles.input}
          data-skill-inputmode
          value={draft.inputMode}
          disabled={readonly}
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
          readOnly={readonly}
          placeholder="你是资深电商详情页策划。请按「主图区 / 卖点区 / 场景区 / 信任区 / 转化区」输出……"
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
        />
      </label>

      <div className={styles.actions}>
        {builtin ? (
          <>
            <button
              type="button"
              className={styles.primary}
              data-skill-copy
              onClick={() => void copyBuiltinToMine()}
            >
              复制为我的技能
            </button>
            {userCopy && (
              <button
                type="button"
                className={styles.ghost}
                data-skill-edit-copy
                onClick={() => onCopied(userCopy)}
              >
                编辑我的副本
              </button>
            )}
            {userCopy && !confirmRestore && (
              <button
                type="button"
                className={styles.danger}
                data-skill-restore
                onClick={() => setConfirmRestore(true)}
              >
                恢复默认
              </button>
            )}
            {confirmRestore && (
              <>
                <span className={styles.confirmHint}>这会覆盖你对副本的修改</span>
                <button
                  type="button"
                  className={styles.danger}
                  data-skill-restore-yes
                  onClick={() => void restoreFromBuiltin()}
                >
                  确认恢复
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  data-skill-restore-cancel
                  onClick={() => setConfirmRestore(false)}
                >
                  取消
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.primary}
              data-skill-save
              onClick={() => void saveDraft()}
            >
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
          </>
        )}
      </div>
    </section>
  )
}
