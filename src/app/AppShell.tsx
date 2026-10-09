import { useSyncExternalStore, type ReactNode } from 'react'
import { AppSidebar } from './AppSidebar'
import { GlobalSettingsOverlay } from './GlobalSettingsOverlay'
import { TitleBar } from './TitleBar'
import { UpdateNotice } from './UpdateNotice'
import { ThumbBackfill } from './ThumbBackfill'
import { GettingStarted } from '../features/onboarding/GettingStarted'
import {
  SIDEBAR_COLLAPSED_W,
  getSidebarOpen,
  sidebarReservedWidth,
  subscribeSidebar,
} from './sidebarState'
import styles from './AppShell.module.css'
import { usePlatform } from './providers/PlatformProvider'
import { useAutoSnapshot } from '../state/project/useAutoSnapshot'

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
  /**
   * 自动快照（对账 #378 A4）：应用启动时跑一次，由规则层决定哪些项目真需要拍。
   * 放在壳层是因为它**与页面无关** —— 无论用户先打开项目页还是直接进画布，都该发生。
   */
  useAutoSnapshot(usePlatform().storage)

  /*
   * 订阅**展开态**（= 钉住 或 悬停，见 `sidebarState.getSidebarOpen`）。
   *
   * ⚠️ 口径在 2026-10-08 被用户改回来了：「左边这个悬停是长出来的，不是往右推出来的，
   * 我要的是展开按钮展开的那种效果」—— 即**悬停也要把工作区推出去**，
   * 与按钮展开是同一套效果（只是不常驻）。
   *
   * 为什么这次不会再"闪"：2026-10-06 那版的"闪"来自**占位盒瞬间跳**
   * （占位宽度写在 `flex-basis` 上，而 `transition: width` 动的是一个被忽略的值）
   * ⇒ 工作区左缘一帧内从 64 跳到 240，而侧栏还在慢慢滑。现在占位盒改成由 `width`
   * 驱动、与侧栏用**同一条过渡**（180ms 同缓动），两者一起滑动 ⇒ 平滑、无跳变。
   */
  const open = useSyncExternalStore(subscribeSidebar, getSidebarOpen, getSidebarOpen)

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
         * ⚠️ 这里是**布局占位**宽度，取"展开态"（钉住 **或** 悬停）：
         * 2026-10-08 起悬停也推挤工作区（用户要"和展开按钮一样的效果"，见上）。
         * 平滑的关键不在这行，而在 `.railSlot` 的过渡与 `flex-basis` 的写法（见那边注释）。
         */
        ['--sidebar-w' as string]: `${sidebarReservedWidth(open)}px`,
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
          侧栏自己 `position: absolute`、不参与布局 ⇒ "工作区从哪儿开始"只能由这个盒子撑着；
          少了它，工作区会一直顶到窗口最左边。
          宽度跟**展开态**走（钉住 **或** 悬停）⇒ 与侧栏用同一条过渡一起滑（见 `.railSlot` 注释）。
          `data-rail-slot` 是给冒烟的测量钩子：逐帧量它的宽度，用来证明占位是"滑过去"而不是"跳过去"。
        */}
        <div className={styles.railSlot} data-rail-slot aria-hidden="true" />
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
      {/* 首次使用引导（对账 #388 / E7）：看没看过只认本机标记；跳过 / 看完都不再自动弹 */}
      <GettingStarted />
      {/* 存量素材缩略图的一次性补图（对账 #232）：没有界面，进画布自动让路 */}
      <ThumbBackfill />
    </div>
  )
}
