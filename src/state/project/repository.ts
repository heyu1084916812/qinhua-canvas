import type { StoragePort, TableName } from '../../platform/ports'
import type { Project, ProjectListItem, CreateProjectInput } from '../../domain/project/project'
import { createProject } from '../../domain/project/project'
import { readCoverMark, resolveProjectCover } from '../../domain/project/cover'
import { createId } from '../../shared/id'

/**
 * projects 表仓储（架构 §5.10：项目 CRUD 不是图数据，直连 platform.storage，
 * 不走 dispatch / undo 栈）。入参是已经拿到的 StoragePort，不依赖运行时。
 *
 * 位置在 state/ 而非 domain/：仓储要 import platform 的 StoragePort，
 * 会触发 domain-pure 守卫（domain 只能依赖 domain / shared），故放在 state 层。
 */
export interface ProjectRepository {
  /** 未删除的项目（回收站里的不在其中） */
  list(): Promise<ProjectListItem[]>
  /** 回收站里的项目，按删除时间倒序（最近删的在前） */
  listDeleted(): Promise<ProjectListItem[]>
  get(id: string): Promise<Project | null>
  create(input?: CreateProjectInput): Promise<ProjectListItem>
  rename(id: string, name: string): Promise<void>
  /** 复制项目及其全部图数据（节点 / 连线），生成带「副本」后缀的新项目 */
  duplicate(id: string): Promise<ProjectListItem>
  /** **软删**：打上 deletedAt，进回收站；级联表一条都不动（对账 #378 A3） */
  remove(id: string): Promise<void>
  /** 批量软删，与单删同一套语义 */
  removeMany(ids: readonly string[]): Promise<void>
  /** 从回收站还原（清掉 deletedAt） */
  restore(id: string): Promise<void>
  /** **永久删除**：从回收站里彻底清掉，这时才动级联表 */
  purge(id: string): Promise<void>
  /** 清空回收站（逐个永久删除） */
  purgeAll(): Promise<number>
  /**
   * **清理 N 天前**删掉的项目（对账 #409）。
   *
   * 为什么是"用户点一下"而不是后台自动跑：它删的是**不可恢复**的数据
   * （连同级联表一起清），误判一次就是用户的东西没了。所以这里只提供一个
   * **显式动作**：界面上写清"清理 30 天前（N）"，点两次才执行，
   * 后台**永远不会**自己删 —— 那条"自动清理"要动的话属于产品决策，不是实现细节。
   *
   * @param days 保留天数（删的是 `deletedAt` 早于 `now - days` 的那些）
   * @param now  注入时钟（单测用；默认 `Date.now()`）
   * @returns 实际清掉的项目数
   */
  purgeOlderThan(days: number, now?: number): Promise<number>
}

/** 图数据：跟随项目**复制**，也跟随项目**删除** */
const GRAPH_TABLES: TableName[] = ['nodes', 'edges']

/**
 * 删项目时要一起清掉的表：**凡「带 projectId 且脱离项目就没有意义」的都在这**。
 *
 * 为什么单独一个常量：`GRAPH_TABLES` 还兼着「复制项目时抄哪些表」的职责
 * （副本不该继承执行日志与会话），两者**该抄的集合不一样** —— 合并成一个常量，
 * 下一次加表就会有人按「复制」的语义判断，于是删除这条又漏。
 *
 * 2026-10-01 补：原先只有 nodes / edges，`tasks` / `runRecords` / `agentSessions`
 * 都留在了库里。用户删掉项目后看不见它们（查询一律按 projectId 过滤），
 * 但每次删项目都会留下一批**永远不会再被读到的行** —— 这种「看不见的堆积」
 * 只能靠回读断言抓，读代码是读不出来的。
 *
 * 注意**刻意不包括** `assets` / `assetLibrary`：素材按内容哈希共享、素材库是全局收藏，
 * 删一个项目不该把别的项目还在用的图一起删掉。
 */
const PROJECT_CASCADE_TABLES: TableName[] = [
  ...GRAPH_TABLES,
  'tasks',
  'runRecords',
  'agentSessions',
  /* 漫剧文档（对账 #382）：脱离项目就没有意义，彻底删除时一起清 */
  'storyboards',
  /* 电商任务与逐格结果（对账 #399 第二期）：脱离项目就没有意义 */
  'ecommerceTasks',
  'ecommerceResults',
]

