import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { WorkbenchId } from '../domain/shared/workbench'
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
import { QinghuaWordmark } from './QinghuaWordmark'
import { isTauri } from '@tauri-apps/api/core'
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
import { ProjectTree } from './ProjectTree'
import {
  activeCanvasId,
  getActiveCanvasRevision,
  subscribeActiveCanvas,
} from '../state/project/activeCanvas'

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
/** SSR 下 `useLayoutEffect` 会打警告；浏览器里仍要在绘制前量好，故两套分流 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

interface NavItemRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 「先过去一部分、另一部分再跟上」的伸缩关键帧（用户 2026-10-14）。
 *
 * 向下切：
 * - 0%：整块还在旧项；
 * - 45%：**上沿留在旧项、下沿已经到新项底** —— 块被拉长，前端先过去；
 * - 100%：上沿跟着落到新项、高度收回一项 —— 尾端再过去。
 *
 * 向上切是对称的（45% 时上沿先到新项顶、下沿留在旧项底）。
 * 45% 之后那段带过冲曲线，收尾时有一点回弹。
 */
function navStretchKeyframes(from: NavItemRect, to: NavItemRect): Keyframe[] {
  const forward = to.y >= from.y
  const lead = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const settle = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
  if (forward) {
    return [
      {
        transform: `translate3d(${from.x}px, ${from.y}px, 0)`,
        height: `${from.h}px`,
        offset: 0,
        easing: lead,
      },
      {
        transform: `translate3d(${to.x}px, ${from.y}px, 0)`,
        height: `${to.y + to.h - from.y}px`,
        offset: 0.45,
        easing: settle,
      },
      { transform: `translate3d(${to.x}px, ${to.y}px, 0)`, height: `${to.h}px`, offset: 1 },
    ]
  }
  return [
    {
      transform: `translate3d(${from.x}px, ${from.y}px, 0)`,
      height: `${from.h}px`,
      offset: 0,
      easing: lead,
    },
    {
      transform: `translate3d(${to.x}px, ${to.y}px, 0)`,
      height: `${from.y + from.h - to.y}px`,
      offset: 0.45,
      easing: settle,
    },
    { transform: `translate3d(${to.x}px, ${to.y}px, 0)`, height: `${to.h}px`, offset: 1 },
  ]
}

