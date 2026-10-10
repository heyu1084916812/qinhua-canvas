/**
 * 工作台标识。新增工作台时在此追加字面量（架构 §9.4 第 1 步）。
 *
 * ⚠️ 2026-09-25：`comic`（漫画剧）已按用户要求**整体移除**——用户是设计师，
 * 该方向从来不是需求（当时属于误判），真正想要的是「漫剧」视频工作台（尚未开始）。
 * 现在只剩 `canvas` 一个工作台。这里**刻意保留联合类型**而不是退化成单个字面量：
 * 工作台的「多值」结构（`WORKBENCHES` 表、`WORKBENCH_ORDER`、`projectRoute`）
 * 是为下一个工作台准备的骨架，退化成单值会让「再开一个工作台」重新变成一次大改。
 */
export type WorkbenchId = 'canvas' | 'ecommerce' | 'storyboard'

export interface WorkbenchDescriptor {
  id: WorkbenchId
  label: string
  /** 卡片点进去的目标路由前缀，如 '/canvas' */
  routePrefix: string
}

export const WORKBENCHES: Record<WorkbenchId, WorkbenchDescriptor> = {
  canvas: { id: 'canvas', label: '无限画布', routePrefix: '/canvas' },
  /* 电商工作台（对账 #384）：与画布同级的一级入口，但界面是"表单 → 出图"而不是节点图 */
  ecommerce: { id: 'ecommerce', label: '电商工作台', routePrefix: '/ecommerce' },
  /*
   * 漫剧工作台（对账 #382，第一阶段）：与画布同级的一级入口。
   * **不是**当年被移除的 comic（那是"漫画分镜"，用户明确否掉过）——
   * 这一条是"剧本 → 分集 → 分镜"的视频前段，逐镜视频等视频参数补齐再做。
   */
  storyboard: { id: 'storyboard', label: '漫剧工作台', routePrefix: '/storyboard' },
}

/** 工作台展示顺序（首页新建入口、类型标签统一取此序） */
export const WORKBENCH_ORDER: WorkbenchId[] = ['canvas', 'ecommerce', 'storyboard']

export const DEFAULT_WORKBENCH: WorkbenchId = 'canvas'

export function isWorkbenchId(value: string): value is WorkbenchId {
  return Object.prototype.hasOwnProperty.call(WORKBENCHES, value)
}

/** 项目落在哪个工作台决定卡片的目标路由（架构 §5.10） */
export function projectRoute(workbench: WorkbenchId, projectId: string): string {
  return `${WORKBENCHES[workbench].routePrefix}/${projectId}`
}