export function createProjectRepository(storage: StoragePort): ProjectRepository {
  const toProject = (row: Record<string, unknown>): Project => ({
    id: String(row.id),
    workbench: (row.workbench as Project['workbench']) ?? 'canvas',
    name: (row.name as string) || '未命名项目',
    createdAt: (row.createdAt as number) ?? 0,
    updatedAt: (row.updatedAt as number) ?? 0,
    thumbnail: (row.thumbnail as string | null | undefined) ?? null,
    extra: (row.extra as Record<string, unknown> | undefined) ?? {},
    // 只在真有值时带上：无值时不写这个键，导出的 JSON 里不会多一个 null 字段
    ...(typeof row.deletedAt === 'number' && row.deletedAt > 0
      ? { deletedAt: row.deletedAt }
      : {}),
  })

  const get = async (id: string): Promise<Project | null> => {
    const rows = await storage.query('projects', { id })
    return rows[0] ? toProject(rows[0]) : null
  }

  /** 给一个项目补上列表展示需要的节点数与封面（回收站复用同一份，口径不重复写） */
  const toListItem = async (p: Project): Promise<ProjectListItem> => {
    const nodes = await storage.query('nodes', { projectId: p.id })
    /**
     * 封面 = **最后一次出现在画布中的图片**（用户 2026-10-06 明确的口径，对账 #289）。
     *
     * 两个候选、一个判据（谁更晚谁当封面，规则与容错都在 `domain/project/cover.ts`）：
     *
     * 1. **生成产物**：数据来源是 `runRecords`，不是节点 —— 节点上只有 `assetHash`
     *    （当前那张），没有「什么时候生成的」。而 RunRecord 带 `createdAt` 与
     *    `outputHashes`，天然就是「生成历史」：按时间倒序取第一条有产物的，
     *    再取它的**最后一张**（一次生成多张时，用户看到的是最后落下的那张）。
     * 2. **上传 / 导入**：`projects.extra.cover` 那一笔（由 `importAssetFile` 记下）。
     *    之所以不在**这里**实时扫 `assets` 表：那表每行带全分辨率字节，
     *    对每个项目查一次 = 打开首页就把几百 MB 拉进内存（见 cover.ts 的长注释）。
     *
     * 为什么不用 `project.thumbnail`（dataURL）：那张图会让项目列表背上几 MB 的
     * base64，而这里只需要一个 hash，卡片侧用既有的 `useAsset` 取字节
     * （那条链路有退避重试与内容寻址缓存）。
     */
    const records = (await storage.query('runRecords', { projectId: p.id })) as unknown as {
      createdAt: number
      outputHashes?: string[]
    }[]
    const latest = records
      .filter((r) => (r.outputHashes?.length ?? 0) > 0)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    const generatedHash = latest?.outputHashes?.[latest.outputHashes.length - 1]
    const coverHash = resolveProjectCover({
      generated: generatedHash ? { hash: generatedHash, at: latest.createdAt } : null,
      marked: readCoverMark(p.extra),
    })
    return { ...p, nodeCount: nodes.length, coverHash }
  }

  /** **彻底**删一个项目：只有永久删除 / 清空回收站才走这里（级联表一起清） */
  const purgeOne = async (db: StoragePort, id: string): Promise<void> => {
    await db.delete('projects', id)
    for (const table of PROJECT_CASCADE_TABLES) {
      const rows = await db.query(table, { projectId: id })
      for (const row of rows) await db.delete(table, row.id)
    }
  }

  /**
   * 回收站里的项目（按删除时间倒序）。
   *
   * 抽成独立函数的原因：`purgeAll` 也要用它，而在对象方法里写 `this.xxx()`
   * 会在方法被解构出去调用时（`const { purgeAll } = repo`）丢 `this`。
   */
  const listDeletedProjects = async (): Promise<Project[]> => {
    const rows = await storage.query('projects', {})
    return rows
      .map(toProject)
      .filter((p) => !!p.deletedAt)
      // 最近删的排在最前：用户来回收站通常是刚删错
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  }

  return {
    async list() {
      const rows = await storage.query('projects', {})
      // 回收站里的项目不在列表里 —— 这是"软删"对用户可见的那一半
      const projects = rows
        .map(toProject)
        .filter((p) => !p.deletedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      if (projects.length === 0) return []

      /**
       * 项目列表不能按项目逐个查节点和运行记录。
       *
       * 56 个项目会瞬间发 112 个 `/query`；其中任一请求被中断，
       * `Promise.all` 就整批失败，页面会错误地显示成"没有项目"。
       * 这里固定为三张整表查询，再在内存里按 projectId 聚合。
       */
      const ids = new Set(projects.map((p) => p.id))
      const [nodeRows, recordRows] = await Promise.all([
        storage.query('nodes', {}, { fields: ['id', 'projectId'] }),
        storage.query('runRecords', {}, { fields: ['id', 'projectId', 'createdAt', 'outputHashes'] }),
      ])
      const nodeCounts = new Map<string, number>()
      for (const row of nodeRows) {
        const projectId = (row as { projectId?: unknown }).projectId
        if (typeof projectId === 'string' && ids.has(projectId)) {
          nodeCounts.set(projectId, (nodeCounts.get(projectId) ?? 0) + 1)
        }
      }
      const latestHash = new Map<string, { createdAt: number; hash: string }>()
      for (const row of recordRows) {
        const record = row as unknown as {
          projectId?: unknown
          createdAt?: unknown
          outputHashes?: unknown
        }
        if (typeof record.projectId !== 'string' || !ids.has(record.projectId)) continue
        if (!Array.isArray(record.outputHashes)) continue
        const hashes = record.outputHashes.filter((hash): hash is string => typeof hash === 'string')
        const hash = hashes[hashes.length - 1]
        if (!hash) continue
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0
        const previous = latestHash.get(record.projectId)
        if (!previous || createdAt > previous.createdAt) {
          latestHash.set(record.projectId, { createdAt, hash })
        }
      }
      return projects.map((p) => {
        const generated = latestHash.get(p.id)
        return {
          ...p,
          nodeCount: nodeCounts.get(p.id) ?? 0,
          coverHash: resolveProjectCover({
            generated: generated ? { hash: generated.hash, at: generated.createdAt } : null,
            marked: readCoverMark(p.extra),
          }),
        }
      })
    },

    async listDeleted() {
      return Promise.all((await listDeletedProjects()).map(toListItem))
    },

    get,

    async create(input: CreateProjectInput = {}) {
      // 复用 domain 的构造函数：默认名按 workbench 区分（现只有 canvas「未命名项目」）
      const project = createProject(input, createId('proj'), Date.now())
      await storage.put('projects', project as never)
      return { ...project, nodeCount: 0 }
    },

    async rename(id: string, name: string) {
      const existing = await get(id)
      if (!existing) return
      await storage.put('projects', {
        ...existing,
        name: name.trim() || existing.name,
        updatedAt: Date.now(),
      } as never)
    },

    /** 软删：只打标记，级联表一条不动（还原时才不需要"重建"图） */
    async remove(id: string) {
      const existing = await get(id)
      if (!existing) return
      await storage.put('projects', { ...existing, deletedAt: Date.now() } as never)
    },

    async removeMany(ids) {
      const unique = [...new Set(ids)]
      if (unique.length === 0) return
      const at = Date.now()
      for (const id of unique) {
        const existing = await get(id)
        if (!existing) continue
        await storage.put('projects', { ...existing, deletedAt: at } as never)
      }
    },

    async restore(id) {
      const rows = await storage.query('projects', { id })
      const row = rows[0]
      if (!row) return
      const { deletedAt: _drop, ...rest } = row as Record<string, unknown>
      await storage.put('projects', rest as never)
    },

    async purge(id) {
      await storage.transaction(['projects', ...PROJECT_CASCADE_TABLES], async (tx) => {
        await purgeOne(tx, id)
      })
    },

    async purgeAll() {
      const deleted = await listDeletedProjects()
      if (deleted.length === 0) return 0
      await storage.transaction(['projects', ...PROJECT_CASCADE_TABLES], async (tx) => {
        for (const p of deleted) await purgeOne(tx, p.id)
      })
      return deleted.length
    },

    async purgeOlderThan(days, now = Date.now()) {
      const cutoff = now - days * 24 * 60 * 60 * 1000
      const old = (await listDeletedProjects()).filter((p) => (p.deletedAt ?? 0) < cutoff)
      if (old.length === 0) return 0
      await storage.transaction(['projects', ...PROJECT_CASCADE_TABLES], async (tx) => {
        for (const p of old) await purgeOne(tx, p.id)
      })
      return old.length
    },

    async duplicate(id: string) {
      const src = await get(id)
      if (!src) throw new Error(`[repository] 复制失败：项目不存在 ${id}`)
      const now = Date.now()
      // 副本绝不能继承 deletedAt：否则复制出来的项目一出现就在回收站里
      const { deletedAt: _noDeleted, ...clean } = src
      const copy: Project = {
        ...clean,
        id: createId('proj'),
        name: `${src.name} 副本`,
        createdAt: now,
        updatedAt: now,
        extra: { ...(src.extra ?? {}) },
      }
      const nodes = await storage.query('nodes', { projectId: id })
      const edges = await storage.query('edges', { projectId: id })
      /**
       * 漫剧文档**跟着副本一起抄**（对账 #456）。
       *
       * `GRAPH_TABLES` 只含 nodes / edges，而那两个常量管的是两件事：
       * **复制**抄什么、**删除**级联清什么。`storyboards` 当初加进了级联那份（#382），
       * 复制这份**漏了** ⇒ 复制一个漫剧项目得到的是「有画布、没剧本」的副本，
       * 而用户以为复制的是整个项目（剧本 / 分集 / 分镜都是项目内容，不是日志）。
       */
      const storyboardRows = await storage.query('storyboards', { projectId: id })
      const storyboardDoc = storyboardRows[0]?.doc as Record<string, unknown> | undefined
      const idMap = new Map<string, string>()
      /**
       * 电商任务 / 结果也跟着副本走（对账 #399 第二期）。
       *
       * 不复制的话，复制一个电商项目会得到"节点都在、结果区是空的"的副本；
       * 这里任务 id / 结果 id / batchId 全部重建，节点与结果的引用同步改写。
       */
      const taskRows = await storage.query('ecommerceTasks', { projectId: id })
      const resultRows = await storage.query('ecommerceResults', { projectId: id })
      const taskIdMap = new Map<string, string>()
      const batchIdMap = new Map<string, string>()
      for (const task of taskRows) {
        taskIdMap.set(String(task.id), createId('ect'))
        batchIdMap.set(String(task.batchId), createId('ecb'))
      }
      const newNodes = nodes.map((r) => {
        const nid = createId('node')
        idMap.set(String(r.id), nid)
        const data = (r.data as Record<string, unknown> | undefined) ?? {}
        const batch = typeof data.ecommerceBatch === 'string' ? data.ecommerceBatch : ''
        return {
          ...r,
          id: nid,
          projectId: copy.id,
          data: batch ? { ...data, ecommerceBatch: batchIdMap.get(batch) ?? batch } : data,
        }
      })
      const newEdges = edges.map((r) => ({
        ...r,
        id: createId('edge'),
        projectId: copy.id,
        source: idMap.get(String(r.source)) ?? String(r.source),
        target: idMap.get(String(r.target)) ?? String(r.target),
      }))
      const newTasks = taskRows.map((task) => ({
        ...task,
        id: taskIdMap.get(String(task.id))!,
        projectId: copy.id,
        batchId: batchIdMap.get(String(task.batchId)) ?? String(task.batchId),
        nodeIds: Array.isArray(task.nodeIds)
          ? task.nodeIds.map((nodeId) => idMap.get(String(nodeId)) ?? String(nodeId))
          : [],
      }))
      const newResults = resultRows.map((result) => ({
        ...result,
        id: createId('ecr'),
        taskId: taskIdMap.get(String(result.taskId))!,
        projectId: copy.id,
        nodeId: idMap.get(String(result.nodeId)) ?? String(result.nodeId),
        ...(result.canvasCopyNodeId
          ? {
              canvasCopyNodeId:
                idMap.get(String(result.canvasCopyNodeId)) ?? String(result.canvasCopyNodeId),
            }
          : {}),
      }))
      await storage.transaction(
        ['projects', ...GRAPH_TABLES, 'storyboards', 'ecommerceTasks', 'ecommerceResults'],
        async (tx) => {
          await tx.put('projects', copy as never)
          for (const n of newNodes) await tx.put('nodes', n as never)
          for (const e of newEdges) await tx.put('edges', e as never)
          if (storyboardDoc) {
            await tx.put('storyboards', {
              id: copy.id,
              projectId: copy.id,
              updatedAt: now,
              doc: { ...storyboardDoc, projectId: copy.id },
            } as never)
          }
          for (const task of newTasks) await tx.put('ecommerceTasks', task as never)
          for (const result of newResults) await tx.put('ecommerceResults', result as never)
        },
      )
      return { ...copy, nodeCount: newNodes.length }
    },
  }
}