function isItemActive(item: NavItem, pathname: string, activeWorkbench: WorkbenchId | null): boolean {
  if (item.to === '/') return pathname === '/'
  if (item.to === '/canvas') return pathname === '/canvas' || activeWorkbench === 'canvas'
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

export function AppSidebar() {
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
   * 是否跑在桌面壳里。用途只有一个：**常驻开关的家**。
   * 壳里有标题栏 ⇒ 开关住标题栏；浏览器里没有 ⇒ 退回侧栏头部（见渲染处的注释）。
   */
  const inShell = useSyncExternalStore(
    () => () => {},
    () => isTauri(),
    () => false,
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
   * 当前工作台与项目 id（用于高亮项目树、并让画布一级导航只在画布里亮）。
   *
   * 不能只看 `/canvas/`：电商与漫剧也是项目工作台，点侧栏项目树时必须回到
   * 它自己的工作台，否则用户会从电商列表莫名跳进节点画布（对账 #399）。
   */
  const activeProject = useMemo(() => {
    const m = /^\/(canvas|ecommerce|storyboard)\/(.+)$/.exec(location.pathname)
    return m ? { workbench: m[1] as WorkbenchId, id: m[2] } : null
  }, [location.pathname])
  useSyncExternalStore(
    subscribeActiveCanvas,
    getActiveCanvasRevision,
    getActiveCanvasRevision,
  )
  const selectedProjectId =
    activeProject?.workbench === 'canvas'
      ? activeProject.id
      : activeCanvasId() ?? activeProject?.id ?? null

  /**
   * 一级导航的**滑动高亮块**（用户 2026-10-14：「当前项切换时的高亮块从旧位置
   * 滑到新位置，宽高跟随目标项变化，带一点回弹」「过程中相当于有一个形变」）。
   *
   * 形态：导航里只放**一块**绝对定位的元素，几何完全由当前项量出来。切页时用
   * `navStretchKeyframes` 做三段动画：前端先拉过去 → 尾端再跟上 → 收回到目标项，
   * 中间块被**拉长/形变**，最后一段带过冲 ⇒ 一点回弹。
   * 不采用「每个项各画一份、靠动画拼起来」——那样中间必然有两块同时亮。
   */
  const navRef = useRef<HTMLElement | null>(null)
  const highlightRef = useRef<HTMLSpanElement | null>(null)
  /** 上一次量到的几何：切项时拿它当伸缩动画的起点 */
  const displayedRect = useRef<NavItemRect | null>(null)
  const lastActiveTo = useRef<string | null>(null)
  const lastOpen = useRef(open)
  const stretchAnimation = useRef<Animation | null>(null)
  const [navHighlight, setNavHighlight] = useState<NavItemRect | null>(null)
  const activeNavTo = useMemo(
    () =>
      NAV.find((item) => isItemActive(item, location.pathname, activeProject?.workbench ?? null))
        ?.to ?? null,
    [location.pathname, activeProject],
  )

  useIsomorphicLayoutEffect(() => {
    const nav = navRef.current
    if (!nav || !activeNavTo) {
      stretchAnimation.current?.cancel()
      displayedRect.current = null
      lastActiveTo.current = null
      setNavHighlight(null)
      return
    }
    const measure = () => {
      const el = Array.from(nav.querySelectorAll<HTMLElement>('[data-sidebar-item]')).find(
        (node) => node.dataset.sidebarItem === activeNavTo,
      )
      if (!el) {
        setNavHighlight(null)
        return
      }
      const next: NavItemRect = {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      }
      const previous = displayedRect.current
      const switched = lastActiveTo.current !== null && lastActiveTo.current !== activeNavTo
      const openChanged = lastOpen.current !== open
      lastActiveTo.current = activeNavTo
    lastOpen.current = open
      displayedRect.current = next
      setNavHighlight(next)

      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const node = highlightRef.current
      if (switched && previous && node && !reduce && !openChanged) {
        stretchAnimation.current?.cancel()
        /** 拉伸 → 尾端跟随 → 收回；最后一段带过冲 ⇒ 一点回弹 */
        stretchAnimation.current = node.animate(navStretchKeyframes(previous, next), {
          duration: 460,
          easing: 'linear',
          fill: 'none',
        })
      } else {
        stretchAnimation.current?.cancel()
        stretchAnimation.current = null
      }
    }
    measure()
    /**
     * 侧栏展开 / 收起是 180ms 的宽度过渡；只量一次会把高亮块留在旧宽度上。
     * 观察 nav 自身尺寸，跟着重算即可（高亮块自己的过渡会把它补平）。
     */
    if (typeof ResizeObserver === 'undefined') return
    let lastWidth = nav.offsetWidth
    let lastHeight = nav.offsetHeight
    const observer = new ResizeObserver(() => {
      if (nav.offsetWidth === lastWidth && nav.offsetHeight === lastHeight) return
      lastWidth = nav.offsetWidth
      lastHeight = nav.offsetHeight
      measure()
    })
    observer.observe(nav)
    return () => observer.disconnect()
  }, [activeNavTo, open])

  useEffect(() => () => stretchAnimation.current?.cancel(), [])

  const width = open ? undefined : SIDEBAR_COLLAPSED_W

  return (
    <aside
      className={open ? `${styles.rail} ${styles.railOpen}` : styles.rail}
      style={width ? { width: `${width}px` } : undefined}
      data-app-sidebar
      data-sidebar-open={open ? 'true' : 'false'}
      data-sidebar-pinned={pinned ? 'true' : 'false'}
      /*
       * ⚠️ 这里原来挂着 `data-sidebar-floating`（悬停时当浮层、加圆角与投影）。
       * 2026-10-08 用户改了口径：「悬停是长出来的，不是往右推出来的，我要的是展开按钮
       * 展开的那种效果」⇒ 悬停与钉住**用同一套效果**（都推挤工作区、同一套外观），
       * 区别只剩"松手（移开鼠标）后收不收"。那个属性与它的样式因此一并删掉。
       */
      /* 悬停即展开（带延迟），移开即收回（延迟更长）—— 见 sidebarState 的两个常量 */
      onMouseEnter={onRailEnter}
      onMouseLeave={onRailLeave}
      aria-label="一级导航"
    >
      {/*
        顶部品牌位（用户 2026-10-06）：**收起时只有 logo，展开时 logo 后面接文字标**。
        常驻开关搬去标题栏了（壳里）—— 所以这里不再有"悬停互换"那套。
        ⚠️ 但**浏览器里没有标题栏** ⇒ 开关退回这里显示（能力在哪，控件在哪），
        锚点两边都叫 `data-sidebar-toggle`，冒烟因此不必分环境写两份。
      */}
      <div className={styles.head}>
        <span className={styles.logo} data-sidebar-logo>
          <CatLogo size={28} />
        </span>
        {/*
          ⚠️ **文字标不再跟着 `open` 挂载 / 卸载**（对账 #281，用户「折叠和收起来会闪」）。
          宽度有 180ms 过渡，而挂载是**瞬间**的 —— 展开那一帧文字已经就位、侧栏还只有
          64px 宽，于是 8 个标签同时被塞进窄条里露出半截字，看起来就是"闪一下"。
          现在它常驻，由 CSS 按 `data-sidebar-text` 跟着宽度淡入淡出（见 module.css）。
        */}
        <span className={styles.wordmark} data-sidebar-wordmark data-sidebar-text>
          <QinghuaWordmark className={styles.wordmarkSvg} />
        </span>
        {/*
          语义在 2026-10-06 变过一次：以前是"开 / 合侧栏"，现在是**常驻开关**
          （用户原话「折叠按钮只是控制他是否常驻折叠或者展开」）。日常开合由**悬停**负责，
          它只回答"离开鼠标时侧栏该不该留在这儿"。
        */}
        {!inShell && (
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
        )}
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
        <span className={styles.newText} data-sidebar-text data-sidebar-label>
          新建项目
        </span>
      </button>

      <nav className={styles.nav} ref={navRef}>
        {navHighlight && (
          <span
            ref={highlightRef}
            className={styles.navHighlight}
            data-sidebar-highlight
            aria-hidden="true"
            style={{
              width: navHighlight.w,
              height: navHighlight.h,
              transform: `translate3d(${navHighlight.x}px, ${navHighlight.y}px, 0)`,
            }}
          />
        )}
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
                isItemActive(item, location.pathname, activeProject?.workbench ?? null)
                  ? `${styles.item} ${styles.itemOn}`
                  : styles.item
              }
              aria-current={
                isItemActive(item, location.pathname, activeProject?.workbench ?? null)
                  ? 'page'
                  : undefined
              }
              data-sidebar-item={item.to}
              title={item.label}
            >
              <span className={styles.itemIcon} aria-hidden="true">
                <Icon size={20} />
              </span>
              <span className={styles.itemText} data-sidebar-text data-sidebar-label>
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>

      <ProjectTree open={open} activeProjectId={selectedProjectId} />

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
          <span className={styles.footBtnText} data-sidebar-text data-sidebar-label>
            全局设置
          </span>
        </button>
        {/* 自动更新入口（方案 §5）：浏览器里没有这一项，按钮自己消失 */}
        <UpdateButton open={open} />
        {/*
          ⚠️ **这里不再传 `compact`**（对账 #281）：紧凑态是"换个形状"，换形状时
          图标与文字会一起重排 —— 而侧栏这一处只需要"文字跟着宽度淡出"，
          形状保持不变、靠 CSS 把收起态的宽度定成 40px 方钮（见 module.css）。
        */}
        <ThemeToggle className={styles.themeBtn} />
      </div>

    </aside>
  )
}
