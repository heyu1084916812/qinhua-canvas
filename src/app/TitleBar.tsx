import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { getVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { IconSidebarToggle } from './AppSidebarIcons'
import { navTitleOf } from './nav'
import { getSidebarPinned, subscribeSidebar, toggleSidebarPin } from './sidebarState'
import styles from './TitleBar.module.css'

/** 项目主页：设置里「应用 → GitHub 项目地址」用它（与自动更新的仓库同一个）。 */
const REPO_URL = 'https://github.com/heyu1084916812/qinhua-canvas'

/**
 * 「编辑」菜单里列出的快捷键。
 *
 * ⚠️ **只列真实存在的那几条**（来源：`workbenches/canvas/useCanvasKeyboard.ts` 与 `RunHotkeys`）——
 * 快捷键表最容易变成"写给人看的样子货"：抄一份别人的，用户按了没反应，比不写更糟。
 */
const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Ctrl + Z', what: '撤销' },
  { keys: 'Ctrl + Shift + Z', what: '重做' },
  { keys: 'Z', what: '复位视图（缩放到全部节点）' },
  { keys: 'Ctrl + G', what: '把选中的节点打成一组' },
  { keys: 'Tab', what: '选中下一个节点' },
  { keys: '方向键', what: '在节点之间移动选中' },
  { keys: 'Home / End', what: '跳到最前 / 最后一个节点' },
  { keys: 'R', what: '运行选中的节点' },
  { keys: 'Delete', what: '删除选中的节点或连线' },
  { keys: '空格 + 拖拽', what: '平移画布' },
  { keys: '滚轮 / 触控板', what: '缩放画布' },
]

/**
 * **自绘的 Windows 标题栏**（用户 2026-10-06 明确：「我说的顶栏就是 windows 标题栏」）。
 *
 * ## 为什么要自绘
 *
 * 用户要的"包围"结构里，**那一根顶栏指的就是系统标题栏**，而且它的高度要参与节奏：
 * **标题栏 + 上方留白 = 侧栏折叠宽度（64px）** ⇒ 标题栏 = 64 − 15 = **49px**。
 * 系统标题栏的高度由 Windows 定、应用改不了，所以只能 `decorations: false` 自己画一根。
 *
 * ## 只在壳里渲染
 *
 * 浏览器里窗口装饰归浏览器，应用不该再画一根（画了就是两根）⇒ `isTauri()` 为假时
 * **返回 null**。所以浏览器预览里"上方留白"就是那 15px，壳里才是 49 + 15。
 *
 * ## 必须自己接管的三件事（去掉系统装饰的代价）
 *
 * 1. **拖动窗口**：`data-tauri-drag-region`（Tauri 原生支持，双击该区域还会最大化 —— 与系统一致）；
 * 2. **最小化 / 最大化 / 关闭**：调 `getCurrentWindow()`；
 * 3. **最大化状态**：跟着窗口尺寸事件更新，否则按钮图标会停在旧状态。
 */
export function TitleBar() {
  const location = useLocation()
  const [maximized, setMaximized] = useState(false)
  const [menu, setMenu] = useState<null | 'app' | 'edit'>(null)
  const [version, setVersion] = useState('')
  const inShell = useSyncExternalStore(
    // 运行环境**不变**，所以订阅是个空实现：只为拿到 SSR 安全的一次性取值
    () => () => {},
    () => isTauri(),
    () => false,
  )
  const pinned = useSyncExternalStore(subscribeSidebar, getSidebarPinned, getSidebarPinned)

  /** 点空白处关菜单：与浮层同一口径（点在菜单**本身**上不算）。 */
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    if (!inShell) return
    const win = getCurrentWindow()
    // 版本号取**壳自己**的（不是清单上的）：菜单里显示的就是"你装的这一版"
    void getVersion().then(setVersion).catch(() => setVersion(''))
    void win.isMaximized().then(setMaximized)
    const unlisten = win.onResized(() => {
      void win.isMaximized().then(setMaximized)
    })
    return () => {
      void unlisten.then((off) => off())
    }
  }, [inShell])

  if (!inShell) return null

  const page = navTitleOf(location.pathname)

  return (
    <header className={styles.bar} data-title-bar data-tauri-drag-region>
      {/*
        ① 折叠 / 常驻（用户 2026-10-06 第 1 条：**把侧栏那个搬上来**）。
        它原来长在侧栏头部（悬停才浮现），现在住进标题栏 —— 侧栏头部因此只剩品牌。
        ⚠️ 浏览器里没有标题栏 ⇒ 侧栏头部会**退回**显示同一个开关（见 AppSidebar 的注释）。
      */}
      <button
        type="button"
        className={styles.iconBtn}
        data-sidebar-toggle
        data-title-sidebar
        aria-pressed={pinned}
        aria-label={pinned ? '取消常驻展开（移开鼠标后自动收起）' : '常驻展开侧栏'}
        title={pinned ? '取消常驻展开' : '常驻展开'}
        onClick={() => toggleSidebarPin()}
      >
        <IconSidebarToggle size={16} />
      </button>

      <span className={styles.brand} data-tauri-drag-region>
        <span className={styles.name}>轻画</span>
        {page && <span className={styles.sep}>·</span>}
        {page && <span className={styles.page}>{page}</span>}
      </span>

      {/* ②③ 菜单：应用（版本 + 仓库地址）/ 编辑（常用快捷键） */}
      <div className={styles.menus} ref={menuRef}>
        <TitleMenu
          id="app"
          label="应用"
          open={menu === 'app'}
          onToggle={() => setMenu(menu === 'app' ? null : 'app')}
        >
          <div className={styles.menuHead} data-title-version>
            轻画 {version ? `v${version}` : '（开发预览）'}
          </div>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            data-title-open-repo
            onClick={() => {
              setMenu(null)
              // 交给系统默认浏览器打开（壳里这才是"用户自己去看看"的正确出口）
              void openUrl(REPO_URL).catch(() => {})
            }}
          >
            GitHub 项目地址 ↗
          </button>
        </TitleMenu>

        <TitleMenu
          id="edit"
          label="编辑"
          open={menu === 'edit'}
          onToggle={() => setMenu(menu === 'edit' ? null : 'edit')}
        >
          <div className={styles.menuHead}>常用快捷键</div>
          <ul className={styles.shortcuts}>
            {SHORTCUTS.map((row) => (
              <li key={row.keys} className={styles.shortcutRow}>
                <span className={styles.shortcutWhat}>{row.what}</span>
                <kbd className={styles.kbd}>{row.keys}</kbd>
              </li>
            ))}
          </ul>
        </TitleMenu>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          data-title-minimize
          aria-label="最小化"
          title="最小化"
          onClick={() => void getCurrentWindow().minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.btn}
          data-title-maximize
          aria-label={maximized ? '还原' : '最大化'}
          title={maximized ? '还原' : '最大化'}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" />
              <path d="M2.5 2.5H0.5v7h7v-2" fill="none" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.close}`}
          data-title-close
          aria-label="关闭"
          title="关闭"
          onClick={() => void getCurrentWindow().close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  )
}

/** 标题栏上的一个下拉菜单（应用 / 编辑 共用）：触发器 + 面板，开合由父级的单值状态管。 */
function TitleMenu({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string
  label: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className={styles.menuWrap}>
      <button
        type="button"
        className={open ? `${styles.menuBtn} ${styles.menuBtnOn}` : styles.menuBtn}
        data-title-menu={id}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
      </button>
      {open && (
        <div className={styles.menu} role="menu" data-title-menu-panel={id}>
          {children}
        </div>
      )}
    </div>
  )
}
