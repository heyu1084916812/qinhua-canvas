import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { usePlatform } from './providers/PlatformProvider'
import { createProjectRepository, type ProjectRepository } from '../state/project/repository'
import {
  SIDEBAR_COLLAPSED_W,
  getSidebarOpen,
  subscribeSidebar,
  toggleSidebar,
} from './sidebarState'
import { ThemeToggle } from './ThemeToggle'
import { CatLogo } from './CatLogo'
import {
  IconAssets,
  IconCanvas,
  IconChannels,
  IconHome,
  IconNewProject,
  IconProjects,
  IconSidebarToggle,
  IconSkills,
} from './AppSidebarIcons'
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

interface NavItem {
  to: string
  label: string
  icon: (p: { size?: number }) => JSX.Element
}

/** 一级导航。顺序即产品口径（§2.2），不要按字母或任何其它规则重排。 */
const NAV: NavItem[] = [
  { to: '/', label: '首页', icon: IconHome },
  { to: '/projects', label: '项目', icon: IconProjects },
  { to: '/canvas', label: '画布', icon: IconCanvas },
  { to: '/skills', label: '技能库', icon: IconSkills },
  { to: '/assets', label: '我的素材', icon: IconAssets },
  { to: '/settings', label: '渠道配置', icon: IconChannels },
]

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
      aria-label="一级导航"
    >
      {/* 顶部：Logo + 展开 / 收起 */}
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
          它是**唯一的开合入口**，所以不能纯靠 hover 才可点 —— 用 `:focus-visible`
          一并放行，键盘用户 Tab 过来就能看见并打开。
        */}
        <button
          type="button"
          className={styles.toggle}
          data-sidebar-toggle
          aria-expanded={open}
          aria-label={open ? '收起侧栏' : '展开侧栏'}
          title={open ? '收起侧栏' : '展开侧栏'}
          onClick={() => toggleSidebar()}
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
        <ThemeToggle compact={!open} className={styles.themeBtn} />
      </div>

    </aside>
  )
}
