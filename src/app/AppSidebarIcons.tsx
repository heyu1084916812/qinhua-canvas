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

/**
 * 电商工作台（对账 #384）：一只**商品袋**。
 *
 * 为什么不复用「画布」那个节点图标：两个入口是**同级但不同形态**的工作台
 * （一个是节点图、一个是表单出图），图标一样会让人以为是同一个页面。
 */
export function IconEcommerce({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M5 8.5h14l-1 11a1.5 1.5 0 0 1-1.5 1.35h-9A1.5 1.5 0 0 1 6 19.5Z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  )
}

/**
 * 漫剧工作台（对账 #382）：一块**场记板**。
 *
 * 为什么不用"胶片"：胶片更像播放器；场记板一眼是"开拍前的那张表"，
 * 与这个工作台正在做的事（剧本 → 分集 → 分镜）对得上。
 */
export function IconStoryboard({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M7.5 5l2 4.5M12 5l2 4.5M16.5 5l2 4.5" />
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

/** 技能库：一本打开的书 */
export function IconSkills({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M3.7 5.2c2.9-.8 5.5.1 8.3 2v12c-2.8-1.9-5.4-2.8-8.3-2Z" />
      <path d="M20.3 5.2c-2.9-.8-5.5.1-8.3 2v12c2.8-1.9 5.4-2.8 8.3-2Z" />
      <path d="M12 7.2v12" />
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

/**
 * 灵感库：火花 / 发光。
 *
 * 与参考图里「灵感」那一项同一类意象 —— 与「我的素材」（相框）刻意不同：
 * 那两个入口一个是**自己的产出**、一个是**外面的参考**，图标不该长得像。
 */
export function IconInspiration({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 2.8v3.2M12 18v3.2M2.8 12H6M18 12h3.2M6.5 6.5l2.2 2.2M15.3 15.3l2.2 2.2M17.5 6.5l-2.2 2.2M8.7 15.3l-2.2 2.2" />
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

/** 全局设置：两条带旋钮的滑块（比齿轮更好认、也更好画） */
export function IconSettings({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 8h9M19 8h1" />
      <path d="M4 16h1M11 16h9" />
      <circle cx="16" cy="8" r="2.1" />
      <circle cx="8" cy="16" r="2.1" />
    </svg>
  )
}

/** 关闭（浮层右上角）：一个叉 */
export function IconClose({ size = 18 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} viewBox="0 0 24 24">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  )
}
