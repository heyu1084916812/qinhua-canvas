import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { usePlatform } from './providers/PlatformProvider'
import { createProjectRepository, type ProjectRepository } from '../state/project/repository'
import {
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_HOVER_IN_MS,
  SIDEBAR_HOVER_OUT_MS,
  getSidebarPinned,
  getSidebarOpen,
  setSidebarHovering,
  subscribeSidebar,
  toggleSidebarPin,
} from './sidebarState'
import { ThemeToggle } from './ThemeToggle'
import { UpdateButton } from './UpdateNotice'
import { CatLogo } from './CatLogo'
import { NAV, type NavItem } from './nav'
import {
  IconNewProject,
  IconSettings,
  IconSidebarToggle,
} from './AppSidebarIcons'
import {
  getGlobalSettings,
  openGlobalSettings,
  subscribeGlobalSettings,
} from '../state/ui/globalSettings'
import styles from './AppSidebar.module.css'

/**
 * 应用壳左侧功能栏（产品文档 §2.2 / 架构文档 §5.10）。
 *
 * 三条硬口径，改之前先读：
 *  1. **默认收起、刷新回收起**：宽度来自 `sidebarState` 的模块级值，
 *     刻意不落盘。初值为收起，见该文件注释。
 *  2. **导航顺序固定**：`首页 / 项目 / 画布 / 技能库 / 我的素材 / 渠道配置`。
 *     顺序写死在 `NAV` 里 —— 它是产品口径，不该由数据驱动。
 *  3. **不许 import `workbenches/canvas/*`**：图标因此自建在 `AppSidebarIcons`。
 */

/**
 * 导航项是否高亮。
 *
 * 手写而不用 `NavLink` 的 `isActive`：需要两条本项目特有的规则 ——
 *  1. 首页要**精确**匹配（否则 `/` 是所有路径的前缀，永远亮）；
 *  2. `/canvas` 与 `/canvas/:id` 一起亮 ——「画布」这一项指的是「我在画布里」，
 *     而不只是「URL 恰好是 /canvas」。
 */
