import Dexie, { type Table } from 'dexie'
import type { StoragePort, Row, TableName } from '../ports'

/**
 * IndexedDB（Dexie）——业务主库。
 * 所有表统一以 `id` 为主键；assets 表的 id 即内容哈希（产品文档 §8 的 hash 主键）。
 *
 * schema 版本：
 * - v1：画布工作台的表（projects / nodes / edges / channels / tasks / runRecords /
 *   resultGroups / assets / credentials）。projects 一开始就带 workbench 字段。
 * - v2（M5-M6）：新增 `comics` 表（漫画剧工作台私有）。Dexie 只需列出**新增**的表，
 *   其余表延续上一版定义，既有数据不受影响（架构 §9.4 数据迁移）。
 *
 * **v1 里的 `resultGroups` 刻意保留定义**：结果组 2026-09-17 已下线，但已经存在的
 * 库是按 v1 建的，把这一列从 v1 删掉会让 Dexie 在打开老库时报错（schema 与库不匹配）。
 * 删除动作放在 v2：不列出该表 ⇒ Dexie 升级时把它删掉。
 * 于是「老库能打开、升级后表消失」，既有项目不会开不了。
 */
class QinghuaDB extends Dexie {
  projects!: Table<Row, string>
  nodes!: Table<Row, string>
  edges!: Table<Row, string>
  channels!: Table<Row, string>
  tasks!: Table<Row, string>
  runRecords!: Table<Row, string>
  assets!: Table<Row, string>
  credentials!: Table<Row, string>
  presets!: Table<Row, string>
  comics!: Table<Row, string>

  constructor(name = 'qinghua') {
    super(name)
    this.version(1).stores({
      projects: 'id, workbench, updatedAt',
      nodes: 'id, projectId, parentId, type',
      edges: 'id, projectId, source, target',
      channels: 'id, protocol',
      tasks: 'id, projectId, createdAt',
      runRecords: 'id, nodeId, projectId, version, createdAt',
      resultGroups: 'id, projectId, sourceNodeId',
      assets: 'id, bytes',
      credentials: 'id',
    })
    this.version(2).stores({
      comics: 'id',
      presets: 'id',
    })
  }
}

export function createIndexedDbStorage(dbName?: string): StoragePort {
  const db = new QinghuaDB(dbName)

  const tableOf = (table: TableName): Table<Row, string> => {
    const t = (db as unknown as Record<string, Table<Row, string>>)[table]
    if (!t) throw new Error(`[storage] 未知表：${table}`)
    return t
  }

  /**
   * 事务安全打开：已打开时**完全不 await**（连 async 函数都不调用）。
   * 在 db.transaction 回调里，任何 microtask 让出都会让 Dexie 丢失事务上下文，
   * 导致事务提前提交并抛 PrematureCommitError。因此这里只在真正需要时 await，
   * 且必须内联成同步判断，不能抽成 async 函数（抽函数本身就会引入一次 await）。
   */
  const needsOpen = () => !db.isOpen()

  return {
    async open() {
      if (needsOpen()) await db.open()
    },
    async transaction(tables, fn) {
      if (needsOpen()) await db.open()
      return db.transaction('rw', tables.map(tableOf), () => fn())
    },
    async put(table, row) {
      if (needsOpen()) await db.open()
      await tableOf(table).put({ ...row })
    },
    async bulkPut(table, rows) {
      if (needsOpen()) await db.open()
      await tableOf(table).bulkPut(rows.map((r) => ({ ...r })))
    },
    async delete(table, id) {
      if (needsOpen()) await db.open()
      await tableOf(table).delete(id)
    },
    async query(table, filter) {
      if (needsOpen()) await db.open()
      const entries = Object.entries(filter).filter(([, v]) => v !== undefined)
      if (entries.length === 0) return tableOf(table).toArray()
      return tableOf(table).where(entries[0]![0]).equals(entries[0]![1] as never).toArray()
    },
    async estimateUsage() {
      const estimate = navigator.storage?.estimate
        ? await navigator.storage.estimate()
        : { usage: 0, quota: 0 }
      return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
    },
  }
}
