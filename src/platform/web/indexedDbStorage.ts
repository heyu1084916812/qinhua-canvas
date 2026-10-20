import Dexie, { type Table } from 'dexie'
import type { StoragePort, Row, TableName } from '../ports'

/**
 * IndexedDB（Dexie）——业务主库。
 * 所有表统一以 `id` 为主键；assets 表的 id 即内容哈希（产品文档 §8 的 hash 主键）。
 *
 * schema 版本：
 * - v1：画布工作台的表（projects / nodes / edges / channels / tasks / runRecords /
 *   resultGroups / assets / credentials）。projects 一开始就带 workbench 字段。
 * - v2（M5-M6）：新增 `comics` 表（漫画剧工作台私有）与 `presets`。
 * - v3（2026-09-25）：**删除 `comics` 表**（漫画剧工作台整体移除）。
 * - v4（2026-09-28）：新增 `customProtocols` 表（用户自建协议，见 domain/project/protocol）。
 * - v5（2026-09-29）：新增 `assetLibrary` 表（用户手动保存的素材收藏；素材字节仍在 assets）。
 * - v6（2026-10-01）：新增 `builtinSkills` 与 `skills`，内置 / 用户技能分表。
 *
 * **删表必须写 `表名: null`，光「不列出」是删不掉的**（2026-09-25 真机实测确认）。
 *
 * 这一条与下面 `resultGroups` 的注释**相互矛盾**，实测站在后者对面：
 * 我原以为 Dexie 是「某版不列出的表即被删除」，于是写了
 * 「v3 只列出保留表 ⇒ comics 消失」。浏览器里用真实 Dexie 跑了一遍，结果是
 * **comics 仍然存在**（v3 的 `tables` 里还留着它）—— 光不列出只是「不再描述」，
 * 并不会删。正确的删法是在任一更高的版本里显式写 `comics: null`。
 *
 * 实测记录（`scripts/probe-dexie.mjs`，真实 Dexie 4.4.5）：
 *   · v3 只列 [A,B,C]（D 不出现） → 结果仍是 [A,B,C,D]，**D 没被删**
 *   · v3 写 `{D: null}`            → 结果 [A,B,C]，**D 被删，且 A 的数据完整保留**
 * 两种写法保留表的数据都不受影响，差别只在 D 到底删没删。
 *
 * **v1 里的 `resultGroups` 刻意保留定义**：结果组 2026-09-17 已下线，但已经存在的
 * 库是按 v1 建的，把这一列从 v1 删掉会让 Dexie 在打开老库时报错（schema 与库不匹配）。
 * 删除动作放在 v2：不列出该表 ⇒ Dexie 升级时把它删掉。
 * 于是「老库能打开、升级后表消失」，既有项目不会开不了。
 */
