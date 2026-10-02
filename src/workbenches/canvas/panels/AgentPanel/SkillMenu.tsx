import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

/**
 * `useLayoutEffect` 在 SSR 下不执行且会告警；服务端退回 `useEffect`（同样是空操作），
 * 客户端仍是「绘制前测量」。与 `ParamPicker` 同一手法。
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

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
  /**
   * 「导入」是**二级**：一个入口，两把具体的选取器（`.md` 文件 / Skill 目录）。
   *
   * 为什么不合并成一个原生输入：`webkitdirectory` 与 `accept` 互斥，同一个
   * `<input type="file">` 不可能同时是「选文件」与「选目录」（浏览器层就做不到）。
   * 所以合并发生在**入口**这一层，用户看到的是一个「导入 Skill」。
   */
  const [importOpen, setImportOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const createWrapRef = useRef<HTMLSpanElement | null>(null)
  /**
   * 浮层整体左右挪多少像素：**不许越出对话窗**。
   *
   * 用户 2026-10-02：「agentskill 面板朝右边超出了画布的页面，显示不全」——
   * 技能按钮在工具条中段，300px 的浮层一路向右展开，而对话窗本身贴着视口右边，
   * 于是右半截被切掉。这里量一次实际矩形，越界就往左推回来（`transform`，
   * 不重排布局）。
   */
  const [shift, setShift] = useState(0)

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

  /** 点别处收起「创建」二级菜单（悬停展开出去的，得有地方收回来） */
  useEffect(() => {
    if (!createOpen) return
    const onDown = (e: PointerEvent) => {
      if (!createWrapRef.current?.contains(e.target as Node)) {
        setCreateOpen(false)
        setImportOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [createOpen])

  /**
   * 越界就往左推回对话窗内（见 `shift` 的说明）。
   *
   * 量的是**含当前位移**的矩形，所以只把「还差多少」加上去；依赖里不含 `shift`，
   * 不会自己绕圈。大面板是居中的模态，不参与这套。
   */
  useIsoLayoutEffect(() => {
    if (wide) {
      setShift(0)
      return
    }
    const el = rootRef.current
    if (!el) return
    const bounds = (el.closest('[data-agent-panel]') ?? document.documentElement).getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const pad = 8
    let dx = 0
    if (rect.right > bounds.right - pad) dx = bounds.right - pad - rect.right
    if (rect.left + dx < bounds.left + pad) dx = bounds.left + pad - rect.left
    if (dx !== 0) setShift((prev) => prev + dx)
  }, [wide, tab, query, cards.length, list.length])

  return (
    <>
      {/*
        「全部」摊开后是**画布正中的模态**（用户 2026-10-02，参考产品图四）：
        固定尺寸比例、右上角关闭、点空白处也能关。
        它挂在工具条里，但 `position: fixed` 会把它提到视口正中渲染。
      */}
      {wide && <div className={styles.scrim} data-agent-skill-scrim onPointerDown={onClose} />}
      <div
        ref={rootRef}
        className={wide ? `${styles.menu} ${styles.menuModal}` : styles.menu}
        style={shift !== 0 ? { transform: `translateX(${shift}px)` } : undefined}
        data-agent-skill-menu
        data-agent-skill-modal={wide ? '' : undefined}
        role="dialog"
        aria-label="选择技能"
      >
      <div className={styles.head}>
        <span className={styles.title}>Skill</span>
        <span className={styles.headGap} />
        {/*
          「创建」**悬停就展开**（用户 2026-10-02：「这个创建不用点击，悬停就会出现选项」）。
          悬停展开之后必须有地方收：`pointerleave` 收起，点面板别处由上面那个
          document 监听收起。点一下也能开（键盘 / 触摸走这条路），只是不再「点一下关」——
          指针刚进按钮就已经展开了，再点一下反而关掉会让人以为点坏了。
        */}
        <span
          className={styles.createWrap}
          ref={createWrapRef}
          onPointerEnter={() => setCreateOpen(true)}
        >
          <button
            type="button"
            className={styles.headBtn}
            aria-expanded={createOpen}
            data-agent-skill-create
            onFocus={() => setCreateOpen(true)}
            onClick={() => setCreateOpen(true)}
          >
            创建
            <IconChevronDown size={12} />
          </button>
          {createOpen && (
            <div className={styles.createMenu} role="menu" data-agent-skill-create-menu>
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
              {/*
                导入是**一个入口**（用户 2026-10-02：「导入的按钮把 md 文件和文件夹
                变成一个按钮」）。点开才分「.md 文件 / Skill 目录」两把选取器 ——
                浏览器不允许一个文件选择器同时选文件和目录，这一层分叉只能留在
                入口内部，不能真的只留一个原生 input。
              */}
              <button
                type="button"
                role="menuitem"
                className={styles.createItem}
                aria-expanded={importOpen}
                data-agent-skill-import
                onClick={() => setImportOpen(true)}
              >
                <span className={styles.createLabel}>导入 Skill</span>
                <span className={styles.createHint}>已有的 .md 文件，或整包 Skill 目录</span>
              </button>
              {importOpen && (
                <div className={styles.importSplit}>
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
                    <span className={styles.createLabel}>导入 Skill 目录</span>
                    <span className={styles.createHint}>整包 skill 目录一起导入</span>
                  </button>
                </div>
              )}
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
                {/*
                  **图片 / 效果位**（用户 2026-10-02 参考产品图四：「每个 skill 有图片、
                  效果的展示（可以留空，后期我自己添加）」）。

                  图从技能自己的 frontmatter `image:` 来（见 `skill.ts`），
                  没填就画一枚技能图标占位 —— 位置先占住，用户以后往 md 里补一行就有图。
                */}
                <span className={styles.cardShot} data-agent-skill-shot={s.id}>
                  {s.image ? (
                    <img className={styles.cardShotImg} src={s.image} alt="" />
                  ) : (
                    <IconSkill size={18} />
                  )}
                </span>
                <span className={styles.cardBody}>
                  <span className={styles.cardName}>
                    {s.tags[0] && <span className={styles.cardTag}>{s.tags[0]}</span>}
                    {/**
                     * 名字单独一个锚点：卡片里现在还有分类与效果图，
                     * 「整张卡的 innerText 第一行」已经不等于名字了（冒烟踩过）。
                     */}
                    <span data-agent-skill-card-name={s.id}>{s.name}</span>
                  </span>
                  {s.description && <span className={styles.cardDesc}>{s.description}</span>}
                </span>
                <span className={styles.cardUse}>使用</span>
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
    </>
  )
}
