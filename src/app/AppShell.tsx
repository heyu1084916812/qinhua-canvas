import { useSyncExternalStore, type ReactNode } from 'react'
import { AppSidebar } from './AppSidebar'
import { getSidebarOpen, sidebarWidth, subscribeSidebar } from './sidebarState'
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
  const open = useSyncExternalStore(subscribeSidebar, getSidebarOpen, getSidebarOpen)

  return (
    <div
      className={styles.shell}
      data-app-shell
      /*
       * 当前侧栏宽度以 CSS 变量暴露：测试与未来需要它的组件都能读，
       * 不必再去问 JS 状态。它保证「壳层宽度」只有一个来源（sidebarState）。
       */
      style={{ ['--sidebar-w' as string]: `${sidebarWidth(open)}px` }}
    >
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
  )
}
