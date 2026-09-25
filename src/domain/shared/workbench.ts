/**
 * 工作台标识。新增工作台时在此追加字面量（架构 §9.4 第 1 步）。
 *
 * ⚠️ 2026-09-25：`comic`（漫画剧）已按用户要求**整体移除**——用户是设计师，
 * 该方向从来不是需求（当时属于误判），真正想要的是「漫剧」视频工作台（尚未开始）。
 * 现在只剩 `canvas` 一个工作台。这里**刻意保留联合类型**而不是退化成单个字面量：
 * 工作台的「多值」结构（`WORKBENCHES` 表、`WORKBENCH_ORDER`、`projectRoute`）
 * 是为下一个工作台准备的骨架，退化成单值会让「再开一个工作台」重新变成一次大改。
 */
export type WorkbenchId = 'canvas'

export interface WorkbenchDescriptor {
  id: WorkbenchId
  label: string
  /** 卡片点进去的目标路由前缀，如 '/canvas' */
  routePrefix: string
}

export const WORKBENCHES: Record<WorkbenchId, WorkbenchDescriptor> = {
  canvas: { id: 'canvas', label: '无限画布', routePrefix: '/canvas' },
}

/** 工作台展示顺序（首页新建入口、类型标签统一取此序） */
export const WORKBENCH_ORDER: WorkbenchId[] = ['canvas']

export const DEFAULT_WORKBENCH: WorkbenchId = 'canvas'

export function isWorkbenchId(value: string): value is WorkbenchId {
  return Object.prototype.hasOwnProperty.call(WORKBENCHES, value)
}

/** 项目落在哪个工作台决定卡片的目标路由（架构 §5.10） */
export function projectRoute(workbench: WorkbenchId, projectId: string): string {
  return `${WORKBENCHES[workbench].routePrefix}/${projectId}`
}
