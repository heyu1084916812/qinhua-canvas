import { useState } from 'react'
import { usePresetText } from '../../app/providers/PresetTextProvider'
import {
  PRESET_TEXT_MAX,
  presetTextEntries,
  validatePresetText,
  type PromptToolAction,
} from '../../domain/prompt/presetText'
import styles from './PresetTextSection.module.css'

/**
 * 功能预设词（产品文档 §7A.4）。
 *
 * 2026-09-27 从「后台设置的一个分区」**迁到技能库一级页**：
 * 文档 §7A 早就把归宿定死了（「功能预设词的三条系统指令从渠道配置迁到技能库，
 * 渠道配置页不再展示该分区」），代码此前落在设置页里，是没跟上文档。
 *
 * 组件本身几乎没动 —— 它本来就是自成一体的（自己的草稿态、保存与恢复），
 * 换个宿主即可。样式单独一份 module.css：两处共用一个 .module.css
 * 会让「只想改技能库里的样子」变成改到设置页（虽然设置页已经不用它了）。
 */

/**
 * 功能预设词分区（后台中枢，用户 2026-09-25）。
 *
 * 三条固定动作（优化 / 翻译 / 反推）各一段可编辑的**系统指令**。
 * 它是「改造内置动作」——与技能区「新增自己的动作」是两件事，界面上也分区放。
 *
 * 每条的编辑是**草稿态**：先写在本地，点「保存」才落库；这与设置页既有的
 * 渠道表单、模型选择面板同一条口径（中途反悔不该留下半份改动）。
 */
export function PresetTextSection({
  presets,
  presetText,
}: {
  presets: ReturnType<typeof presetTextEntries>
  presetText: ReturnType<typeof usePresetText>
}) {
  /** action → 正在编辑的草稿；只有被点开的那条在草稿里出现 */
  const [drafts, setDrafts] = useState<Partial<Record<PromptToolAction, string>>>({})
  const [busy, setBusy] = useState<PromptToolAction | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const save = async (action: PromptToolAction) => {
    const draft = drafts[action]
    if (draft === undefined) return
    const err = validatePresetText(draft)
    if (err) {
      setNotice({ kind: 'error', text: err })
      return
    }
    setBusy(action)
    try {
      await presetText.save(action, draft)
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[action]
        return next
      })
      setNotice({ kind: 'ok', text: '已保存' })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  /** 恢复默认 = 清掉覆盖值（写 null），于是它与「从没改过」是同一种状态 */
  const restore = async (action: PromptToolAction) => {
    setBusy(action)
    try {
      await presetText.save(action, null)
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[action]
        return next
      })
      setNotice({ kind: 'ok', text: '已恢复默认' })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.presetHost} data-settings-presets>
      <p className={styles.presetLead}>
        提示词节点上的这三个按钮各有一段**系统指令**。改这里就是改它们的行为 ——
        想新增一个自己的动作，去「技能库」。
      </p>
      {notice && (
        <div
          className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeErr}
          data-settings-preset-notice={notice.kind}
          role="status"
          aria-live="polite"
        >
          {notice.text}
        </div>
      )}
      <div className={styles.presetList}>
        {presets.map((p) => {
          const draft = drafts[p.id]
          const editing = draft !== undefined
          const value = editing ? draft : p.content
          return (
            <section key={p.id} className={styles.presetCard} data-preset-card={p.id}>
              <header className={styles.presetHead}>
                <span className={styles.presetName} data-preset-label>
                  {p.label}
                </span>
                {!p.isDefault && (
                  <span className={styles.presetChanged} data-preset-changed>
                    已改
                  </span>
                )}
                <span className={styles.presetHint}>{p.hint}</span>
              </header>
              <textarea
                className={styles.presetTextarea}
                data-preset-text={p.id}
                value={value}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
              />
              <div className={styles.presetFoot}>
                <span className={styles.presetCounter}>
                  {value.length} / {PRESET_TEXT_MAX}
                </span>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  data-preset-restore={p.id}
                  disabled={busy !== null || p.isDefault}
                  onClick={() => void restore(p.id)}
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  data-preset-save={p.id}
                  disabled={busy !== null || !editing}
                  onClick={() => void save(p.id)}
                >
                  保存
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
