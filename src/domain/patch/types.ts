/** 表名与 §8 数据模型一致 */
export type TableName =
  | 'projects'
  | 'nodes'
  | 'edges'
  | 'channels'
  | 'tasks'
  | 'runRecords'
  | 'assets'
  | 'credentials'

export interface Row {
  id: string
  [key: string]: unknown
}

export type Patch =
  | { op: 'upsert'; table: TableName; row: Row }
  | { op: 'delete'; table: TableName; id: string }
  | { op: 'patch'; table: TableName; id: string; changes: Record<string, unknown> }

export type InversePatch = Patch

/** 持久化计划：由命令产出，交给 persistenceService 按 800ms 防抖成批写入 */
export interface PersistPlan {
  tables: TableName[]
  upserts: { table: TableName; rows: Row[] }[]
  deletes: { table: TableName; ids: string[] }[]
}