class QinghuaDB extends Dexie {
  projects!: Table<Row, string>
  projectFolders!: Table<Row, string>
  nodes!: Table<Row, string>
  edges!: Table<Row, string>
  channels!: Table<Row, string>
  tasks!: Table<Row, string>
  runRecords!: Table<Row, string>
  assets!: Table<Row, string>
  credentials!: Table<Row, string>
  presets!: Table<Row, string>
  customProtocols!: Table<Row, string>
  assetLibrary!: Table<Row, string>
  builtinSkills!: Table<Row, string>
  skills!: Table<Row, string>
  fonts!: Table<Row, string>
  snapshots!: Table<Row, string>
  /** 漫剧工作台第一阶段的整份文档（一行 = 一个项目，对账 #382） */
  storyboards!: Table<Row, string>
  /** 电商任务与逐格结果（对账 #399 第二期） */
  ecommerceTasks!: Table<Row, string>
  ecommerceResults!: Table<Row, string>
  ecommerceCanvasItems!: Table<Row, string>
  /** 灵感库的索引缓存（一行 = 一个来源；只存索引、不存媒体，见 `TableName` 的说明） */
  inspirationCache!: Table<Row, string>

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
    /**
     * v3：漫画剧工作台移除（用户 2026-09-25）。
     *
     * 删 `comics` 用的是**显式 `comics: null`**（实测唯一有效的写法，见类头注释）。
     * 同时把 `resultGroups` 也一并显式删掉 —— 它此前只在 v2 被「不列出」，
     * 按实测语义其实一直没被删过（老库里的空表残留至今），这次顺手用同一机制清掉。
     */
    this.version(3).stores({
      comics: null,
      resultGroups: null,
    })
    this.version(4).stores({
      customProtocols: 'id',
    })
    this.version(5).stores({
      assetLibrary: 'id, savedAt',
    })
    this.version(6).stores({
      builtinSkills: 'id',
      skills: 'id, builtinId, updatedAt',
    })
    // v7：Agent 会话。按 projectId 建索引 —— 会话列表总是「按当前项目过滤」
    // （设计文档 §8：会话绑定项目，不能出现「在 A 项目问 B 项目的画布」）
    this.version(7).stores({
      agentSessions: 'id, projectId, updatedAt',
    })
    /**
     * v8：给 `assets` 补 `projectId` 索引（对账 #221）。
     *
     * 起因：「含素材导出」要**按项目**取素材（`query('assets', { projectId })`），
     * 而 Dexie 的 `.where()` 要求该字段建过索引 —— 没有索引会直接抛
     * `KeyPath projectId on object store assets is not indexed`，表现为"导出失败"。
     * 只加索引、不动数据；assets 是大表，升级时 Dexie 会重建这份索引（一次性开销）。
     */
    this.version(8).stores({
      assets: 'id, projectId, bytes',
    })
    /**
     * v9：自定义界面字体（用户 2026-10-09）。
     *
     * 为什么单独一张表、不塞进 `assets`：
     *   - `assets` 是**生成素材**（内容寻址、参与素材库 / 项目导出 / 全库备份）；
     *   - 字体是**本机界面偏好**的附属字节，不该出现在素材库里、也不该被"导出项目"带走。
     * 只声明新增表，既有表由 Dexie 从上一版延续（见类头注释的实测结论）。
     */
    this.version(9).stores({
      fonts: 'id, createdAt',
    })
    /**
     * v10：项目快照（用户 2026-10-09，对账 #378 A4）。
     *
     * 按 `projectId` 建索引：取快照总是"这个项目的最近 N 张"，
     * 不带索引就得全表扫（快照行里有整份图，扫全表代价不低）。
     */
    this.version(10).stores({
      snapshots: 'id, projectId, createdAt',
    })
    /**
     * v11：漫剧工作台第一阶段的文档（对账 #382）。
     *
     * 为什么**一行一篇、不拆表**：形态还没固化（剧本 → 分集 → 分镜刚落地），
     * 历史 comic 工作台的记录写着"形态未定时不拆表，先整对象存一行"——
     * 现在拆表只会让每次调整字段都变成一次迁移。等这个形态被用起来再决定拆不拆。
     * 按 `projectId` 建索引：取文档总是"这个项目的那一份"，不带索引要全表扫。
     */
    this.version(11).stores({
      storyboards: 'id, projectId, updatedAt',
    })
    /**
     * v12：电商任务 / 结果（对账 #399 第二期）。
     *
     * `ecommerceResults` 按 `taskId` 建索引，界面总是"取这一批的 N 格"；
     * 另给 `projectId` 便于删除级联与全库备份按项目过滤。
     */
    this.version(12).stores({
      ecommerceTasks: 'id, projectId, createdAt',
      ecommerceResults: 'id, projectId, taskId, createdAt',
    })
    /**
     * v13：灵感库的索引缓存（用户 2026-10-14）。
     *
     * 一行 = 一个来源（`id` = sourceId），存 `cases` 与 `fetchedAt`。
     * **只增一张表**，既有数据不受影响；媒体不进这张表 —— 预览图与视频始终走原始外链。
     */
    this.version(13).stores({
      inspirationCache: 'id, fetchedAt',
    })
    /**
     * v14：项目导航的一层文件夹。
     *
     * `projects.folderId` 只是普通 JSON 字段，不需要索引；文件夹本身单独一表，
     * 便于重命名 / 置顶 / 删除时不动项目内容。
     */
    this.version(14).stores({
      projectFolders: 'id, updatedAt',
    })
    /**
     * v15：电商无限工作台的空间布局。
     *
     * 结果表回答「生成了什么」，这一张只回答「对象摆在无限工作台的哪里」。
     * 按 projectId 读取整个项目的对象；按 resultId 可用于清理单条失败 / 已移除结果。
     */
    this.version(15).stores({
      ecommerceCanvasItems: 'id, projectId, resultId, taskId, updatedAt',
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

  const port: StoragePort = {
    async open() {
      if (needsOpen()) await db.open()
    },
    async transaction(tables, fn) {
      if (needsOpen()) await db.open()
      return db.transaction('rw', tables.map(tableOf), () => fn(port))
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
    async scan(table, batchSize, onBatch) {
      if (needsOpen()) await db.open()
      const t = tableOf(table)
      /**
       * 先要**总数**（进度要分母）：`count()` 走 IDB 的计数，只过键、**不反序列化值** ——
       * 这正是它与 `toArray()` 的差别，大表上差的就是"崩不崩"。
       */
      const total = await t.count()
      let offset = 0
      while (offset < total) {
        // 一次只把这一批反序列化进内存（`offset/limit` 走 IDB 游标，不是先全查再切片）
        const rows = await t.offset(offset).limit(batchSize).toArray()
        if (rows.length === 0) break
        offset += rows.length
        await onBatch(rows, { total })
      }
      return offset
    },
    async estimateUsage() {
      const estimate = navigator.storage?.estimate
        ? await navigator.storage.estimate()
        : { usage: 0, quota: 0 }
      return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
    },
  }
  return port
}
