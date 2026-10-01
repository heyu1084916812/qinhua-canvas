import { useMemo, useRef, useState } from 'react'
import { useSkills } from '../../app/providers/SkillStoreProvider'
import {
  parseSkillMarkdown,
  type BuiltinSkill,
  type SkillInputMode,
  type UserSkill,
} from '../../domain/prompt/skill'
import styles from './SkillsPage.module.css'

/**
 * 技能库**第一层：卡片浏览**（产品文档 §7A.1）。
 *
 * 2026-09-27 从「左列表 + 右编辑」的单层结构拆出来 —— 文档 §7A 早就写明
 * 「卡片浏览 → 点击卡片编辑……点击进入第二层编辑；返回浏览层时保留搜索与筛选项」，
 * 代码此前是单层并列，没跟上。
 *
 * 分层后这个组件**只负责挑**（搜索 / 筛选 / 新建 / 导入 / 点卡片），
 * 挑中谁交给页面（`onPick`）去切第二层；编辑逻辑全在 `SkillEditor` 里。
 * 两层互不知道对方的内部状态 —— 那是「两层」与「一页两栏」的实质区别。
 */

export type SkillFilter = 'all' | 'builtin' | 'user' | 'preset'

export type SkillPick =
  | { source: 'builtin'; skill: BuiltinSkill }
  | { source: 'user'; skill: UserSkill }

const FILTERS: readonly { id: SkillFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'builtin', label: '内置' },
  { id: 'user', label: '我的' },
  { id: 'preset', label: '功能预设词' },
]

const INPUT_MODE_LABEL: Record<SkillInputMode, string> = {
  text: '需要文本',
  image: '需要图片',
  any: '文本或图片',
}

export function SkillsBrowser({
  filter,
  query,
  onFilter,
  onQuery,
  onPick,
  onNew,
  onOpenPresets,
}: {
  filter: SkillFilter
  query: string
  onFilter: (f: SkillFilter) => void
  onQuery: (q: string) => void
  onPick: (pick: SkillPick) => void
  onNew: (draft: Omit<UserSkill, 'id' | 'updatedAt' | 'source'>) => void
  /** 打开「功能预设词」的第二层（它不是技能，没有 Skill 对象可传） */
  onOpenPresets: () => void
}) {
  const { builtinSkills, userSkills, loading, create } = useSkills()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  /** 搜索：名称 / 说明 / 标签都算，用户记不清写在哪一处也能找到 */
  const visibleBuiltins = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return builtinSkills
    return builtinSkills.filter((s) =>
      [s.name, s.description, ...s.tags].some((t) => t.toLowerCase().includes(q)),
    )
  }, [builtinSkills, query])

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return userSkills
    return userSkills.filter((s) =>
      [s.name, s.description, ...s.tags].some((t) => t.toLowerCase().includes(q)),
    )
  }, [userSkills, query])

  /**
   * 导入 md（用户 2026-09-24：「上传 md 文件然后自动加载解析」）。
   *
   * 支持多选：一次导入一整组技能是常见需求。
   * **逐个独立成败** —— 其中一个格式不对不该让其余几个也失败，
   * 所以收集成功数与失败原因最后一起报，而不是遇到第一个错误就中断。
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
    setNotice(
      failed.length === 0
        ? { kind: 'ok', text: `已导入 ${ok} 条技能` }
        : {
            kind: 'error',
            text: `成功 ${ok} 条，失败 ${failed.length} 条：${failed.join('；')}`,
          },
    )
  }

  const startNew = () => {
    /*
     * 空草稿直接进编辑层：用户得先看到编辑界面才能填。
     * 校验放在**保存**时（`validateSkill`）—— 在这里拦会把「点新建没反应」
     * 变成一个没有任何提示的死路。
     */
    onNew({ name: '', description: '', content: '', inputMode: 'text', tags: [] })
  }

  const showPresets = filter === 'all' || filter === 'preset'
  const showBuiltins = filter === 'all' || filter === 'builtin'
  const showSkills = filter === 'all' || filter === 'user'

  return (
    <div className={styles.browser} data-skills-browser>
      <div className={styles.browserBar}>
        <div className={styles.filters} role="tablist" aria-label="技能分类">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              data-skills-filter={f.id}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          type="search"
          placeholder="搜索技能"
          aria-label="搜索技能"
          value={query}
          data-skills-search
          onChange={(e) => onQuery(e.target.value)}
        />
        <div className={styles.browserActions}>
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

      <div className={styles.cards} data-skills-cards>
        {/* 功能预设词：一张独立卡片，点它进第二层编辑三条内置指令（§7A.4） */}
        {showPresets && (
          <button
            type="button"
            className={styles.card}
            data-skills-preset-card
            onClick={onOpenPresets}
          >
            <span className={styles.cardName}>功能预设词</span>
            <span className={styles.cardDesc}>
              提示词节点上「优化 / 翻译 / 反推」的系统指令
            </span>
            <span className={styles.cardMeta}>内置动作 · 3 条</span>
          </button>
        )}

        {showBuiltins &&
          (loading ? null : (
            visibleBuiltins.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.card}
                data-skill-item={s.id}
                data-skill-source="builtin"
                data-skills-builtin-card
                onClick={() => onPick({ source: 'builtin', skill: s })}
              >
                <span className={styles.cardSource}>内置技能</span>
                <span className={styles.cardName}>{s.name}</span>
                {s.description && <span className={styles.cardDesc}>{s.description}</span>}
                <span className={styles.cardMeta}>内置 · {INPUT_MODE_LABEL[s.inputMode]}</span>
              </button>
            ))
          ))}

        {showSkills &&
          (loading ? (
            <div className={styles.empty}>加载中…</div>
          ) : visibleUsers.length === 0 ? (
            <div className={styles.empty} data-skills-empty>
              还没有技能。
              <br />
              「新建」写一个，或「导入 md」。
            </div>
          ) : (
            visibleUsers.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.card}
                data-skill-item={s.id}
                data-skill-source="user"
                onClick={() => onPick({ source: 'user', skill: s })}
              >
                <span className={styles.cardSource}>我的技能</span>
                <span className={styles.cardName}>{s.name}</span>
                {s.description && <span className={styles.cardDesc}>{s.description}</span>}
                <span className={styles.cardMeta}>我的 · {INPUT_MODE_LABEL[s.inputMode]}</span>
              </button>
            ))
          ))}
      </div>
    </div>
  )
}
