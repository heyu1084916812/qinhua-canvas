/**
 * 应用壳侧栏的线性图标（架构文档 §5.10「AppShell 不得 import workbenches/canvas/*」）。
 *
 * 为什么**不能**复用画布工具栏那套 `workbenches/canvas/toolbar/icons.tsx`：
 *  - 架构上，壳层是「外壳」，工作台是「插槽」；外壳反向依赖某个工作台，
 *    等于把「任何页面都要常驻」的东西绑死在「只有画布页才需要」的代码上
 *    —— 将来多一个工作台，壳层就会同时依赖两个；
 *  - 语义上，那套图标是**画布动作**（新建节点 / 整理 / 撤销），
 *    而这里是**一级导航**（首页 / 项目 / 技能库），本来就不是一套东西。
 *
 * 因此这里自建一组：统一 1.6 描边、`currentColor`、不填充（与 §3.2
 * 「统一走线性图标」同一条口径），尺寸由外层 CSS 控制。
 */

interface IconProps {
  size?: number
}

const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
}

/** 首页：一栋房子 */
export function IconHome({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 10v9h12v-9" />
    </svg>
  )
}

/** 项目：一叠卡片 */
export function IconProjects({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M7 19.5h10" />
    </svg>
  )
}

/** 画布：节点与连线 */
export function IconCanvas({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3.5" y="4" width="6" height="5.5" rx="1.5" />
      <rect x="14.5" y="14.5" width="6" height="5.5" rx="1.5" />
      <path d="M9.5 6.75h5.25a2 2 0 0 1 2 2v5.75" />
    </svg>
  )
}

/** 技能库：一块文档 + 星标 */
export function IconSkills({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="m12 11.5 1.1 2.2 2.4.35-1.75 1.7.4 2.4-2.15-1.15-2.15 1.15.4-2.4-1.75-1.7 2.4-.35Z" />
    </svg>
  )
}

/** 我的素材：图片框 */
export function IconAssets({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17.5 4.6-4.2 3.4 3 2.6-2.3 4.4 4" />
    </svg>
  )
}

/** 渠道配置：插头 / 接口 */
export function IconChannels({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M9 3.5v5M15 3.5v5" />
      <path d="M6.5 8.5h11v3.25a5.5 5.5 0 0 1-11 0Z" />
      <path d="M12 17.25v3.25" />
    </svg>
  )
}

/** 侧栏展开 / 收起：一个方框 + 左侧竖线 */
export function IconSidebarToggle({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </svg>
  )
}

/** 新建项目：加号 */
export function IconNewProject({ size = 18 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  )
}
