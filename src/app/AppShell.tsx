import { useSyncExternalStore, type ReactNode } from 'react'
import { AppSidebar } from './AppSidebar'
import { GlobalSettingsOverlay } from './GlobalSettingsOverlay'
import { TitleBar } from './TitleBar'
import { UpdateNotice } from './UpdateNotice'
import { ThumbBackfill } from './ThumbBackfill'
import {
  SIDEBAR_COLLAPSED_W,
  getSidebarPinned,
  sidebarReservedWidth,
  subscribeSidebar,
} from './sidebarState'
import styles from './AppShell.module.css'

/**
 * 应用壳（产品文档 §2.1 / §2.2；架构文档 §5.10）。
 *
 * 「外壳与插槽」：左边是常驻的一级功能栏，右边是当前页面的工作区。
 * `pages` 只渲染右侧内容，不再各自画全局顶栏。
 *
 * ## 为什么画布不需要为侧栏写重算逻辑
 *
 * 画布用 `[data-canvas-surface]` 的**真实矩形**换算坐标与命中（§6.3）。
 * 工作区做成侧栏的**真实 flex 兄弟**之后，侧栏宽度变化会直接改变它的宽度，
 * 画布自己的 `ResizeObserver` 就跟得上 —— 与窗口缩放走的是同一条路径。
 * 若在壳层里手动「开合时通知画布重算」，反而会漏掉过渡动画中间那几帧。
 */
export function AppShell({ children }: { children: ReactNode }) {
  /*
   * 只订阅**钉住态**：它才是"要不要推挤工作区"的判据（见下面 `--sidebar-w` 的说明）。
   * 悬停/展开的可见宽度由侧栏自己管 —— 壳层对"鼠标在不在侧栏上"应该一无所知，
   * 这样布局就不可能跟着鼠标抖（用户 2026-10-06 第 13 批第 1 条）。
   */
  const pinned = useSyncExternalStore(subscribeSidebar, getSidebarPinned, getSidebarPinned)

  return (
    <div
      className={styles.shell}
      data-app-shell
      /*
       * 当前侧栏宽度以 CSS 变量暴露：测试与未来需要它的组件都能读，
       * 不必再去问 JS 状态。它保证「壳层宽度」只有一个来源（sidebarState）。
       */
      style={{
        /**
         * ⚠️ 这里是**布局占位**宽度：只有"钉住"才推挤工作区，悬停预览不推。
         *
         * 用户 2026-10-06 第 13 批第 1 条「左边的菜单栏变成闪动了」的根因就在这一行：
         * 悬停也改占位 ⇒ 鼠标一碰侧栏，整块画布被推着滑 176px（实测节点屏幕 x 1668 → 1844），
         * 移开再滑回来 —— 看着就是"闪"。悬停只是"顺手看一眼"，不该重排整个应用。
         */
        ['--sidebar-w' as string]: `${sidebarReservedWidth(pinned)}px`,
        // 顶栏高度要与「侧栏折叠宽度」同值（用户 2026-10-06 定的节奏）：
        // 值来自同一个常量，避免 CSS 里再写死一个 64。
        ['--sidebar-collapsed-w' as string]: `${SIDEBAR_COLLAPSED_W}px`,
      }}
    >
      {/*
        ⚠️ **这里没有"应用内顶栏"** —— 用户 2026-10-06 明确纠正过：
        他说的「顶栏」就是 **Windows 标题栏**，而那根要**自绘**（见 `TitleBar`，
        壳里渲染、高度 64−15=49px）。我第一版自作主张加了一条应用内顶栏（带页面名），
        那既不是他说的东西、还和页面自己的大标题重复 ⇒ 已删。
      */}
      <TitleBar />
      {/* 侧栏与工作区并排（`.body` 左侧不留白：工作区紧贴侧栏，用户 2026-10-06 定） */}
      <div className={styles.body}>
        {/*
          侧栏的**布局占位**（只占宽、不画东西）。
          悬停预览时侧栏是浮层（见 `data-sidebar-floating`），不参与布局 ——
          位置就由这个空盒子撑着；少了它，工作区会一直顶到窗口最左边。
        */}
        <div className={styles.railSlot} aria-hidden="true" />
        <AppSidebar />
        {/*
          工作区。`min-width: 0` 是关键 —— flex 子项的默认 `min-width: auto`
          会让内容把这一块顶宽，于是侧栏展开时右侧不是变窄，
          而是把整个窗口撑出一条横向滚动条。
        */}
        <main className={styles.workspace} data-app-workspace>
          {children}
        </main>
      </div>
      {/* 自动更新的右下角提示条（方案 §5）：浏览器里没有 updater 端口，自己就不渲染 */}
      <UpdateNotice />
      {/* 全局设置浮层（对账 #259）：挂在这一层，任何路由都能打开 */}
      <GlobalSettingsOverlay />
      {/* 存量素材缩略图的一次性补图（对账 #232）：没有界面，进画布自动让路 */}
      <ThumbBackfill />
    </div>
  )
}
