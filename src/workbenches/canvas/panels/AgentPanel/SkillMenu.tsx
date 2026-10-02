import { useMemo, useState } from 'react'
import type { SkillEntity } from '../../../../domain/prompt/skill'
import { IconChevronDown, IconClose, IconSkill } from '../../toolbar/icons'
import styles from './SkillMenu.module.css'

/**
 * 对话窗里的技能菜单（用户 2026-10-03，参考产品图三 / 图四）。
 *
 * 形态：**一个面板**，头部是「Skill / 创建 / 全部」，下面一行页签 + 搜索，
 * 再下面是技能行（图标 + 名字 + 说明）。选一条即**当场生效**（写进会话），
 * 并在输入框里显示成一颗 chip —— 与 @ 引用同一套「用了什么，一眼看得见」。
 *
 * 为什么不直接复用技能库那一页：那一页是**管理**（卡片浏览 → 进第二层编辑），
 * 这里是**挑一个马上用**。两者的目的不同，硬合成一个会两边都别扭。
 * 但底下三样是**共用**的，一处都没抄：技能数据（`useSkills`）、
 * md 解析（`parseSkillMarkdown`）、新建 / 导入的落库（`skillStore.create`）。
 */

export type SkillTab = 'builtin' | 'user'

const TABS: readonly { id: SkillTab; label: string }[] = [
  { id: 'builtin', label: '通用' },
  { id: 'user', label: '我的' },
]

export function SkillMenu({
  builtin,
  user,
  activeId,
  onSelect,
  onCreateNew,
  onImportFiles,
  onImportFolder,
  onOpenLibrary,
  onClose,
}: {
  builtin: readonly SkillEntity[]
  user: readonly SkillEntity[]
  /** 当前启用的技能 id（`null` = 没选） */
  activeId: string | null
  onSelect: (id: string | null) => void
  /** 「创建新的 Skill」：跳到技能库去写（那一页才有编辑器） */
  onCreateNew: () => void
  /** 「导入 .md 文件」 */
  onImportFiles: () => void
  /** 「导入文件夹」（整包 skill 目录） */
  onImportFolder: () => void
  /** 「全部」：跳到技能库 */
  onOpenLibrary: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<SkillTab>('builtin')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const list = useMemo(() => {
    const src = tab === 'builtin' ? builtin : user
    const q = query.trim().toLowerCase()
    const hit = q
      ? src.filter((s) => [s.name, s.description].some((t) => t.toLowerCase().includes(q)))
      : src
    // 按名字排：技能多起来之后，「我刚导入的那个」比「最近改的」更好找
    return [...hit].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [tab, builtin, user, query])

  return (
    <div className={styles.menu} data-agent-skill-menu role="dialog" aria-label="选择技能">
      <div className={styles.head}>
        <span className={styles.title}>Skill</span>
        <span className={styles.headGap} />
        <span className={styles.createWrap}>
          <button
            type="button"
            className={styles.headBtn}
            aria-expanded={createOpen}
            data-agent-skill-create
            onClick={() => setCreateOpen((v) => !v)}
          >
            创建
            <IconChevronDown size={12} />
          </button>
          {createOpen && (
            <div className={styles.createMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.createItem}
                data-agent-skill-create-new
                onClick={onCreateNew}
              >
                <span className={styles.createLabel}>创建新的 Skill</span>
                <span className={styles.createHint}>去技能库里写一份新的</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.createItem}
                data-agent-skill-import-file
                onClick={onImportFiles}
              >
                <span className={styles.createLabel}>导入 .md 文件</span>
                <span className={styles.createHint}>上传已有的 skill 文件</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.createItem}
                data-agent-skill-import-folder
                onClick={onImportFolder}
              >
                <span className={styles.createLabel}>导入文件夹</span>
                <span className={styles.createHint}>整包 skill 目录一起导入</span>
              </button>
            </div>
          )}
        </span>
        <button
          type="button"
          className={styles.headBtn}
          data-agent-skill-all
          onClick={onOpenLibrary}
        >
          全部
        </button>
        <button
          type="button"
          className={styles.close}
          aria-label="关闭技能菜单"
          data-agent-skill-close
          onClick={onClose}
        >
          <IconClose size={12} />
        </button>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.tabs} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? `${styles.tab} ${styles.tabOn}` : styles.tab}
              data-agent-skill-tab={t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          value={query}
          placeholder="搜索 Skill"
          aria-label="搜索技能"
          data-agent-skill-search
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={styles.list} data-agent-skill-list>
        {list.length === 0 ? (
          <span className={styles.empty} data-agent-skill-empty>
            {query.trim()
              ? '没有匹配的技能'
              : tab === 'user'
                ? '还没有自己的技能：点「创建」新建，或导入 .md'
                : '没有内置技能'}
          </span>
        ) : (
          list.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === activeId ? `${styles.row} ${styles.rowOn}` : styles.row}
              title={s.description || s.name}
              data-agent-skill-option={s.id}
              onClick={() => onSelect(s.id === activeId ? null : s.id)}
            >
              <span className={styles.rowIcon}>
                <IconSkill size={14} />
              </span>
              <span className={styles.rowBody}>
                <span className={styles.rowName}>{s.name}</span>
                {s.description && <span className={styles.rowDesc}>{s.description}</span>}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
