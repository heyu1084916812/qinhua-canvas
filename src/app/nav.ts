import {
  IconAssets,
  IconCanvas,
  IconEcommerce,
  IconHome,
  IconInspiration,
  IconProjects,
  IconSkills,
  IconStoryboard,
} from './AppSidebarIcons'
import { projectRoute, type WorkbenchId } from '../domain/shared/workbench'

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
  /* 电商工作台（对账 #384）：与画布同级的一级入口 —— 表单出图，不是节点图 */
  { to: '/ecommerce', label: '电商', icon: IconEcommerce },
  /* 漫剧工作台（对账 #382）：剧本 → 分集 → 分镜（逐镜视频等视频参数补齐再做） */
  { to: '/storyboard', label: '漫剧', icon: IconStoryboard },
  { to: '/skills', label: '技能库', icon: IconSkills },
  /* 灵感库（用户 2026-10-14）：外部开源案例的**浏览**入口，与「我的素材」（自己的产出）并列 */
  { to: '/inspiration', label: '灵感库', icon: IconInspiration },
  { to: '/assets', label: '我的素材', icon: IconAssets },
]

const WORKBENCH_NAV = new Map<string, WorkbenchId>([
  ['/canvas', 'canvas'],
  ['/ecommerce', 'ecommerce'],
  ['/storyboard', 'storyboard'],
])

export function workbenchForNav(to: string): WorkbenchId | null {
  return WORKBENCH_NAV.get(to) ?? null
}

export interface NavProjectContext {
  id: string
  workbench: WorkbenchId
}

/** 目标一级入口只使用该工作台自己的最近项目；当前路由的项目优先。 */
export function navProjectContextFor(
  to: string,
  activeProject: NavProjectContext | null,
  recentIds: Partial<Record<WorkbenchId, string | null>>,
): NavProjectContext | null {
  const workbench = workbenchForNav(to)
  if (!workbench) return null
  if (activeProject?.workbench === workbench) return activeProject
  const id = recentIds[workbench]
  return id ? { id, workbench } : null
}

/**
 * 一级工作台入口只沿用到**同类型项目**。
 *
 * 从一个电商项目切去「画布」时，绝不能把这个电商项目的 id 塞进 `/canvas/:id`：
 * 那会把一个电商任务伪装成节点画布，并让两个工作台重新串在一起。
 * 类型不同就进目标工作台自己的入口页。
 */
export function navTargetFor(to: string, project: NavProjectContext | null): string {
  const workbench = workbenchForNav(to)
  return workbench && project?.workbench === workbench
    ? projectRoute(workbench, project.id)
    : to
}

/**
 * **不再出现在侧栏、但顶栏标题仍要认**的路径（用户 2026-10-06，对账 #259）。
 *
 * 「渠道配置」与「素材传输」已降级为**全局设置浮层的子菜单**，故从 `NAV` 里拿掉；
 * 两条**路由保留** —— 书签、深链与自动化探针都在用它们，删掉是把一条可用入口打断，
 * 成本为零、收益也为零。
 */
const EXTRA_TITLES: Record<string, string> = {
  '/settings': '全局设置 · 模型服务',
  '/hosting': '全局设置 · 素材传输',
}

/** 当前路径对应的一级标题（顶栏用）。`/canvas/xxx` 这类子路径按前缀匹配。 */
export function navTitleOf(pathname: string): string {
  if (pathname === '/') return NAV[0].label
  const extra = Object.entries(EXTRA_TITLES).find(
    ([to]) => pathname === to || pathname.startsWith(`${to}/`),
  )
  if (extra) return extra[1]
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
