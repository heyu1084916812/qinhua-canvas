import {
  IconAssets,
  IconCanvas,
  IconChannels,
  IconHome,
  IconProjects,
  IconSkills,
} from './AppSidebarIcons'

export interface NavItem {
  to: string
  label: string
  icon: (p: { size?: number }) => JSX.Element
}

/**
 * 一级导航。**顺序即产品口径**（产品文档 §2.2），不要按字母或任何其它规则重排。
 *
 * 单独抽成一个模块（而不是留在 `AppSidebar` 里）：**侧栏的图标与文字**和
 * **顶栏的页面标题**必须来自同一份来源 —— 两处各写一份，改导航就会出现
 * 「侧栏写着 A、顶栏写着 B」这种最难发现的不一致。
 */
export const NAV: NavItem[] = [
  { to: '/', label: '首页', icon: IconHome },
  { to: '/projects', label: '项目', icon: IconProjects },
  { to: '/canvas', label: '画布', icon: IconCanvas },
  { to: '/skills', label: '技能库', icon: IconSkills },
  { to: '/assets', label: '我的素材', icon: IconAssets },
  { to: '/settings', label: '渠道配置', icon: IconChannels },
  /**
   * 素材传输（图床）：用户 2026-10-03 要求「单独设置一个页面」。
   * 排在渠道配置之后 —— 两者都是「连接类」配置，先连站、再管素材怎么出去。
   */
  { to: '/hosting', label: '素材传输', icon: IconAssets },
]

/** 当前路径对应的一级标题（顶栏用）。`/canvas/xxx` 这类子路径按前缀匹配。 */
export function navTitleOf(pathname: string): string {
  if (pathname === '/') return NAV[0].label
  /*
   * 判据与侧栏高亮（`AppSidebar` 的 `isItemActive`）保持一致：
   * 精确相等或「以 `to + /` 开头」——只用 `startsWith(to)` 会让 `/projectsX` 这种
   * 名字撞上 `/projects`，两处判据一旦分叉，就会出现"侧栏没亮、顶栏却写着项目"。
   */
  const hit = NAV.filter((item) => item.to !== '/').find(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  )
  return hit?.label ?? ''
}