function isItemActive(item: NavItem, pathname: string, activeProjectId: string | null): boolean {
  if (item.to === '/') return pathname === '/'
  if (item.to === '/canvas') return pathname === '/canvas' || !!activeProjectId
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

/** 最近项目列表展示几条。够点最近用的；再多就把侧栏变成项目页了。 */
const RECENT_LIMIT = 6

interface RecentItem {
  id: string
  title: string
}

export function AppSidebar() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * 展开 / 收起：`useSyncExternalStore` + 模块级值。
   *
   * 与服务端渲染的 `getServerSnapshot` 一起给：测试用 `renderToString`
   * 渲染整棵树时没有订阅能力，第三参就是那条路径的取值 —— 缺了它会直接抛。
   */
  const open = useSyncExternalStore(subscribeSidebar, getSidebarOpen, getSidebarOpen)
  /*
   * 常驻态单独订阅一次：它是**另一个真相源**（悬停已经展开时，点"常驻"不会改变
   * `getSidebarOpen()`，只订阅 `open` 的话按钮的 `aria-pressed` 会停在旧值）。
   */
  const pinned = useSyncExternalStore(subscribeSidebar, getSidebarPinned, getSidebarPinned)
  /** 「全局设置」按钮的高亮：浮层开着就算选中（它没有路由，判据只能来自这份状态）。 */
  const settingsOpen = useSyncExternalStore(
    subscribeGlobalSettings,
    () => getGlobalSettings().open,
    () => getGlobalSettings().open,
  )

  /**
   * 悬停展开 / 收起的**延迟计时器**（用户 2026-10-06：要"顺滑"，不要 0 延迟）。
   *
   * 进出都用同一个 ref：后一次操作必须先取消前一次，否则"进→出→进"三次快速移动
   * 会留下一个没人管的计时器，把状态改回错的档位（这类竞态在真机上表现为"偶发不收"）。
   */
  const hoverTimer = useRef<number | null>(null)
  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  useEffect(() => clearHoverTimer, [])

  const onRailEnter = () => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => setSidebarHovering(true), SIDEBAR_HOVER_IN_MS)
  }
  const onRailLeave = () => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => setSidebarHovering(false), SIDEBAR_HOVER_OUT_MS)
  }

  /**
   * 「最近项目」的数据。
   *
   * 仓库与 HomePage 同源（同一个 `createProjectRepository`），但**不共享实例**：
   * 侧栏全路由常驻，而首页会被卸载；共享实例就得处理两边生命周期，
   * 换来的只是一个内存里的列表缓存。这里各自读库，读的是同一份事实。
   */
  const repoRef = useRef<ProjectRepository | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])

  // 收起态不展示列表 —— 那就没必要读库（少一次全表查询）
  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      const repo = (repoRef.current ??= createProjectRepository(platform.storage))
      const list = await repo.list()
      if (!alive) return
      setRecent(
        [...list]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, RECENT_LIMIT)
          .map((p) => ({ id: p.id, title: p.name })),
      )
    })()
    return () => {
      alive = false
    }
    /**
     * 依赖里带 `location.pathname`：从画布返回首页、或新建项目后，
     * 列表应当重读。不带它就会出现「刚建的项目不在最近列表里」。
     */
  }, [open, platform, location.pathname])

  /** 当前选中的项目 id（用于高亮最近项目里那一条） */
  const activeProjectId = useMemo(() => {
    const m = /^\/canvas\/(.+)$/.exec(location.pathname)
    return m ? m[1] : null
  }, [location.pathname])

  const width = open ? undefined : SIDEBAR_COLLAPSED_W

  return (
    <aside
      className={open ? `${styles.rail} ${styles.railOpen}` : styles.rail}
      style={width ? { width: `${width}px` } : undefined}
      data-app-sidebar
      data-sidebar-open={open ? 'true' : 'false'}
      data-sidebar-pinned={pinned ? 'true' : 'false'}
      /* 悬停即展开（带延迟），移开即收回（延迟更长）—— 见 sidebarState 的两个常量 */
      onMouseEnter={onRailEnter}
      onMouseLeave={onRailLeave}
      aria-label="一级导航"
    >
      {/* 顶部：Logo + 常驻开关 */}
      <div className={styles.head}>
        {/*
          猫画动态 Logo（用户 2026-09-27）。收起态下它与开合按钮**同一格**：
          平时显示 Logo，鼠标悬停时 Logo 隐去、按钮显现（见 CSS）。
        */}
        <span className={styles.logo} data-sidebar-logo>
          <CatLogo size={28} />
        </span>
        {/*
          收起态下这个按钮只在悬停时浮现（否则 64px 宽里塞不下 logo + 按钮）。
          它是**唯一的"常驻"入口**，所以不能纯靠 hover 才可点 —— 用 `:focus-visible`
          一并放行，键盘用户 Tab 过来就能看见并操作。

          ⚠️ 语义在 2026-10-06 变了：以前是"开 / 合侧栏"，现在是**常驻开关**（用户原话
          「折叠按钮只是控制他是否常驻折叠或者展开」）。日常开合由**悬停**负责，
          按钮只回答"离开鼠标时它该不该留在这儿"。
        */}
        <button
          type="button"
          className={styles.toggle}
          data-sidebar-toggle
          data-sidebar-pin
          aria-pressed={pinned}
          aria-label={pinned ? '取消常驻展开（移开鼠标后自动收起）' : '常驻展开侧栏'}
          title={pinned ? '取消常驻展开' : '常驻展开'}
          onClick={() => toggleSidebarPin()}
        >
          <IconSidebarToggle size={20} />
        </button>
      </div>

      {/* 新建项目：独立按钮，与导航项区分开（参考图里它在导航之上、单独一行） */}
      <button
        type="button"
        className={styles.newBtn}
        data-sidebar-new
        aria-label="新建项目"
        title="新建项目"
        onClick={() => navigate('/')}
      >
        <span className={styles.newIcon} aria-hidden="true">
          <IconNewProject />
        </span>
        {open && <span className={styles.newText}>新建项目</span>}
      </button>

      <nav className={styles.nav}>
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              /*
               * ⚠️ 手写高亮而不用 `NavLink`：需要一条额外的规则 ——
               * `/canvas` 与 `/canvas/:id` 一起亮（前者是「无项目时打开空白画布」
               * 的入口，后者是实际编辑页）。只用 NavLink 的默认匹配，
               * 从项目卡进画布时「画布」这一项不会亮，用户以为自己不在画布里。
               */
              className={
                isItemActive(item, location.pathname, activeProjectId)
                  ? `${styles.item} ${styles.itemOn}`
                  : styles.item
              }
              aria-current={isItemActive(item, location.pathname, activeProjectId) ? 'page' : undefined}
              data-sidebar-item={item.to}
              title={item.label}
            >
              <span className={styles.itemIcon} aria-hidden="true">
                <Icon size={20} />
              </span>
              {open && <span className={styles.itemText}>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* 最近项目：只在展开态出现（收起态 64px 放不下文字） */}
      {open && (
        <div className={styles.recent} data-sidebar-recent>
          <div className={styles.recentHead}>最近项目</div>
          {recent.length === 0 ? (
            <div className={styles.recentEmpty}>还没有项目</div>
          ) : (
            <ul className={styles.recentList}>
              {recent.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={
                      p.id === activeProjectId
                        ? `${styles.recentItem} ${styles.recentItemOn}`
                        : styles.recentItem
                    }
                    data-sidebar-recent-item={p.id}
                    title={p.title}
                    onClick={() => navigate(`/canvas/${p.id}`)}
                  >
                    {p.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 底部：主题切换常驻（用户 2026-09-27：主题放侧栏底部；收起态也保留图标位） */}
      <div className={styles.foot}>
        {/*
          全局设置（用户 2026-10-06，对账 #259）：**排在「检查更新」上方**，
          打开的是浮层而不是跳页 —— 所以在侧栏底部这一组里，它跟"检查更新 / 主题"
          一样属于"全局入口"，而不是一级导航。
        */}
        <button
          type="button"
          className={
            settingsOpen ? `${styles.footBtn} ${styles.footBtnOn}` : styles.footBtn
          }
          data-sidebar-settings
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title="全局设置"
          onClick={() => openGlobalSettings('channels')}
        >
          <span className={styles.itemIcon} aria-hidden="true">
            <IconSettings size={20} />
          </span>
          {open && <span className={styles.footBtnText}>全局设置</span>}
        </button>
        {/* 自动更新入口（方案 §5）：浏览器里没有这一项，按钮自己消失 */}
        <UpdateButton open={open} />
        <ThemeToggle compact={!open} className={styles.themeBtn} />
      </div>

    </aside>
  )
}
