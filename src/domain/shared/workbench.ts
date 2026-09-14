/** 工作台标识。新增工作台时在此追加字面量（架构 §9.4 第 1 步） */
export type WorkbenchId = 'canvas' | 'comic'

export interface WorkbenchDescriptor {
  id: WorkbenchId
  label: string
  /** 卡片点进去的目标路由前缀，如 '/canvas' */
  routePrefix: string
}

export const WORKBENCHES: Record<WorkbenchId, WorkbenchDescriptor> = {
  canvas: { id: 'canvas', label: '无限画布', routePrefix: '/canvas' },
  comic: { id: 'comic', label: '漫画剧', routePrefix: '/comic' },
}

/** 工作台展示顺序（首页新建入口、类型标签统一取此序） */
export const WORKBENCH_ORDER: WorkbenchId[] = ['canvas', 'comic']

export const DEFAULT_WORKBENCH: WorkbenchId = 'canvas'

export function isWorkbenchId(value: string): value is WorkbenchId {
  return Object.prototype.hasOwnProperty.call(WORKBENCHES, value)
}

/** 项目落在哪个工作台决定卡片的目标路由（架构 §5.10） */
export function projectRoute(workbench: WorkbenchId, projectId: string): string {
  return `${WORKBENCHES[workbench].routePrefix}/${projectId}`
}
