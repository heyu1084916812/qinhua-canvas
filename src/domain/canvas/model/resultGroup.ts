/**
 * 结果组：布局与溯源容器（架构 §5.3 修订）
 * - 归属真源是子节点的 nodes.parentId，childIds 是派生索引，两者必须一致
 * - 不作为边端点；组内的标准生成节点才是端点
 */
export interface ResultGroupSummary {
  success: number
  failed: number
}

export interface ResultGroup {
  id: string
  projectId: string
  sourceNodeId: string
  taskId: string
  /** 世界坐标（结果组挂在画布根上） */
  x: number
  y: number
  w: number
  h: number
  childIds: string[]
  collapsed: boolean
  createdAt: number
  summary: ResultGroupSummary
}

/** 标题 `{来源节点名称} · {时间戳}`，同秒重复追加序号（产品文档 §6.9） */
export function resultGroupTitle(sourceName: string, timestampText: string, seq?: number): string {
  const base = `${sourceName} · ${timestampText}`
  return seq && seq > 1 ? `${base} (${seq})` : base
}

export function isGroupComplete(summary: ResultGroupSummary): boolean {
  return summary.failed === 0
}
