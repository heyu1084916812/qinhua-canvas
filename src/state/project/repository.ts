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
  list(): Promise<ProjectListItem[]>
  get(id: string): Promise<Project | null>
  create(input?: CreateProjectInput): Promise<ProjectListItem>
  rename(id: string, name: string): Promise<void>
  /** 复制项目及其全部图数据（节点 / 连线），生成带「副本」后缀的新项目 */
  duplicate(id: string): Promise<ProjectListItem>
  remove(id: string): Promise<void>
  /** 批量删除项目，与单删共用同一套级联清理语义 */
  removeMany(ids: readonly string[]): Promise<void>
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
  })

  const get = async (id: string): Promise<Project | null> => {
    const rows = await storage.query('projects', { id })
    return rows[0] ? toProject(rows[0]) : null
  }

  return {
    async list() {
      const rows = await storage.query('projects', {})
      const projects = rows.map(toProject).sort((a, b) => b.updatedAt - a.updatedAt)
      const items = await Promise.all(
        projects.map(async (p) => {
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
          return {
            ...p,
            nodeCount: nodes.length,
            coverHash,
          }
        }),
      )
      return items
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

    async remove(id: string) {
      await storage.transaction(['projects', ...PROJECT_CASCADE_TABLES], async () => {
        await storage.delete('projects', id)
        for (const table of PROJECT_CASCADE_TABLES) {
          const rows = await storage.query(table, { projectId: id })
          for (const row of rows) await storage.delete(table, row.id)
        }
      })
    },

    async removeMany(ids) {
      const unique = [...new Set(ids)]
      if (unique.length === 0) return
      await storage.transaction(['projects', ...PROJECT_CASCADE_TABLES], async () => {
        for (const id of unique) {
          await storage.delete('projects', id)
          for (const table of PROJECT_CASCADE_TABLES) {
            const rows = await storage.query(table, { projectId: id })
            for (const row of rows) await storage.delete(table, row.id)
          }
        }
      })
    },

    async duplicate(id: string) {
      const src = await get(id)
      if (!src) throw new Error(`[repository] 复制失败：项目不存在 ${id}`)
      const now = Date.now()
      const copy: Project = {
        ...src,
        id: createId('proj'),
        name: `${src.name} 副本`,
        createdAt: now,
        updatedAt: now,
        extra: { ...(src.extra ?? {}) },
      }
      const nodes = await storage.query('nodes', { projectId: id })
      const edges = await storage.query('edges', { projectId: id })
      const idMap = new Map<string, string>()
      const newNodes = nodes.map((r) => {
        const nid = createId('node')
        idMap.set(String(r.id), nid)
        return { ...r, id: nid, projectId: copy.id }
      })
      const newEdges = edges.map((r) => ({
        ...r,
        id: createId('edge'),
        projectId: copy.id,
        source: idMap.get(String(r.source)) ?? String(r.source),
        target: idMap.get(String(r.target)) ?? String(r.target),
      }))
      await storage.transaction(['projects', ...GRAPH_TABLES], async () => {
        await storage.put('projects', copy as never)
        for (const n of newNodes) await storage.put('nodes', n as never)
        for (const e of newEdges) await storage.put('edges', e as never)
      })
      return { ...copy, nodeCount: newNodes.length }
    },
  }
}
