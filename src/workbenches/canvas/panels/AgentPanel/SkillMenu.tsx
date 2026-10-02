import { useMemo, useState } from 'react'
import type { SkillEntity } from '../../../../domain/prompt/skill'
import { IconChevronDown, IconClose, IconSkill, IconStar } from '../../toolbar/icons'
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

export type SkillTab = 'builtin' | 'fav' | 'user'

const TABS: readonly { id: SkillTab; label: string }[] = [
  { id: 'builtin', label: '通用' },
  { id: 'fav', label: '收藏' },
  { id: 'user', label: '我的' },
]

export function SkillMenu({
  builtin,
  user,
  favorites,
  activeId,
  onSelect,
  onToggleFavorite,
  onCreateNew,
  onImportFiles,
  onImportFolder,
  onClose,
}: {
  builtin: readonly SkillEntity[]
  user: readonly SkillEntity[]
  /** 收藏的技能 id（用户 2026-10-03：菜单分「通用 / 收藏 / 我的」） */
  favorites: readonly string[]
  /** 当前启用的技能 id（`null` = 没选） */
  activeId: string | null
  onSelect: (id: string | null) => void
  /** 切换一条技能的收藏状态 */
  onToggleFavorite: (id: string) => void
  /** 「创建新的 Skill」：跳到技能库去写（那一页才有编辑器） */
  onCreateNew: () => void
  /** 「导入 .md 文件」 */
  onImportFiles: () => void
  /** 「导入文件夹」（整包 skill 目录） */
  onImportFolder: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<SkillTab>('builtin')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  /**
   * 「全部」= **在这个面板里摊开**（用户 2026-10-03 参考产品图五：全部会跳出一个
   * 大面板，在那里**也能挑**）。
   *
   * 为什么不跳去技能库那一页：那一页是**管理**（浏览 → 进第二层编辑），
   * 在里面点一条是「去改它」，不是「这次用它」。用户要的是后者。
   */
  const [wide, setWide] = useState(false)
  /** 大面板里的分类（取自技能自己的 tags；没有标签的技能靠「全部」兜住） */
  const [tag, setTag] = useState<string | null>(null)

  /** 全库的标签清单，按出现次数排（常用的排前面） */
  const tags = useMemo(() => {
    const count = new Map<string, number>()
    for (const s of [...builtin, ...user]) {
      for (const t of s.tags) if (t) count.set(t, (count.get(t) ?? 0) + 1)
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')).map(([t]) => t)
  }, [builtin, user])

  /** 大面板的卡片清单：全库 + 分类 + 搜索 */
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...builtin, ...user]
      .filter((s) => (tag ? s.tags.includes(tag) : true))
      .filter((s) => (q ? [s.name, s.description, ...s.tags].some((t) => t.toLowerCase().includes(q)) : true))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [builtin, user, tag, query])

  const list = useMemo(() => {
    const src =
      tab === 'builtin'
        ? builtin
        : tab === 'user'
          ? user
          : /** 收藏：内置与自建都可能被收藏，所以从两边合起来挑 */
            [...builtin, ...user].filter((s) => favorites.includes(s.id))
    const q = query.trim().toLowerCase()
    const hit = q
      ? src.filter((s) => [s.name, s.description].some((t) => t.toLowerCase().includes(q)))
      : src
    // 按名字排：技能多起来之后，「我刚导入的那个」比「最近改的」更好找
    return [...hit].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [tab, builtin, user, favorites, query])

  return (
    <div
      className={wide ? `${styles.menu} ${styles.menuWide}` : styles.menu}
      data-agent-skill-menu
      role="dialog"
      aria-label="选择技能"
    >
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
          aria-expanded={wide}
          onClick={() => setWide((v) => !v)}
        >
          {wide ? '收起' : '全部'}
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
        {/*
          大面板里不再显示「通用 / 收藏 / 我的」—— 它把**全部**摊开了，
          页签与它是两种视角，同时摆会让人不知道该点哪个。分类改用**标签**。
        */}
        {!wide && (
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
        )}
        <input
          className={styles.search}
          value={query}
          placeholder="搜索 Skill"
          aria-label="搜索技能"
          data-agent-skill-search
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {wide && tags.length > 0 && (
        <div className={styles.tagRow} data-agent-skill-tags>
          <button
            type="button"
            className={tag === null ? `${styles.tagChip} ${styles.tagOn}` : styles.tagChip}
            data-agent-skill-tag="__all"
            onClick={() => setTag(null)}
          >
            全部
          </button>
          {tags.slice(0, 8).map((t) => (
            <button
              key={t}
              type="button"
              className={tag === t ? `${styles.tagChip} ${styles.tagOn}` : styles.tagChip}
              data-agent-skill-tag={t}
              onClick={() => setTag(t === tag ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/*
        大面板用**卡片网格**（参考产品图五）：一眼扫到「有哪些、分别干什么」。
        点卡片 = **这次用它**（与上面列表里的行同一个动作），不是去编辑。
      */}
      {wide ? (
        <div className={styles.cardGrid} data-agent-skill-cards>
          {cards.length === 0 ? (
            <span className={styles.empty} data-agent-skill-empty>
              没有匹配的技能
            </span>
          ) : (
            cards.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === activeId ? `${styles.card} ${styles.cardOn}` : styles.card}
                title={s.description || s.name}
                data-agent-skill-card={s.id}
                onClick={() => onSelect(s.id === activeId ? null : s.id)}
              >
                <span className={styles.cardName}>{s.name}</span>
                {s.description && <span className={styles.cardDesc}>{s.description}</span>}
              </button>
            ))
          )}
        </div>
      ) : (
      <div className={styles.list} data-agent-skill-list>
        {list.length === 0 ? (
          <span className={styles.empty} data-agent-skill-empty>
            {query.trim()
              ? '没有匹配的技能'
              : tab === 'fav'
                ? '还没有收藏的技能：在列表里点右边的星标'
                : tab === 'user'
                  ? '还没有自己的技能：点「创建」新建，或导入 .md'
                  : '没有内置技能'}
          </span>
        ) : (
          list.map((s) => {
            const fav = favorites.includes(s.id)
            return (
              /**
               * 收藏钮**不能**塞进行那个 button 里（button 套 button 是非法 HTML，
               * 点击行为在各浏览器上还不一致）—— 两者并排，行自己占满剩余宽度。
               */
              <div key={s.id} className={styles.rowWrap}>
                <button
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
                <button
                  type="button"
                  className={fav ? `${styles.star} ${styles.starOn}` : styles.star}
                  aria-pressed={fav}
                  aria-label={fav ? `取消收藏 ${s.name}` : `收藏 ${s.name}`}
                  title={fav ? '取消收藏' : '收藏'}
                  data-agent-skill-fav={s.id}
                  onClick={() => onToggleFavorite(s.id)}
                >
                  <IconStar size={14} filled={fav} />
                </button>
              </div>
            )
          })
        )}
      </div>
      )}
    </div>
  )
}
